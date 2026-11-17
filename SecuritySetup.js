const SECURITY_SHEET_NAMES = Object.freeze({
  CHAT_USERS: 'chat_users',
  ADMIN_USERS: 'admin_users',
  CHAT_LOGS: 'chat_logs'
});

const CHAT_USER_HEADERS = Object.freeze([
  'visitor_id',
  'session_id',
  'user_name',
  'entered_user_email',
  'google_account_email',
  'login_at',
  'last_activity_at',
  'user_agent',
  'status'
]);

const ADMIN_USER_HEADERS = Object.freeze([
  'admin_id',
  'admin_name',
  'admin_email',
  'role',
  'status',
  'created_by',
  'created_at',
  'updated_at'
]);

const CHAT_LOG_USER_HEADERS = Object.freeze([
  'visitor_id',
  'user_name',
  'entered_user_email',
  'google_account_email'
]);

function setupSecurityAndUserSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheetWithHeaders_(ss, SECURITY_SHEET_NAMES.CHAT_USERS, CHAT_USER_HEADERS);
  ensureSheetWithHeaders_(ss, SECURITY_SHEET_NAMES.ADMIN_USERS, ADMIN_USER_HEADERS);
  ensureColumns_(ss, SECURITY_SHEET_NAMES.CHAT_LOGS, CHAT_LOG_USER_HEADERS);

  return {
    success: true,
    message: '담당자 및 관리자 권한용 시트/컬럼 구성이 완료되었습니다.'
  };
}

function ensureSheetWithHeaders_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  ensureHeadersOnSheet_(sheet, headers);
  styleHeaderRow_(sheet, headers.length);
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureColumns_(ss, sheetName, headers) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(sheetName + ' 시트가 없습니다. 기존 프로젝트 설정 함수를 먼저 실행하세요.');
  }

  ensureHeadersOnSheet_(sheet, headers);
  styleHeaderRow_(sheet, sheet.getLastColumn());
}

function ensureHeadersOnSheet_(sheet, requiredHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(value => String(value || '').trim());

  let nextColumn = currentHeaders.filter(Boolean).length + 1;

  requiredHeaders.forEach(header => {
    if (currentHeaders.indexOf(header) === -1) {
      sheet.getRange(1, nextColumn).setValue(header);
      currentHeaders.push(header);
      nextColumn += 1;
    }
  });
}

function styleHeaderRow_(sheet, columnCount) {
  if (!columnCount) return;

  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#1f2937')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}