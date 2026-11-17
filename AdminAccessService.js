function getAccessManagementData() {
  requireAdmin();
  return {
    mode: getUserAccessMode(),
    anonymousFeedbackEnabled: isAnonymousFeedbackEnabled(),
    masterEmail: isMasterAdmin_() ? getMasterAdminEmail() : maskEmail_(getMasterAdminEmail()),
    isMaster: isMasterAdmin_(),
    users: serializeRowsForClient(getRowsAsObjects(SHEET_NAMES.CHATBOT_USERS).map(function(row) {
      return { user_id: row.user_id, email: row.email, company_name: row.company_name,
        user_name: row.user_name, status: row.status, last_login_at: row.last_login_at,
        created_at: row.created_at };
    })),
    admins: serializeRowsForClient(getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).map(function(row) {
      return { admin_id: row.admin_id, admin_email: row.admin_email || row.user_email,
        admin_name: row.admin_name || row.user_name, role: row.role, status: row.status,
        created_at: row.created_at };
    }))
  };
}

function setAnonymousFeedbackEnabled(enabled) {
  requireMasterAdmin_();
  const value = Boolean(enabled);
  PropertiesService.getScriptProperties().setProperty('ANONYMOUS_FEEDBACK_ENABLED', value ? 'TRUE' : 'FALSE');
  appendAuditLog_('ANONYMOUS_FEEDBACK_CHANGED', 'SETTING', 'ANONYMOUS_FEEDBACK_ENABLED', null, { value: value });
  return { ok: true, enabled: value };
}

function setUserAccessMode(mode) {
  requireMasterAdmin_();
  const normalized = String(mode || '').trim().toUpperCase();
  if (['OPEN','LOGIN_REQUIRED'].indexOf(normalized) < 0) throw new Error('지원하지 않는 접속 모드입니다.');
  const previous = getUserAccessMode();
  PropertiesService.getScriptProperties().setProperty('USER_ACCESS_MODE', normalized);
  appendAuditLog_('ACCESS_MODE_CHANGED', 'SETTING', 'USER_ACCESS_MODE', { value: previous }, { value: normalized });
  return { ok: true, mode: normalized };
}

function saveAdminUser(payload) {
  requireAdmin();
  const clean = payload || {}; const email = normalizeEmail_(clean.email);
  const name = sanitizePlainText_(clean.name, 50);
  const role = String(clean.role || '').trim().toUpperCase();
  const status = String(clean.status || 'ACTIVE').trim().toUpperCase();
  if (!email || /\s/.test(email) || email.length < 3) throw new Error('올바른 계정 아이디를 입력하세요.');
  if (['ADMIN','VIEWER'].indexOf(role) < 0) throw new Error('ADMIN 또는 VIEWER 역할만 부여할 수 있습니다.');
  if (['ACTIVE','INACTIVE'].indexOf(status) < 0) throw new Error('올바르지 않은 상태입니다.');
  if (email === getMasterAdminEmail()) throw new Error('마스터 관리자 계정은 이 화면에서 변경할 수 없습니다.');
  const seller = findUserByEmail_(email);
  if (!seller || String(seller.status).toUpperCase() !== 'ACTIVE') throw new Error('활성 판매자 계정을 먼저 확인하세요.');
  const matches = getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).filter(function(row) {
    return normalizeEmail_(row.admin_email || row.user_email) === email;
  });
  if (matches.length > 1) throw new Error('중복된 관리자 이메일이 있습니다. 시트의 중복을 확인하세요.');
  const existing = matches[0]; const now = new Date();
  if (existing) updateRowByKey(SHEET_NAMES.ADMIN_USERS, existing.admin_id ? 'admin_id' : 'user_email',
    existing.admin_id || existing.user_email, { admin_email: email, admin_name: name,
      role: role, status: status, seller_user_id: seller.user_id, updated_at: now });
  else appendObjectRow(SHEET_NAMES.ADMIN_USERS, { admin_id: generateId('ADM'),
    admin_email: email, admin_name: name, role: role, status: status, seller_user_id: seller.user_id,
    created_by: getCurrentUserEmail(), created_at: now, updated_at: now });
  appendAuditLog_('ADMIN_SAVED', 'ADMIN', email, null, { role: role, status: status });
  return { ok: true };
}

function setSellerUserStatus(userId, status) {
  requireAdmin();
  const normalized = String(status || '').trim().toUpperCase();
  if (['ACTIVE','LOCKED','INACTIVE'].indexOf(normalized) < 0) throw new Error('올바르지 않은 회원 상태입니다.');
  updateRowByKey(SHEET_NAMES.CHATBOT_USERS, 'user_id', userId, { status: normalized, updated_at: new Date() });
  appendAuditLog_('USER_STATUS_CHANGED', 'USER', userId, null, { status: normalized });
  return { ok: true };
}

function grantSellerAdmin(userId) {
  requireAdmin();
  const users = getRowsAsObjects(SHEET_NAMES.CHATBOT_USERS).filter(function(row) {
    return String(row.user_id) === String(userId);
  });
  if (users.length !== 1 || String(users[0].status).toUpperCase() !== 'ACTIVE') {
    throw new Error('활성 판매자 회원을 찾을 수 없습니다.');
  }
  return saveAdminUser({ email: users[0].email, name: users[0].user_name, role: 'ADMIN', status: 'ACTIVE' });
}

function revokeSellerAdmin(userId) {
  requireAdmin();
  const admin = getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).find(function(row) {
    return String(row.seller_user_id || '') === String(userId) && String(row.status).toUpperCase() === 'ACTIVE';
  });
  if (!admin) throw new Error('부여된 관리자 권한이 없습니다.');
  updateRowByKey(SHEET_NAMES.ADMIN_USERS, 'admin_id', admin.admin_id, { status: 'INACTIVE', updated_at: new Date() });
  appendAuditLog_('ADMIN_REVOKED', 'USER', userId, null, { status: 'INACTIVE' });
  return { ok: true };
}

function appendAuditLog_(action, targetType, targetId, before, after) {
  appendObjectRow(SHEET_NAMES.AUDIT_LOGS, { audit_id: generateId('AUD'),
    actor_email: getCurrentUserEmail(), action: action, target_type: targetType,
    target_id: targetId, before_json: before ? JSON.stringify(before) : '',
    after_json: after ? JSON.stringify(after) : '', created_at: new Date() });
}

function maskEmail_(email) {
  const parts = String(email || '').split('@'); if (parts.length !== 2) return '';
  return parts[0].slice(0, 2) + '***@' + parts[1];
}
