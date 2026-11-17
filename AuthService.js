const ACCESS_MODES = Object.freeze({ OPEN: 'OPEN', LOGIN_REQUIRED: 'LOGIN_REQUIRED' });
const USER_STATUSES = Object.freeze({ ACTIVE: 'ACTIVE', LOCKED: 'LOCKED', INACTIVE: 'INACTIVE' });
const SESSION_HOURS = 12;

function getPublicAccessState(sessionToken) {
  ensureApplicationSheets_();
  const mode = getUserAccessMode();
  const session = sessionToken ? validateUserSession_(sessionToken, false) : null;
  return { ok: true, mode: mode, loginRequired: mode === ACCESS_MODES.LOGIN_REQUIRED,
    anonymousFeedbackEnabled: isAnonymousFeedbackEnabled(),
    authenticated: !!session, isAdmin: !!(session && findAdminForSeller_(session.user)), user: session ? { userId: session.user.user_id,
      email: session.user.email, companyName: session.user.company_name,
      userName: session.user.user_name } : null };
}

function registerSeller(payload) {
  ensureApplicationSheets_();
  rateLimit_('REGISTER', getRateIdentity_(payload && payload.email), 5, 3600);
  const clean = validateRegistration_(payload);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (findUserByEmail_(clean.email)) throw new Error('이미 가입된 이메일입니다.');
    const salt = Utilities.getUuid().replace(/-/g, ''); const now = new Date();
    appendObjectRow(SHEET_NAMES.CHATBOT_USERS, { user_id: generateId('USR'),
      email: clean.email, email_verified: 'FALSE',
      password_hash: hashPassword_(clean.password, salt), password_salt: salt,
      company_name: clean.companyName, user_name: clean.userName,
      status: USER_STATUSES.ACTIVE, failed_login_count: 0,
      password_changed_at: now, created_at: now, updated_at: now });
  } finally { lock.releaseLock(); }
  return loginSeller({ email: clean.email, password: clean.password });
}

function loginSeller(payload) {
  ensureApplicationSheets_();
  const email = normalizeEmail_(payload && payload.email);
  rateLimit_('LOGIN', getRateIdentity_(email), 10, 900);
  const password = String(payload && payload.password || '');
  const user = findUserByEmail_(email);
  if (!user || String(user.status).toUpperCase() !== USER_STATUSES.ACTIVE)
    throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
  if (toDateMs_(user.locked_until) > Date.now())
    throw new Error('로그인 시도가 많아 계정이 잠겼습니다. 잠시 후 다시 시도하세요.');
  if (!constantTimeEqual_(hashPassword_(password, user.password_salt), String(user.password_hash))) {
    recordLoginFailure_(user); throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
  }
  const rawToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const now = new Date(); const expires = new Date(now.getTime() + SESSION_HOURS * 3600000);
  appendObjectRow(SHEET_NAMES.USER_SESSIONS, { session_id: generateId('SES'),
    user_id: user.user_id, token_hash: hashToken_(rawToken), status: 'ACTIVE',
    issued_at: now, expires_at: expires, last_activity_at: now });
  updateRowByKey(SHEET_NAMES.CHATBOT_USERS, 'user_id', user.user_id,
    { failed_login_count: 0, locked_until: '', last_login_at: now, updated_at: now });
  return { ok: true, token: rawToken, expiresAt: expires.toISOString(), user: {
    userId: user.user_id, email: user.email, companyName: user.company_name,
    userName: user.user_name } };
}

function logoutSeller(sessionToken) {
  const hash = hashToken_(String(sessionToken || ''));
  const row = getRowsAsObjects(SHEET_NAMES.USER_SESSIONS).find(function(item) {
    return String(item.token_hash) === hash && String(item.status).toUpperCase() === 'ACTIVE';
  });
  if (row) updateRowByKey(SHEET_NAMES.USER_SESSIONS, 'session_id', row.session_id,
    { status: 'REVOKED', revoked_at: new Date() });
  return { ok: true };
}

function requireChatAccess_(sessionToken) {
  if (typeof ADMIN_SESSION_PRINCIPAL_ !== 'undefined' && ADMIN_SESSION_PRINCIPAL_) return ADMIN_SESSION_PRINCIPAL_.user;
  const session = validateUserSession_(sessionToken, true);
  if (getUserAccessMode() === ACCESS_MODES.OPEN) return session ? session.user : null;
  if (!session) throw new Error('로그인이 필요합니다.');
  return session.user;
}

function validateUserSession_(rawToken, touch) {
  const token = String(rawToken || '').trim(); if (!token || token.length > 200) return null;
  const hash = hashToken_(token);
  const session = getRowsAsObjects(SHEET_NAMES.USER_SESSIONS).find(function(row) {
    return String(row.token_hash) === hash && String(row.status).toUpperCase() === 'ACTIVE';
  });
  if (!session || toDateMs_(session.expires_at) <= Date.now()) return null;
  const user = getRowsAsObjects(SHEET_NAMES.CHATBOT_USERS).find(function(row) {
    return String(row.user_id) === String(session.user_id) &&
      String(row.status).toUpperCase() === USER_STATUSES.ACTIVE;
  });
  if (!user) return null;
  if (touch) updateRowByKey(SHEET_NAMES.USER_SESSIONS, 'session_id', session.session_id,
    { last_activity_at: new Date() });
  return { session: session, user: user };
}

function getCurrentUserAccess() {
  if (typeof ADMIN_SESSION_PRINCIPAL_ !== 'undefined' && ADMIN_SESSION_PRINCIPAL_) {
    return { googleAccountEmail: '', isAdmin: true, role: ADMIN_SESSION_PRINCIPAL_.role,
      adminName: ADMIN_SESSION_PRINCIPAL_.name };
  }
  const email = getCurrentUserEmail();
  if (email && email === getMasterAdminEmail()) {
    return { googleAccountEmail: email, isAdmin: true, role: 'MASTER_ADMIN', adminName: '마스터 관리자' };
  }
  return { googleAccountEmail: email, isAdmin: false, role: '', adminName: '' };
}

function isCurrentUserAdmin() { return getCurrentUserAccess().isAdmin; }
function requireAdminAccess() { return requireAdmin(); }

function findAdminByEmail_(email) {
  const normalized = normalizeEmail_(email); if (!normalized) return null;
  return getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).find(function(row) {
    const rowEmail = normalizeEmail_(row.admin_email || row.user_email);
    const role = String(row.role || '').toUpperCase();
    return rowEmail === normalized && String(row.status || '').toUpperCase() === 'ACTIVE' &&
      ['ADMIN','SUPER_ADMIN','MASTER_ADMIN','VIEWER'].indexOf(role) >= 0;
  }) || null;
}

function findAdminForSeller_(user) {
  if (!user || !user.user_id) return null;
  return getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).find(function(row) {
    return String(row.seller_user_id || '') === String(user.user_id) &&
      String(row.status || '').toUpperCase() === 'ACTIVE' &&
      String(row.role || '').toUpperCase() === 'ADMIN';
  }) || null;
}

function isMasterAdmin_() {
  if (typeof ADMIN_SESSION_PRINCIPAL_ !== 'undefined' && ADMIN_SESSION_PRINCIPAL_) return false;
  const current = getCurrentUserEmail(); const master = getMasterAdminEmail();
  return !!current && !!master && current === master;
}

function requireMasterAdmin_() {
  if (!isMasterAdmin_()) throw new Error('마스터 관리자 권한이 필요합니다.'); return true;
}

function validateRegistration_(payload) {
  const source = payload || {}; const email = normalizeEmail_(source.email);
  const password = String(source.password || '');
  const companyName = sanitizePlainText_(source.companyName, 100);
  const userName = sanitizePlainText_(source.userName, 50);
  if (!email || /\s/.test(email) || email.length < 3) throw new Error('공백 없는 계정 아이디를 3자 이상 입력하세요.');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    throw new Error('비밀번호는 영문과 숫자를 포함해 10자 이상이어야 합니다.');
  if (companyName.length < 2) throw new Error('업체명을 2자 이상 입력하세요.');
  if (userName.length < 2) throw new Error('이름을 2자 이상 입력하세요.');
  return { email: email, password: password, companyName: companyName, userName: userName };
}

function findUserByEmail_(email) {
  const normalized = normalizeEmail_(email);
  return getRowsAsObjects(SHEET_NAMES.CHATBOT_USERS).find(function(row) {
    return normalizeEmail_(row.email) === normalized;
  }) || null;
}

function recordLoginFailure_(user) {
  const failures = Number(user.failed_login_count || 0) + 1;
  updateRowByKey(SHEET_NAMES.CHATBOT_USERS, 'user_id', user.user_id,
    { failed_login_count: failures,
      locked_until: failures >= 5 ? new Date(Date.now() + 15 * 60000) : '',
      updated_at: new Date() });
}

function hashPassword_(password, salt) {
  let value = String(salt) + ':' + String(password);
  for (let i = 0; i < 4000; i += 1)
    value = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      value, Utilities.Charset.UTF_8));
  return value;
}

function hashToken_(token) { return bytesToHex_(Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8)); }
function bytesToHex_(bytes) { return bytes.map(function(value) {
  const byte = value < 0 ? value + 256 : value; return ('0' + byte.toString(16)).slice(-2);
}).join(''); }
function constantTimeEqual_(a, b) { if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function normalizeEmail_(value) { return String(value || '').trim().toLowerCase().slice(0, 254); }
function isValidEmail_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')); }
function sanitizePlainText_(value, maxLength) { return String(value || '')
  .replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, maxLength || 500); }
function toDateMs_(value) { const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0; }
function getRateIdentity_(value) { return createTextHash(String(value || 'anonymous').toLowerCase()).slice(0, 24); }
function rateLimit_(scope, identity, limit, seconds) {
  const cache = CacheService.getScriptCache(); const key = 'RATE_' + scope + '_' + identity;
  const lock = LockService.getScriptLock(); lock.waitLock(3000);
  try { const count = Number(cache.get(key) || 0) + 1;
    if (count > limit) throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    cache.put(key, String(count), seconds);
  } finally { lock.releaseLock(); }
}

function ensureApplicationSheets_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('APP_SCHEMA_READY_V2') === '1') return;
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = getSpreadsheet();
    Object.keys(SHEET_SCHEMAS).forEach(function(name) {
      createSheetIfNotExists(ss, name, SHEET_SCHEMAS[name]);
    });
    initAdminUsers();
    cache.put('APP_SCHEMA_READY_V2', '1', 21600);
  } finally { lock.releaseLock(); }
}
