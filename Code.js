function doGet(e) {
  const page =
    e && e.parameter && e.parameter.page
      ? String(e.parameter.page).toLowerCase()
      : 'index';

  const appUrl =
    ScriptApp.getService().getUrl() || '';

  if (page === 'admin') {
    const template =
      HtmlService.createTemplateFromFile(
        'Admin'
      );

    template.appUrl = appUrl;

    return template
      .evaluate()
      .setTitle(
        'Eland Ops AI 관리자'
      );
  }

  const template =
    HtmlService.createTemplateFromFile(
      'Index'
    );

  template.appUrl = appUrl;

  return template
    .evaluate()
    .setTitle(
      '판매자 헬프센터'
    );
}

function include(filename) {
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

/**
 * 최초 설치 전:
 * DEFAULT_ADMIN_EMAIL과 현재 사용자 이메일을 비교합니다.
 *
 * 설치 후:
 * admin_users 시트의 ACTIVE ADMIN 권한을 확인합니다.
 */
function setupProject() {
  requireSetupPermission();
  setupSheets();

  return {
    ok: true,
    message:
      '시트 구조와 기본 설정이 생성되었습니다.'
  };
}

function healthCheck() {
  requireAdmin();

  let spreadsheetId = '';
  let spreadsheetOk = false;
  let spreadsheetError = '';

  try {
    spreadsheetId =
      getSpreadsheet().getId();

    spreadsheetOk = true;
  } catch (err) {
    spreadsheetError =
      err && err.message
        ? err.message
        : String(err);
  }

  return {
    ok: spreadsheetOk,
    app: 'Eland Ops AI',
    time:
      new Date().toISOString(),

    hasApiKey:
      hasScriptProperty(
        'OPENAI_API_KEY'
      ),

    hasImageFolderId:
      hasScriptProperty(
        'RAG_IMAGE_FOLDER_ID'
      ),

    spreadsheetOk:
      spreadsheetOk,

    spreadsheetId:
      spreadsheetId,

    spreadsheetError:
      spreadsheetError,

    currentUser:
      getCurrentUserEmail(),

    isAdmin:
      isCurrentUserAdmin()
  };
}
