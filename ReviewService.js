const REVIEW_RESULTS = Object.freeze({ FOUND: true, PARTIAL: true, NOT_FOUND: true });
const REVIEW_HELPFULNESS = Object.freeze({ HELPFUL: true, NEUTRAL: true, NOT_HELPFUL: true });
const REVIEW_STATUSES = ['RECEIVED','REVIEWING','ACTION_REQUIRED','KNOWLEDGE_UPDATE','RESOLVED','NO_ACTION','DUPLICATE'];

function submitChatbotReview(payload) {
  const source = payload || {}; const user = requireChatAccess_(source.sessionToken || '');
  rateLimit_('REVIEW', getRateIdentity_(user ? user.user_id : source.sessionId), 20, 3600);
  const informationResult = String(source.informationResult || '').toUpperCase();
  const helpfulness = String(source.helpfulness || '').toUpperCase();
  if (!REVIEW_RESULTS[informationResult] || !REVIEW_HELPFULNESS[helpfulness])
    throw new Error('두 개의 필수 설문 문항을 선택해 주세요.');
  const responseMode = String(source.responseMode || 'ANONYMOUS').toUpperCase();
  if (['ANONYMOUS','IDENTIFIED'].indexOf(responseMode) < 0) throw new Error('응답 방식을 확인해 주세요.');
  if (responseMode === 'ANONYMOUS' && !isAnonymousFeedbackEnabled()) throw new Error('현재 익명 피드백은 관리자 설정으로 비활성화되어 있습니다.');
  const issues = sanitizeIssueTypes_(source.issueTypes);
  if (!issues.length) throw new Error('아쉬운 점을 한 가지 이상 선택해 주세요. 해당 사항이 없으면 "없음"을 선택하세요.');
  if (issues.indexOf('NONE') >= 0 && issues.length > 1) throw new Error('"없음"은 다른 개선 유형과 함께 선택할 수 없습니다.');
  const referenceDomain = sanitizePlainText_(source.referenceDomain, 120);
  const referenceUrl = String(source.referenceUrl || '').trim().slice(0, 1000);
  if (referenceUrl && !/^https:\/\//i.test(referenceUrl)) throw new Error('참고 링크는 HTTPS 주소만 입력하세요.');
  const attachment = saveFeedbackAttachment_(source.attachment);
  const now = new Date(); const accountIdentity = user ? user.user_id : String(source.sessionId || 'anonymous');
  const reviewId = generateId('REV');
  appendObjectRow(SHEET_NAMES.CHATBOT_REVIEWS, { review_id: reviewId,
    session_id: sanitizePlainText_(source.sessionId, 120),
    related_log_id: sanitizePlainText_(source.relatedLogId, 120),
    entry_point: sanitizePlainText_(source.entryPoint || 'HEADER', 30),
    response_mode: responseMode,
    company_name: responseMode === 'IDENTIFIED' ? sanitizePlainText_(source.companyName, 100) : '',
    respondent_name: responseMode === 'IDENTIFIED' ? sanitizePlainText_(source.respondentName, 50) : '',
    information_result: informationResult, helpfulness: helpfulness,
    issue_types: issues.join(','),
    business_domain: sanitizePlainText_(source.businessDomain, 80),
    detail_comment: maskSensitiveText_(source.detailComment, 1500),
    suggested_correction: maskSensitiveText_(source.suggestedCorrection, 1500),
    reference_domain: referenceDomain, reference_url: referenceUrl,
    attachment_file_id: attachment ? attachment.id : '',
    attachment_file_name: attachment ? attachment.name : '',
    attachment_url: attachment ? attachment.url : '',
    status: 'RECEIVED', ai_analysis_status: 'PENDING',
    submitted_account_hash: getRateIdentity_(accountIdentity), submitted_at: now, updated_at: now });
  return { ok: true, reviewId: reviewId };
}

function getReviewAdminData(days) {
  requireAdmin();
  const range = Math.max(1, Math.min(365, Number(days || 30)));
  const cutoff = Date.now() - range * 86400000;
  const rows = getRowsAsObjects(SHEET_NAMES.CHATBOT_REVIEWS).filter(function(row) {
    return toDateMs_(row.submitted_at) >= cutoff;
  });
  function count(field) { const out = {}; rows.forEach(function(row) {
    const value = String(row[field] || 'UNKNOWN'); out[value] = (out[value] || 0) + 1;
  }); return objectToSeries(out); }
  return { cards: { total: rows.length,
    foundRate: rows.length ? Math.round(rows.filter(function(r){return String(r.information_result)==='FOUND';}).length / rows.length * 100) : 0,
    helpfulRate: rows.length ? Math.round(rows.filter(function(r){return String(r.helpfulness)==='HELPFUL';}).length / rows.length * 100) : 0,
    actionRequired: rows.filter(function(r){return String(r.status)==='ACTION_REQUIRED';}).length,
    anonymous: rows.filter(function(r){return String(r.response_mode)==='ANONYMOUS';}).length,
    aiCompleted: rows.filter(function(r){return String(r.ai_analysis_status)==='COMPLETED';}).length },
    information: count('information_result'), helpfulness: count('helpfulness'), status: count('status'),
    rows: serializeRowsForClient(rows.slice(-200).reverse()) };
}

function updateChatbotReview(reviewId, payload) {
  requireAdmin(); const status = String(payload && payload.status || '').toUpperCase();
  if (REVIEW_STATUSES.indexOf(status) < 0) throw new Error('올바르지 않은 처리 상태입니다.');
  updateRowByKey(SHEET_NAMES.CHATBOT_REVIEWS, 'review_id', reviewId, {
    status: status, admin_comment: sanitizePlainText_(payload.adminComment, 1500),
    updated_at: new Date(), resolved_at: ['RESOLVED','NO_ACTION','DUPLICATE'].indexOf(status) >= 0 ? new Date() : '' });
  return { ok: true };
}

function analyzeChatbotReview(reviewId) {
  requireAdmin(); const review = getRowsAsObjects(SHEET_NAMES.CHATBOT_REVIEWS).find(function(r){return String(r.review_id)===String(reviewId);});
  if (!review) throw new Error('피드백을 찾을 수 없습니다.');
  const related = String(review.related_log_id || '') ? getRowsAsObjects(SHEET_NAMES.CHAT_LOGS).find(function(r){return String(r.log_id)===String(review.related_log_id);}) : null;
  const safeInput = { information_result: review.information_result, helpfulness: review.helpfulness,
    issue_types: review.issue_types, business_domain: review.business_domain,
    detail_comment: review.detail_comment, suggested_correction: review.suggested_correction,
    question: related ? related.question : '', answer: related ? related.answer : '',
    related_knowledge_ids: related ? related.retrieved_ids : '' };
  const raw = callOpenAIChat([{ role: 'system', content: '판매자 RAG 피드백을 분석한다. 개인정보를 추론하지 말고 JSON만 반환한다.' },
    { role: 'user', content: JSON.stringify(safeInput) }], { temperature: 0.1, maxCompletionTokens: 900,
      responseFormat: { type: 'json_object' } });
  const result = safeJsonParse(raw, {}); const now = new Date();
  updateRowByKey(SHEET_NAMES.CHATBOT_REVIEWS, 'review_id', reviewId, {
    ai_analysis_status: 'COMPLETED', ai_category: sanitizePlainText_(result.category, 80),
    ai_summary: sanitizePlainText_(result.summary, 1000), ai_root_cause: sanitizePlainText_(result.root_cause, 1500),
    ai_recommended_action: sanitizePlainText_(result.recommended_action, 1500),
    ai_related_knowledge_ids: Array.isArray(result.related_knowledge_ids) ? result.related_knowledge_ids.join(',') : '',
    ai_suggested_knowledge: sanitizePlainText_(result.suggested_knowledge, 3000),
    ai_confidence: Math.max(0, Math.min(1, Number(result.confidence || 0))), ai_analyzed_at: now, updated_at: now });
  return { ok: true, analysis: result };
}

function sanitizeIssueTypes_(value) { const allowed = ['NONE','NOT_FOUND','INACCURATE','INSUFFICIENT_DETAIL','MISSING_STEPS','STALE_POLICY','NEW_KNOWLEDGE','NEED_SCREEN','OTHER'];
  return (Array.isArray(value) ? value : []).map(function(v){return String(v).toUpperCase();}).filter(function(v){return allowed.indexOf(v)>=0;}).slice(0,8); }
function maskSensitiveText_(value, limit) { return String(redactSensitivePayload({ value: String(value || '').slice(0, limit) }).value || ''); }

function saveFeedbackAttachment_(attachment) {
  if (!attachment || !attachment.data) return null;
  const name = sanitizePlainText_(attachment.name || 'feedback-attachment', 120).replace(/[\\/:*?"<>|]/g, '_');
  const mime = String(attachment.mimeType || 'application/octet-stream').slice(0, 100);
  const data = String(attachment.data || '');
  if (data.length > 7000000) throw new Error('첨부 파일은 5MB 이하만 업로드할 수 있습니다.');
  if (!/^data:[^;]+;base64,/.test(data)) throw new Error('첨부 파일 형식이 올바르지 않습니다.');
  const encoded = data.split(',')[1];
  const folder = DriveApp.getFolderById(getFeedbackDriveFolderId_());
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(encoded), mime, name));
  return { id: file.getId(), name: file.getName(), url: 'https://drive.google.com/open?id=' + file.getId() };
}
