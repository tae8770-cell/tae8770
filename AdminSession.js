// The principal is set only for the duration of a single RPC execution.
var ADMIN_SESSION_PRINCIPAL_ = null;

function adminDispatch(token, action, args) {
  const actions = {
    getDashboardOverview: getDashboardOverview, getKnowledgeAnalytics: getKnowledgeAnalytics,
    getConversationAnalytics: getConversationAnalytics, getFeedbackAnalytics: getFeedbackAnalytics,
    getErrorAnalytics: getErrorAnalytics, getModelSettings: getModelSettings,
    saveModelSettings: saveModelSettings, getActivePromptSettings: getActivePromptSettings,
    saveActivePromptSettings: saveActivePromptSettings, runUpdateImageUrls: runUpdateImageUrls,
    runEmbeddingJob: runEmbeddingJob, runRebuildEmbeddings: runRebuildEmbeddings,
    resetRebuildEmbeddingState: resetRebuildEmbeddingState, healthCheck: healthCheck,
    adminTestQuestion: adminTestQuestion, getReviewAdminData: getReviewAdminData,
    getAccessManagementData: getAccessManagementData, setSellerUserStatus: setSellerUserStatus,
    setUserAccessMode: setUserAccessMode, setAnonymousFeedbackEnabled: setAnonymousFeedbackEnabled,
    saveAdminUser: saveAdminUser, grantSellerAdmin: grantSellerAdmin, revokeSellerAdmin: revokeSellerAdmin
  };
  if (!Object.prototype.hasOwnProperty.call(actions, action) || !Array.isArray(args))
    throw new Error('지원하지 않는 관리자 요청입니다.');
  const session = validateUserSession_(token, false);
  const admin = session && findAdminForSeller_(session.user);
  if (admin && String(admin.role).toUpperCase() === 'ADMIN') {
    ADMIN_SESSION_PRINCIPAL_ = { role: 'ADMIN', name: session.user.user_name, user: session.user };
  } else if (!isMasterAdmin_()) {
    throw new Error('관리자 권한이 없습니다. 로그인 또는 권한을 확인하세요.');
  }
  try { return actions[action].apply(null, args); }
  finally { ADMIN_SESSION_PRINCIPAL_ = null; }
}
