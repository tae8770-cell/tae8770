function saveChatLog(data) {
  const logId = generateId('LOG');

  appendObjectRow(SHEET_NAMES.CHAT_LOGS, {
    log_id: logId,
    session_id: valueOrBlank(data.session_id),
    turn_no: valueOrBlank(data.turn_no),
    user_email: valueOrBlank(data.user_email || getCurrentUserEmail()),
    question: valueOrBlank(data.question),
    answer: valueOrBlank(data.answer),
    answer_sections_json: valueOrBlank(data.answer_sections_json),
    retrieved_ids: valueOrBlank(data.retrieved_ids),
    top_score: valueOrBlank(data.top_score),
    domain_detected: valueOrBlank(data.domain_detected),
    model_used: valueOrBlank(data.model_used),
    prompt_id: valueOrBlank(data.prompt_id),
    search_mode: valueOrBlank(data.search_mode),
    search_time_ms: valueOrBlank(data.search_time_ms),
    generation_time_ms: valueOrBlank(data.generation_time_ms),
    response_time_ms: valueOrBlank(data.response_time_ms),
    created_at: new Date()
  });

  return logId;
}

function getRecentConversationHistory(sessionId, turnCount) {
  const normalized = String(sessionId || '').trim();
  const limit = Math.max(0, Math.min(10, Number(turnCount || 0)));

  if (!normalized || limit < 1) {
    return [];
  }

  return getRowsAsObjects(SHEET_NAMES.CHAT_LOGS)
    .filter(function(row) {
      return String(row.session_id || '') === normalized;
    })
    .sort(function(a, b) {
      const aTurn = Number(a.turn_no || 0);
      const bTurn = Number(b.turn_no || 0);

      if (aTurn !== bTurn) {
        return aTurn - bTurn;
      }

      return Number(a._rowNumber || 0) - Number(b._rowNumber || 0);
    })
    .slice(-limit)
    .map(function(row) {
      return {
        turn_no: Number(row.turn_no || 0),
        question: String(row.question || '').slice(0, 1000),
        answer: String(row.answer || '').slice(0, 2200)
      };
    });
}

function sanitizeClientConversationHistory(clientHistory, limit) {
  if (!Array.isArray(clientHistory)) {
    return [];
  }

  const maxTurns = Math.max(0, Math.min(10, Number(limit || 5)));

  return clientHistory
    .slice(-maxTurns)
    .map(function(turn, index) {
      return {
        turn_no: index + 1,
        question: String(turn && turn.question || '')
          .trim()
          .slice(0, 1000),
        answer: String(turn && turn.answer || '')
          .trim()
          .slice(0, 2200)
      };
    })
    .filter(function(turn) {
      return turn.question !== '' || turn.answer !== '';
    });
}

function resolveConversationHistory(
  sessionId,
  clientHistory,
  turnCount
) {
  const clientRows = sanitizeClientConversationHistory(
    clientHistory,
    turnCount
  );

  if (clientRows.length > 0) {
    return clientRows;
  }

  return getRecentConversationHistory(
    sessionId,
    turnCount
  );
}

function getNextTurnNumber(sessionId) {
  const rows = getRowsAsObjects(SHEET_NAMES.CHAT_LOGS).filter(
    function(row) {
      return String(row.session_id || '') === String(sessionId || '');
    }
  );

  if (rows.length === 0) return 1;

  return (
    Math.max.apply(
      null,
      rows.map(function(row) {
        return Number(row.turn_no || 0);
      })
    ) + 1
  );
}

function saveFeedback(feedbackData) {
  if (!feedbackData || !feedbackData.log_id) {
    throw new Error('피드백 대상 log_id가 없습니다.');
  }
  requireChatAccess_(feedbackData.session_token || '');
  rateLimit_('QUICK_FEEDBACK', getRateIdentity_(feedbackData.session_id || feedbackData.log_id), 30, 3600);

  const allowedRatings = ['GOOD', 'BAD', 'NEED_REVIEW'];
  const rating = String(feedbackData.rating || '')
    .trim()
    .toUpperCase();

  if (allowedRatings.indexOf(rating) < 0) {
    throw new Error('올바르지 않은 피드백 값입니다.');
  }

  const logExists = getRowsAsObjects(SHEET_NAMES.CHAT_LOGS).some(
    function(row) {
      return String(row.log_id) === String(feedbackData.log_id);
    }
  );

  if (!logExists) {
    throw new Error('피드백 대상 대화 로그를 찾을 수 없습니다.');
  }

  const feedbackId = generateId('FB');

  appendObjectRow(SHEET_NAMES.FEEDBACK_LOGS, {
    feedback_id: feedbackId,
    log_id: feedbackData.log_id,
    user_email: feedbackData.user_email || getCurrentUserEmail(),
    rating: rating,
    comment: sanitizePlainText_(feedbackData.comment, 1000),
    created_at: new Date()
  });

  return {
    ok: true,
    feedback_id: feedbackId
  };
}

function saveErrorLog(functionName, error, payload) {
  try {
    appendObjectRow(SHEET_NAMES.ERROR_LOGS, {
      error_id: generateId('ERR'),
      function_name: functionName || '',
      error_message:
        error && error.message
          ? error.message
          : String(error),
      input_payload: payload
        ? JSON.stringify(redactSensitivePayload(payload))
        : '',
      user_email: getCurrentUserEmail(),
      created_at: new Date()
    });
  } catch (logErr) {
    console.error(logErr);
  }
}

function redactSensitivePayload(payload) {
  function walk(value, depth) {
    if (depth > 6) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 50).map(function(item) { return walk(item, depth + 1); });
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).slice(0, 80).forEach(function(key) {
        if (/password|secret|api.?key|authorization|access.?token|refresh.?token|session.?token/i.test(key)) out[key] = '[REDACTED]';
        else out[key] = walk(value[key], depth + 1);
      });
      return out;
    }
    if (typeof value === 'string') return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[PHONE]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[NUMBER]')
      .slice(0, 4000);
    return value;
  }
  return walk(payload || {}, 0);
}

function clearErrorLogs() {
  requireAdmin();

  const sheet = getSheet(SHEET_NAMES.ERROR_LOGS);

  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        sheet.getLastColumn()
      )
      .clearContent();
  }

  return { ok: true };
}
