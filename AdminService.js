function getDashboardOverview(days) {
  requireAdmin();

  const rangeDays = clampAdminDays(days || 30);
  const knowledge = getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE);
  const embeddings = getRowsAsObjects(SHEET_NAMES.EMBEDDINGS);
  const chats = getRowsAsObjects(SHEET_NAMES.CHAT_LOGS);
  const feedback = getRowsAsObjects(SHEET_NAMES.FEEDBACK_LOGS);
  const errors = getRowsAsObjects(SHEET_NAMES.ERROR_LOGS);
  const cutoff = new Date(Date.now() - rangeDays * 86400000);

  const recentChats = chats.filter(function(row) {
    return toDateValue(row.created_at) >= cutoff;
  });

  const recentFeedback = feedback.filter(function(row) {
    return toDateValue(row.created_at) >= cutoff;
  });

  const recentErrors = errors.filter(function(row) {
    return toDateValue(row.created_at) >= cutoff;
  });

  const activeEmbeddingIds = new Set(
    embeddings
      .filter(function(row) {
        return String(row.status || '').trim().toUpperCase() === 'ACTIVE';
      })
      .map(function(row) {
        return String(row.knowledge_id || '');
      })
  );

  const approved = knowledge.filter(function(row) {
    return String(row.status || '').trim().toUpperCase() === 'APPROVED';
  });

  const imageConnected = knowledge.filter(hasKnowledgeImage).length;
  const feedbackCounts = countFeedbackRatings(recentFeedback);
  const totalFeedback = recentFeedback.length;
  const averageResponseMs = averageNumericValue(recentChats, 'response_time_ms');

  return {
    period_days: rangeDays,
    cards: {
      knowledge_total: knowledge.length,
      knowledge_approved: approved.length,
      active_embeddings: activeEmbeddingIds.size,
      image_connection_rate: knowledge.length
        ? Math.round((imageConnected / knowledge.length) * 100)
        : 0,
      chats: recentChats.length,
      average_response_ms: averageResponseMs,
      positive_feedback_rate: totalFeedback
        ? Math.round((feedbackCounts.GOOD / totalFeedback) * 100)
        : 0,
      errors: recentErrors.length
    },
    knowledge_status: countByField(knowledge, 'status', '미지정'),
    knowledge_domains: topSeries(countByField(knowledge, 'domain', '미분류'), 10),
    daily_chats: buildDailySeries(recentChats, rangeDays),
    feedback_distribution: objectToSeries(feedbackCounts),
    search_modes: objectToSeries(countByField(recentChats, 'search_mode', 'UNKNOWN')),
    operations: {
      review_pending: knowledge.filter(function(row) {
        return String(row.status || '').trim().toUpperCase() === 'REVIEW';
      }).length,
      image_missing: knowledge.length - imageConnected,
      embedding_missing: approved.filter(function(row) {
        return !activeEmbeddingIds.has(String(row.knowledge_id || ''));
      }).length,
      duplicate_knowledge_ids: validateKnowledgeIds().duplicate_ids.length,
      recent_error_count: recentErrors.length,
      negative_feedback_count:
        feedbackCounts.BAD + feedbackCounts.NEED_REVIEW
    }
  };
}

function getKnowledgeAnalytics() {
  requireAdmin();

  const knowledge = getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE);
  const embeddings = getRowsAsObjects(SHEET_NAMES.EMBEDDINGS);
  const activeEmbeddingIds = new Set(
    embeddings
      .filter(function(row) {
        return String(row.status || '').trim().toUpperCase() === 'ACTIVE';
      })
      .map(function(row) {
        return String(row.knowledge_id || '');
      })
  );

  const imageConnected = knowledge.filter(hasKnowledgeImage).length;
  const approved = knowledge.filter(function(row) {
    return String(row.status || '').trim().toUpperCase() === 'APPROVED';
  });
  const validation = validateKnowledgeIds();

  return {
    cards: {
      total: knowledge.length,
      approved: approved.length,
      review: knowledge.filter(function(row) {
        return String(row.status || '').trim().toUpperCase() === 'REVIEW';
      }).length,
      excluded: knowledge.filter(function(row) {
        return String(row.status || '').trim().toUpperCase() === 'EXCLUDED';
      }).length,
      image_connected: imageConnected,
      image_missing: knowledge.length - imageConnected,
      embedding_ready: approved.filter(function(row) {
        return activeEmbeddingIds.has(String(row.knowledge_id || ''));
      }).length,
      embedding_missing: approved.filter(function(row) {
        return !activeEmbeddingIds.has(String(row.knowledge_id || ''));
      }).length,
      duplicate_ids: validation.duplicate_ids.length,
      blank_ids: validation.blank_rows.length
    },
    status: objectToSeries(countByField(knowledge, 'status', '미지정')),
    malls: topSeries(countByField(knowledge, 'mall', '미분류'), 10),
    domains: topSeries(countByField(knowledge, 'domain', '미분류'), 12),
    sub_domains: topSeries(countByField(knowledge, 'sub_domain', '미분류'), 12),
    knowledge_types: topSeries(
      countByField(knowledge, 'knowledge_type', '미분류'),
      12
    ),
    sources: topSeries(countByField(knowledge, 'source_file', '미분류'), 10)
  };
}

function getFeedbackAnalytics(days) {
  requireAdmin();

  const rangeDays = clampAdminDays(days || 30);
  const cutoff = new Date(Date.now() - rangeDays * 86400000);
  const feedbackRows = getRowsAsObjects(SHEET_NAMES.FEEDBACK_LOGS).filter(
    function(row) {
      return toDateValue(row.created_at) >= cutoff;
    }
  );
  const chats = getRowsAsObjects(SHEET_NAMES.CHAT_LOGS);
  const chatMap = {};

  chats.forEach(function(row) {
    chatMap[String(row.log_id || '')] = row;
  });

  const ratings = countFeedbackRatings(feedbackRows);
  const problemDomainMap = {};
  const dailyMap = {};
  const recentProblems = [];

  feedbackRows.forEach(function(row) {
    const rating = String(row.rating || '').trim().toUpperCase();
    const chat = chatMap[String(row.log_id || '')] || {};
    const day = formatDayKey(row.created_at);

    dailyMap[day] = (dailyMap[day] || 0) + 1;

    if (rating === 'BAD' || rating === 'NEED_REVIEW') {
      const domain = String(chat.domain_detected || '미분류').trim() || '미분류';
      problemDomainMap[domain] = (problemDomainMap[domain] || 0) + 1;

      recentProblems.push({
        created_at: serializeValueForClient(row.created_at),
        rating: rating,
        question: truncateAdminText(chat.question || '', 180),
        domain: domain,
        comment: truncateAdminText(row.comment || '', 120)
      });
    }
  });

  return {
    period_days: rangeDays,
    cards: {
      total: feedbackRows.length,
      good: ratings.GOOD,
      bad: ratings.BAD,
      need_review: ratings.NEED_REVIEW,
      positive_rate: feedbackRows.length
        ? Math.round((ratings.GOOD / feedbackRows.length) * 100)
        : 0
    },
    distribution: objectToSeries(ratings),
    daily: objectToSortedSeries(dailyMap, false),
    problem_domains: topSeries(problemDomainMap, 10),
    recent_problems: recentProblems
      .sort(function(a, b) {
        return String(b.created_at).localeCompare(String(a.created_at));
      })
      .slice(0, 20)
  };
}

function getConversationAnalytics(days) {
  requireAdmin();

  const rangeDays = clampAdminDays(days || 30);
  const cutoff = new Date(Date.now() - rangeDays * 86400000);
  const chats = getRowsAsObjects(SHEET_NAMES.CHAT_LOGS).filter(function(row) {
    return toDateValue(row.created_at) >= cutoff;
  });

  const todayKey = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const todayCount = chats.filter(function(row) {
    return formatFullDayKey(row.created_at) === todayKey;
  }).length;

  return {
    period_days: rangeDays,
    cards: {
      total: chats.length,
      today: todayCount,
      avg_response_ms: averageNumericValue(chats, 'response_time_ms'),
      avg_search_ms: averageNumericValue(chats, 'search_time_ms'),
      avg_generation_ms: averageNumericValue(chats, 'generation_time_ms'),
      no_answer: chats.filter(function(row) {
        return Number(row.top_score || 0) === 0;
      }).length,
      sessions: new Set(
        chats
          .map(function(row) {
            return String(row.session_id || '');
          })
          .filter(Boolean)
      ).size
    },
    daily: buildDailySeries(chats, rangeDays),
    search_modes: objectToSeries(countByField(chats, 'search_mode', 'UNKNOWN')),
    domains: topSeries(countByField(chats, 'domain_detected', '미분류'), 12),
    hourly: buildHourlySeries(chats),
    response_buckets: buildResponseTimeBuckets(chats)
  };
}

function getErrorAnalytics(days) {
  requireAdmin();

  const rangeDays = clampAdminDays(days || 30);
  const now = Date.now();
  const cutoff = new Date(now - rangeDays * 86400000);
  const cutoff24 = new Date(now - 86400000);
  const rows = getRowsAsObjects(SHEET_NAMES.ERROR_LOGS).filter(function(row) {
    return toDateValue(row.created_at) >= cutoff;
  });

  const categories = {
    OPENAI_API: 0,
    PERMISSION: 0,
    IMAGE: 0,
    SHEET: 0,
    OTHER: 0
  };

  rows.forEach(function(row) {
    categories[classifyError(row)]++;
  });

  const recent = rows
    .sort(function(a, b) {
      return toDateValue(b.created_at) - toDateValue(a.created_at);
    })
    .slice(0, 20)
    .map(function(row) {
      return {
        created_at: serializeValueForClient(row.created_at),
        function_name: String(row.function_name || ''),
        category: classifyError(row),
        message: truncateAdminText(row.error_message || '', 220)
      };
    });

  return {
    period_days: rangeDays,
    cards: {
      total: rows.length,
      last_24_hours: rows.filter(function(row) {
        return toDateValue(row.created_at) >= cutoff24;
      }).length,
      openai: categories.OPENAI_API,
      permission: categories.PERMISSION,
      image: categories.IMAGE,
      sheet: categories.SHEET
    },
    functions: topSeries(countByField(rows, 'function_name', '미분류'), 12),
    categories: objectToSeries(categories),
    daily: buildDailySeries(rows, rangeDays),
    recent: recent
  };
}

function getModelSettings() {
  requireAdmin();

  const config = getAllConfig();
  const rows = getRowsAsObjects(SHEET_NAMES.MODEL_CONFIG);
  const descriptionMap = {};

  rows.forEach(function(row) {
    descriptionMap[String(row.config_key || '')] = String(row.description || '');
  });

  const keys = [
    'answer_model',
    'embedding_model',
    'top_k',
    'similarity_threshold',
    'temperature',
    'max_context_count',
    'use_only_approved',
    'history_turns',
    'answer_max_tokens',
    'exact_match_enabled',
    'search_cache_seconds'
  ];

  return keys.map(function(key) {
    return {
      key: key,
      value: config[key],
      description: descriptionMap[key] || '',
      type: getConfigInputType(key),
      options: getConfigOptions(key)
    };
  });
}

function saveModelSettings(settings) {
  requireAdmin();

  if (!settings || typeof settings !== 'object') {
    throw new Error('저장할 모델 설정이 없습니다.');
  }

  const currentEmbeddingModel = String(
    getAllConfig().embedding_model || ''
  );

  Object.keys(settings).forEach(function(key) {
    validateConfigValue(key, settings[key]);

    updateRowByKey(
      SHEET_NAMES.MODEL_CONFIG,
      'config_key',
      key,
      {
        config_value: settings[key],
        updated_at: new Date()
      }
    );
  });

  invalidateConfigCache();
  invalidateRagSearchCache();

  const newEmbeddingModel = String(
    settings.embedding_model || currentEmbeddingModel
  );

  return {
    ok: true,
    message: '모델 설정이 저장되어 다음 질문부터 적용됩니다.',
    requires_reembedding: newEmbeddingModel !== currentEmbeddingModel
  };
}

function getActivePromptSettings() {
  requireAdmin();

  const rows = getRowsAsObjects(SHEET_NAMES.PROMPTS);
  const row =
    rows.find(function(item) {
      return (
        String(item.prompt_type || '') === 'answer' &&
        String(item.status || '').trim().toUpperCase() === 'ACTIVE'
      );
    }) ||
    rows.find(function(item) {
      return String(item.prompt_id || '') === 'answer_default';
    });

  if (!row) {
    throw new Error('답변 프롬프트를 찾을 수 없습니다.');
  }

  return serializeValueForClient({
    prompt_id: row.prompt_id,
    prompt_name: row.prompt_name,
    prompt_text: row.prompt_text,
    version: row.version,
    status: row.status,
    updated_at: row.updated_at
  });
}

function saveActivePromptSettings(promptId, promptText) {
  requireAdmin();

  const text = String(promptText || '').trim();

  if (!text) {
    throw new Error('프롬프트 내용을 입력하세요.');
  }

  updateRowByKey(
    SHEET_NAMES.PROMPTS,
    'prompt_id',
    promptId,
    {
      prompt_text: text,
      status: 'ACTIVE',
      updated_at: new Date()
    }
  );

  invalidatePromptCache();

  return {
    ok: true,
    message: '프롬프트가 저장되어 다음 답변부터 적용됩니다.'
  };
}

function runUpdateImageUrls() {
  requireAdmin();

  try {
    const result = updateImageUrlsFromDrive();
    invalidateRagSearchCache();
    return result;
  } catch (err) {
    saveErrorLog('runUpdateImageUrls', err, {});

    return {
      success: false,
      message: err && err.message ? err.message : String(err)
    };
  }
}

function runEmbeddingJob(limit) {
  requireAdmin();

  try {
    const result = createEmbeddingsForApproved(limit || 50);
    invalidateRagSearchCache();
    return result;
  } catch (err) {
    saveErrorLog('runEmbeddingJob', err, { limit: limit });

    return {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function runRebuildEmbeddings(limit, confirmationToken) {
  requireAdmin();

  try {
    const result = rebuildAllEmbeddings(
      limit || 50,
      confirmationToken
    );
    invalidateRagSearchCache();
    return result;
  } catch (err) {
    saveErrorLog('runRebuildEmbeddings', err, {
      limit: limit,
      confirmed:
        String(confirmationToken || '') ===
        'FULL_REBUILD'
    });

    return {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function resetRebuildEmbeddingState() {
  requireAdmin();

  try {
    return cancelEmbeddingRebuild();
  } catch (err) {
    saveErrorLog(
      'resetRebuildEmbeddingState',
      err,
      {}
    );

    return {
      ok: false,
      error:
        err && err.message
          ? err.message
          : String(err)
    };
  }
}

function adminTestQuestion(question) {
  requireAdmin();

  return askRagBot(
    question,
    'ADMIN_TEST_' +
      getCurrentUserEmail().replace(/[^a-zA-Z0-9_-]/g, '_')
  );
}

function getConfigInputType(key) {
  if (key === 'use_only_approved' || key === 'exact_match_enabled') {
    return 'select';
  }

  if (
    key === 'top_k' ||
    key === 'max_context_count' ||
    key === 'history_turns' ||
    key === 'answer_max_tokens' ||
    key === 'search_cache_seconds' ||
    key === 'similarity_threshold' ||
    key === 'temperature'
  ) {
    return 'number';
  }

  return 'text';
}

function getConfigOptions(key) {
  if (key === 'use_only_approved' || key === 'exact_match_enabled') {
    return ['TRUE', 'FALSE'];
  }

  return [];
}

function validateConfigValue(key, value) {
  const integerRanges = {
    top_k: [1, 10],
    max_context_count: [1, 8],
    history_turns: [0, 10],
    answer_max_tokens: [200, 1800],
    search_cache_seconds: [0, 1800]
  };

  if (integerRanges[key]) {
    const num = Number(value);
    const range = integerRanges[key];

    if (!Number.isInteger(num) || num < range[0] || num > range[1]) {
      throw new Error(
        key + '는 ' + range[0] + '~' + range[1] + ' 사이 정수여야 합니다.'
      );
    }
  }

  if (key === 'similarity_threshold') {
    const num = Number(value);

    if (!Number.isFinite(num) || num < -1 || num > 1) {
      throw new Error('similarity_threshold는 -1~1 사이 숫자여야 합니다.');
    }
  }

  if (key === 'temperature') {
    const num = Number(value);

    if (!Number.isFinite(num) || num < 0 || num > 2) {
      throw new Error('temperature는 0~2 사이 숫자여야 합니다.');
    }
  }

  if (key === 'use_only_approved' || key === 'exact_match_enabled') {
    const normalized = String(value).trim().toUpperCase();

    if (normalized !== 'TRUE' && normalized !== 'FALSE') {
      throw new Error(key + '는 TRUE 또는 FALSE여야 합니다.');
    }
  }

  if (
    (key === 'answer_model' || key === 'embedding_model') &&
    String(value || '').trim() === ''
  ) {
    throw new Error(key + ' 값은 비워둘 수 없습니다.');
  }
}

function hasKnowledgeImage(row) {
  return (
    String(row.image_url || '').trim() !== '' ||
    String(row.image_file_name || '').trim() !== '' ||
    String(row.image_file_path || '').trim() !== ''
  );
}

function countFeedbackRatings(rows) {
  const counts = {
    GOOD: 0,
    BAD: 0,
    NEED_REVIEW: 0
  };

  (rows || []).forEach(function(row) {
    const rating = String(row.rating || '').trim().toUpperCase();

    if (Object.prototype.hasOwnProperty.call(counts, rating)) {
      counts[rating]++;
    }
  });

  return counts;
}

function countByField(rows, field, fallback) {
  const output = {};

  (rows || []).forEach(function(row) {
    const key = String(row[field] || '').trim() || fallback;
    output[key] = (output[key] || 0) + 1;
  });

  return output;
}

function objectToSeries(map) {
  return Object.keys(map || {})
    .map(function(key) {
      return {
        label: key,
        value: map[key]
      };
    })
    .sort(function(a, b) {
      return b.value - a.value;
    });
}

function objectToSortedSeries(map, sortByValue) {
  const rows = Object.keys(map || {}).map(function(key) {
    return {
      label: key,
      value: map[key]
    };
  });

  return rows.sort(
    sortByValue
      ? function(a, b) {
          return b.value - a.value;
        }
      : function(a, b) {
          return a.label.localeCompare(b.label);
        }
  );
}

function topSeries(map, limit) {
  return objectToSeries(map).slice(0, limit || 10);
}

function buildDailySeries(rows, rangeDays) {
  const output = {};
  const timezone = Session.getScriptTimeZone();

  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    const date = new Date(Date.now() - offset * 86400000);
    const key = Utilities.formatDate(date, timezone, 'MM-dd');
    output[key] = 0;
  }

  (rows || []).forEach(function(row) {
    const key = Utilities.formatDate(
      toDateValue(row.created_at),
      timezone,
      'MM-dd'
    );

    if (Object.prototype.hasOwnProperty.call(output, key)) {
      output[key]++;
    }
  });

  return objectToSortedSeries(output, false);
}

function buildHourlySeries(rows) {
  const output = {};

  for (let hour = 0; hour < 24; hour++) {
    output[String(hour).padStart(2, '0') + '시'] = 0;
  }

  (rows || []).forEach(function(row) {
    const hour = Utilities.formatDate(
      toDateValue(row.created_at),
      Session.getScriptTimeZone(),
      'HH'
    ) + '시';

    output[hour] = (output[hour] || 0) + 1;
  });

  return objectToSortedSeries(output, false);
}

function buildResponseTimeBuckets(rows) {
  const buckets = {
    '3초 이하': 0,
    '3~6초': 0,
    '6~10초': 0,
    '10초 초과': 0
  };

  (rows || []).forEach(function(row) {
    const ms = Number(row.response_time_ms || 0);

    if (ms <= 3000) buckets['3초 이하']++;
    else if (ms <= 6000) buckets['3~6초']++;
    else if (ms <= 10000) buckets['6~10초']++;
    else buckets['10초 초과']++;
  });

  return objectToSeries(buckets);
}

function averageNumericValue(rows, field) {
  let sum = 0;
  let count = 0;

  (rows || []).forEach(function(row) {
    const value = Number(row[field]);

    if (Number.isFinite(value)) {
      sum += value;
      count++;
    }
  });

  return count ? Math.round(sum / count) : 0;
}

function classifyError(row) {
  const text = [
    row.function_name,
    row.error_message
  ].join(' ').toLowerCase();

  if (
    text.indexOf('openai') >= 0 ||
    text.indexOf('http 429') >= 0 ||
    text.indexOf('api') >= 0
  ) {
    return 'OPENAI_API';
  }

  if (
    text.indexOf('권한') >= 0 ||
    text.indexOf('permission') >= 0 ||
    text.indexOf('admin') >= 0
  ) {
    return 'PERMISSION';
  }

  if (
    text.indexOf('image') >= 0 ||
    text.indexOf('drive') >= 0 ||
    text.indexOf('이미지') >= 0
  ) {
    return 'IMAGE';
  }

  if (
    text.indexOf('sheet') >= 0 ||
    text.indexOf('시트') >= 0 ||
    text.indexOf('column') >= 0
  ) {
    return 'SHEET';
  }

  return 'OTHER';
}

function clampAdminDays(value) {
  return Math.max(1, Math.min(90, Math.floor(Number(value || 30))));
}

function formatDayKey(value) {
  return Utilities.formatDate(
    toDateValue(value),
    Session.getScriptTimeZone(),
    'MM-dd'
  );
}

function formatFullDayKey(value) {
  return Utilities.formatDate(
    toDateValue(value),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}

function toDateValue(value) {
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function truncateAdminText(value, limit) {
  const text = String(value || '');

  return text.length > limit
    ? text.slice(0, limit) + '…'
    : text;
}

function serializeRowsForClient(rows) {
  return (rows || []).map(function(row) {
    return serializeValueForClient(row);
  });
}

function serializeValueForClient(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(function(item) {
      return serializeValueForClient(item);
    });
  }

  if (value && typeof value === 'object') {
    const output = {};

    Object.keys(value).forEach(function(key) {
      output[key] = serializeValueForClient(value[key]);
    });

    return output;
  }

  if (value === undefined) return '';
  return value;
}

/**
 * 시간 기반 트리거 전용 임베딩 작업
 * 관리자 화면 호출용 함수와 분리한다.
 */
function runEmbeddingTriggerJob() {
  const result = createEmbeddingsForApproved(50);

  console.log(JSON.stringify(result));

  if (!result || !result.ok) {
    throw new Error(
      result && result.error
        ? result.error
        : '임베딩 작업에 실패했습니다.'
    );
  }

  console.log(
    '처리: ' + Number(result.processed || 0) +
    '건 / 남음: ' + Number(result.remaining || 0) + '건'
  );

  /*
   * 처리 대상이 모두 끝나면 등록된 트리거를 자동 삭제한다.
   */
  if (Number(result.remaining || 0) === 0) {
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (
        trigger.getHandlerFunction() ===
        'runEmbeddingTriggerJob'
      ) {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    console.log('전체 임베딩 완료. 시간 트리거를 삭제했습니다.');
  }

  return result;
}