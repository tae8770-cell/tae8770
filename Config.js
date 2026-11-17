
const SHEET_NAMES = {
  RAG_KNOWLEDGE: 'rag_knowledge',
  EMBEDDINGS: 'embeddings',
  MODEL_CONFIG: 'model_config',
  PROMPTS: 'prompts',
  CHAT_LOGS: 'chat_logs',
  FEEDBACK_LOGS: 'feedback_logs',
  ADMIN_USERS: 'admin_users',
  ERROR_LOGS: 'error_logs'
  ,CHATBOT_USERS: 'chatbot_users'
  ,USER_SESSIONS: 'user_sessions'
  ,CHATBOT_REVIEWS: 'chatbot_reviews'
  ,AUDIT_LOGS: 'audit_logs'
};

const CONFIG_CACHE_KEY = 'ELAND_OPS_CONFIG_V3';
const CONFIG_CACHE_SECONDS = 60;

function getScriptProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function hasScriptProperty(key) {
  const value = getScriptProperty(key);
  return value !== null && String(value).trim() !== '';
}

function getOpenAiApiKey() {
  const key = getScriptProperty('OPENAI_API_KEY');

  if (!key || String(key).trim() === '') {
    throw new Error('Script Properties에 OPENAI_API_KEY가 없습니다.');
  }

  return String(key).trim();
}

function getSpreadsheet() {
  const spreadsheetId = getScriptProperty('SPREADSHEET_ID');

  if (spreadsheetId && String(spreadsheetId).trim() !== '') {
    return SpreadsheetApp.openById(String(spreadsheetId).trim());
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();

  if (!active) {
    throw new Error(
      '활성 스프레드시트를 찾을 수 없습니다. Script Properties에 SPREADSHEET_ID를 설정하세요.'
    );
  }

  return active;
}

function loadRawConfigMap() {
  const map = {};

  try {
    getRowsAsObjects(SHEET_NAMES.MODEL_CONFIG).forEach(function(row) {
      const key = String(row.config_key || '').trim();
      if (key) map[key] = row.config_value;
    });
  } catch (err) {}

  return map;
}

function getAllConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);

  if (cached) {
    const parsed = safeJsonParse(cached, null);
    if (parsed) return parsed;
  }

  const raw = loadRawConfigMap();

  const config = {
    answer_model: String(raw.answer_model || 'gpt-4.1-mini').trim(),
    embedding_model: String(raw.embedding_model || 'text-embedding-3-small').trim(),
    top_k: clampInteger(raw.top_k, 1, 10, 5),
    similarity_threshold: clampNumber(raw.similarity_threshold, -1, 1, 0.35),
    temperature: clampNumber(raw.temperature, 0, 2, 0.2),
    max_context_count: clampInteger(raw.max_context_count, 1, 8, 4),
    use_only_approved: parseBooleanValue(raw.use_only_approved, true),
    history_turns: clampInteger(raw.history_turns, 0, 10, 5),
    answer_max_tokens: clampInteger(raw.answer_max_tokens, 200, 1800, 800),
    exact_match_enabled: parseBooleanValue(raw.exact_match_enabled, true),
    search_cache_seconds: clampInteger(raw.search_cache_seconds, 0, 1800, 300)
  };

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_SECONDS);
  return config;
}

function getConfigValue(key, defaultValue) {
  const config = getAllConfig();
  return Object.prototype.hasOwnProperty.call(config, key)
    ? config[key]
    : defaultValue;
}

function invalidateConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

function clampInteger(value, min, max, defaultValue) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function clampNumber(value, min, max, defaultValue) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.min(max, Math.max(min, num));
}

function parseBooleanValue(value, defaultValue) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'TRUE') return true;
  if (normalized === 'FALSE') return false;
  return defaultValue;
}

function getNumberConfig(key, defaultValue) {
  const value = getConfigValue(key, defaultValue);
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function getBooleanConfig(key, defaultValue) {
  return parseBooleanValue(getConfigValue(key, defaultValue), defaultValue);
}

function getRagImageFolderId() {
  return getDriveResourceId(
    getScriptProperty('RAG_IMAGE_FOLDER_ID')
  );
}

function getDriveResourceId(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!raw) return '';

  const folderMatch = raw.match(
    /\/folders\/([a-zA-Z0-9_-]+)/
  );

  if (folderMatch) {
    return folderMatch[1];
  }

  const fileMatch = raw.match(
    /\/file\/d\/([a-zA-Z0-9_-]+)/
  );

  if (fileMatch) {
    return fileMatch[1];
  }

  const idMatch = raw.match(
    /[?&]id=([a-zA-Z0-9_-]+)/
  );

  if (idMatch) {
    return idMatch[1];
  }

  return raw;
}

function getCurrentUserEmail() {
  try {
    return String(Session.getActiveUser().getEmail() || '')
      .trim()
      .toLowerCase();
  } catch (err) {
    return '';
  }
}

function getDefaultAdminEmail() {
  return String(getScriptProperty('DEFAULT_ADMIN_EMAIL') || '')
    .trim()
    .toLowerCase();
}

function getMasterAdminEmail() {
  const configured = String(
    getScriptProperty('MASTER_ADMIN_EMAIL') ||
    getScriptProperty('DEFAULT_ADMIN_EMAIL') ||
    'tae8770@gmail.com'
  ).trim().toLowerCase();
  if (configured === 'tae8770@gmai.com') return 'tae8770@gmail.com';
  return configured;
}

// 추가 관리자 계정 2개
function isAdditionalMasterAdmin_() {
  const email = getCurrentUserEmail();

  return [
    'pearl00114@gmail.com',
    'cogitomin@gmail.com'
  ].includes(email);
}

function getUserAccessMode() {
  // The previous release enforced login regardless of the stored setting.
  // Preserve that effective policy until an administrator changes it.
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('CHAT_ACCESS_POLICY_RESTORED_V1') !== 'TRUE') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (properties.getProperty('CHAT_ACCESS_POLICY_RESTORED_V1') !== 'TRUE') {
        properties.setProperties({ USER_ACCESS_MODE: 'LOGIN_REQUIRED', CHAT_ACCESS_POLICY_RESTORED_V1: 'TRUE' });
      }
    } finally { lock.releaseLock(); }
  }
  const mode = String(
    getScriptProperty('USER_ACCESS_MODE') || 'LOGIN_REQUIRED'
  ).trim().toUpperCase();
  return ['OPEN', 'LOGIN_REQUIRED'].indexOf(mode) >= 0
    ? mode
    : 'LOGIN_REQUIRED';
}

function isAnonymousFeedbackEnabled() {
  const value = getScriptProperty('ANONYMOUS_FEEDBACK_ENABLED');
  return value === null || String(value).trim() === ''
    ? true
    : parseBooleanValue(value, true);
}

function getFeedbackDriveFolderId_() {
  return getDriveResourceId(
    getScriptProperty('FEEDBACK_DRIVE_FOLDER_ID') ||
    'https://drive.google.com/drive/u/0/folders/1sj77r1-gI399SPpwBGFQRkyj7Nr5inZw'
  );
}

function adminUsersSheetExists() {
  try {
    return !!getSpreadsheet().getSheetByName(SHEET_NAMES.ADMIN_USERS);
  } catch (err) {
    return false;
  }
}

function hasRegisteredAdminUsers() {
  if (!adminUsersSheetExists()) return false;

  try {
    return getRowsAsObjects(SHEET_NAMES.ADMIN_USERS).some(function(row) {
      return (
        ['ADMIN','SUPER_ADMIN','MASTER_ADMIN'].indexOf(
          String(row.role || '').trim().toUpperCase()
        ) >= 0 &&
        String(row.status || '').trim().toUpperCase() === 'ACTIVE' &&
        String(row.admin_email || row.user_email || '').trim() !== ''
      );
    });
  } catch (err) {
    return false;
  }
}

function isCurrentUserAdminLegacy_() {
  // 추가 관리자 계정 권한 허용
  if (isAdditionalMasterAdmin_()) return true;

  const email = getCurrentUserEmail();
  if (!email) return false;

  try {
    const rows = getRowsAsObjects(SHEET_NAMES.ADMIN_USERS);

    return rows.some(function(row) {
      return (
        String(row.user_email || '').trim().toLowerCase() === email &&
        String(row.role || '').trim().toUpperCase() === 'ADMIN' &&
        String(row.status || '').trim().toUpperCase() === 'ACTIVE'
      );
    });
  } catch (err) {
    const defaultAdmin = getDefaultAdminEmail();
    return defaultAdmin !== '' && defaultAdmin === email;
  }
}

function requireAdmin() {
  if (typeof ADMIN_SESSION_PRINCIPAL_ !== 'undefined' && ADMIN_SESSION_PRINCIPAL_) return true;
  // 추가 관리자 계정 권한 허용
  if (!isCurrentUserAdmin()) {
    throw new Error('관리자 권한이 없습니다.');
  }
  return true;
}

function requireSetupPermission() {
  if (hasRegisteredAdminUsers()) return requireAdmin();

  const currentEmail = getCurrentUserEmail();
  const defaultAdmin = getDefaultAdminEmail();

  if (!defaultAdmin) {
    throw new Error(
      '최초 설정 전 Script Properties에 DEFAULT_ADMIN_EMAIL을 등록하세요.'
    );
  }

  if (!currentEmail) {
    throw new Error(
      '현재 사용자 이메일을 확인할 수 없습니다. Apps Script 편집기에서 setupProject()를 직접 실행하거나 웹 앱 배포 권한 설정을 확인하세요.'
    );
  }

  if (currentEmail !== defaultAdmin) {
    throw new Error(
      'DEFAULT_ADMIN_EMAIL과 현재 실행 계정이 일치하지 않습니다.'
    );
  }

  return true;
}
