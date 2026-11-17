const PROMPT_CACHE_KEY =
  'ELAND_OPS_ACTIVE_PROMPT_V3';

function askRagBot(
  question,
  sessionId,
  clientHistory,
  sessionToken
) {
  const totalStart = Date.now();

  try {
    const accessUser = requireChatAccess_(sessionToken);
    const normalizedQuestion = String(
      question || ''
    ).trim();

    if (!normalizedQuestion) {
      throw new Error('질문을 입력하세요.');
    }
    if (normalizedQuestion.length > 3000) {
      throw new Error('질문은 3,000자 이하로 입력하세요.');
    }
    const historyJson = JSON.stringify(clientHistory || []);
    if (historyJson.length > 30000) {
      throw new Error('대화 이력이 너무 깁니다. 새 대화를 시작해 주세요.');
    }
    rateLimit_('QUESTION', getRateIdentity_(accessUser ? accessUser.user_id : sessionId), 8, 60);

    const normalizedSessionId =
      normalizeSessionId(sessionId);

    const config = getAllConfig();

    const history = resolveConversationHistory(
      normalizedSessionId,
      clientHistory,
      config.history_turns
    );

    const casualResponse =
      buildCasualConversationResponse(
        normalizedQuestion
      );

    if (casualResponse) {
      return finalizeCasualAnswer(
        normalizedQuestion,
        normalizedSessionId,
        casualResponse,
        totalStart
      );
    }

    const standaloneQuestion =
      rewriteQuestionWithConversationContext(
        normalizedQuestion,
        history,
        config
      );

    const searchStart = Date.now();

    const searchResult = searchKnowledge(
      normalizedQuestion,
      standaloneQuestion
    );

    const searchTimeMs =
      Date.now() - searchStart;

    const retrieved =
      searchResult.results || [];

    if (retrieved.length === 0) {
      return finalizeNoResultAnswer(
        normalizedQuestion,
        normalizedSessionId,
        history,
        config,
        searchResult,
        searchTimeMs,
        totalStart
      );
    }

    const generationStart = Date.now();

    const sections =
      generateStructuredAnswer(
        normalizedQuestion,
        standaloneQuestion,
        retrieved,
        history,
        config
      );

    const generationTimeMs =
      Date.now() - generationStart;

    const sources = buildSources(retrieved);

    const topScore = retrieved[0]
      ? retrieved[0].score
      : 0;

    const plainAnswer =
      sectionsToPlainText(sections);

    const logId = saveChatLog({
      session_id: normalizedSessionId,
      turn_no: getNextTurnNumber(
        normalizedSessionId
      ),
      user_email: getCurrentUserEmail(),
      question: normalizedQuestion,
      answer: plainAnswer,
      answer_sections_json:
        JSON.stringify(sections),
      retrieved_ids: retrieved
        .map(function(item) {
          return item.knowledge_id;
        })
        .join(','),
      top_score: topScore,
      domain_detected:
        retrieved[0] &&
        retrieved[0].knowledge
          ? retrieved[0].knowledge.domain || ''
          : '',
      model_used: config.answer_model,
      prompt_id: 'answer_default',
      search_mode:
        searchResult.search_mode,
      search_time_ms: searchTimeMs,
      generation_time_ms:
        generationTimeMs,
      response_time_ms:
        Date.now() - totalStart
    });

    return {
      ok: true,
      log_id: logId,
      session_id:
        normalizedSessionId,
      answer: plainAnswer,
      sections: sections,
      sources: sources,
      top_score: topScore,
      standalone_question:
        standaloneQuestion,
      timing: {
        search_ms: searchTimeMs,
        generation_ms:
          generationTimeMs,
        total_ms:
          Date.now() - totalStart,
        search_mode:
          searchResult.search_mode
      }
    };
  } catch (err) {
    saveErrorLog(
      'askRagBot',
      err,
      {
        question: question,
        sessionId: sessionId
      }
    );

    return {
      ok: false,
      answer:
        getUserFriendlyErrorMessage(err),
      sections: null,
      sources: []
    };
  }
}

function buildCasualConversationResponse(
  question
) {
  const normalized = String(question || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]/g, '');

  const greetingPatterns = [
    /^안녕$/,
    /^안녕하세요$/,
    /^하이$/,
    /^반가워$/,
    /^반갑습니다$/,
    /^좋은 아침$/,
    /^좋은 오후$/,
    /^좋은 저녁$/
  ];

  if (
    greetingPatterns.some(function(pattern) {
      return pattern.test(normalized);
    })
  ) {
    return {
      summary:
        '안녕하세요. 무엇을 도와드릴까요?',
      detail:
        '이랜드몰·키디키디의 운영 정책, 메뉴 경로, 처리 방법, 오류 대응을 질문해 주세요. 현재 화면에서 이어서 질문하면 앞선 대화의 대상과 맥락을 반영합니다.'
    };
  }

  if (
    /^(고마워|감사해|감사합니다|도움됐어|수고했어)$/.test(
      normalized
    )
  ) {
    return {
      summary:
        '도움이 되었다니 다행입니다.',
      detail:
        '이어서 궁금한 내용을 말씀해 주세요.'
    };
  }

  if (
    /(너는 무엇을 알려줄 수|뭘 알려줄 수|무엇을 할 수|어떤 걸 도와|사용 방법|너는 누구)/.test(
      normalized
    )
  ) {
    return {
      summary:
        '이랜드몰·키디키디 운영자를 위한 AI 지식봇입니다.',
      detail:
        '상품·주문·전시·검색·회원·프로모션·운영 정책과 메뉴 경로, 오류 처리 방법을 안내합니다. 첫 질문 뒤에 “그 메뉴는 어디야?”, “그다음은?”처럼 이어서 질문해도 됩니다.'
    };
  }

  return null;
}

function finalizeCasualAnswer(
  question,
  sessionId,
  casualResponse,
  totalStart
) {
  const sections = {
    summary: casualResponse.summary,
    detail: casualResponse.detail,
    steps: [],
    caution: ''
  };

  const plainAnswer =
    sectionsToPlainText(sections);

  const logId = saveChatLog({
    session_id: sessionId,
    turn_no: getNextTurnNumber(
      sessionId
    ),
    user_email: getCurrentUserEmail(),
    question: question,
    answer: plainAnswer,
    answer_sections_json:
      JSON.stringify(sections),
    retrieved_ids: '',
    top_score: 0,
    domain_detected: 'CASUAL',
    model_used: 'RULE_BASED',
    prompt_id: '',
    search_mode: 'CASUAL',
    search_time_ms: 0,
    generation_time_ms: 0,
    response_time_ms:
      Date.now() - totalStart
  });

  return {
    ok: true,
    log_id: logId,
    session_id: sessionId,
    answer: plainAnswer,
    sections: sections,
    sources: [],
    top_score: 0,
    timing: {
      search_ms: 0,
      generation_ms: 0,
      total_ms:
        Date.now() - totalStart,
      search_mode: 'CASUAL'
    }
  };
}

function rewriteQuestionWithConversationContext(
  question,
  history,
  config
) {
  if (!history || history.length === 0) {
    return question;
  }

  const recentConversation = history
    .slice(-5)
    .map(function(turn, index) {
      return [
        '대화 ' + (index + 1),
        '사용자: ' +
          truncateText(
            turn.question || '',
            700
          ),
        '도우미: ' +
          truncateText(
            turn.answer || '',
            1400
          )
      ].join('\n');
    })
    .join('\n\n');

  const messages = [
    {
      role: 'system',
      content: [
        '너는 연속 대화의 현재 질문을 RAG 검색용 독립 질문으로 재작성한다.',
        '이전 대화에서 생략된 대상, 화면, 메뉴, 정책, 오류 상황을 현재 질문에 반드시 보완한다.',
        '“그거”, “그 메뉴”, “그러면”, “그다음”, “왜”, “어디” 같은 표현의 대상을 이전 대화에서 찾아 명시한다.',
        '현재 질문이 이전 대화와 무관할 때만 현재 질문을 그대로 반환한다.',
        '답변이나 설명을 쓰지 말고 검색할 독립 질문 한 문장만 반환한다.',
        '한국어로 작성한다.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '<RECENT_CONVERSATION>',
        recentConversation,
        '</RECENT_CONVERSATION>',
        '',
        '<CURRENT_QUESTION>',
        question,
        '</CURRENT_QUESTION>'
      ].join('\n')
    }
  ];

  try {
    const rewritten = callOpenAIChat(
      messages,
      {
        model: config.answer_model,
        temperature: 0,
        maxCompletionTokens: 220
      }
    );

    const cleaned = String(
      rewritten || ''
    )
      .trim()
      .replace(/^["']|["']$/g, '');

    return cleaned || question;
  } catch (err) {
    return buildFallbackContextQuestion(
      question,
      history
    );
  }
}

function buildFallbackContextQuestion(
  question,
  history
) {
  const recent = (history || []).slice(-3);

  return [
    recent
      .map(function(turn) {
        return [
          '이전 질문: ' +
            truncateText(
              turn.question || '',
              500
            ),
          '이전 답변: ' +
            truncateText(
              turn.answer || '',
              900
            )
        ].join('\n');
      })
      .join('\n\n'),
    '현재 후속 질문: ' + question,
    '이전 대화의 대상을 유지하여 검색'
  ]
    .filter(Boolean)
    .join('\n\n');
}

function finalizeNoResultAnswer(
  question,
  sessionId,
  history,
  config,
  searchResult,
  searchTimeMs,
  totalStart
) {
  const sections =
    generateNoResultConversationAnswer(
      question,
      history,
      config
    );

  const plainAnswer =
    sectionsToPlainText(sections);

  const logId = saveChatLog({
    session_id: sessionId,
    turn_no: getNextTurnNumber(
      sessionId
    ),
    user_email: getCurrentUserEmail(),
    question: question,
    answer: plainAnswer,
    answer_sections_json:
      JSON.stringify(sections),
    retrieved_ids: '',
    top_score: 0,
    domain_detected: '',
    model_used: config.answer_model,
    prompt_id: 'answer_default',
    search_mode:
      searchResult.search_mode ||
      'NO_RESULT',
    search_time_ms: searchTimeMs,
    generation_time_ms: 0,
    response_time_ms:
      Date.now() - totalStart
  });

  return {
    ok: true,
    log_id: logId,
    session_id: sessionId,
    answer: plainAnswer,
    sections: sections,
    sources: [],
    top_score: 0,
    timing: {
      search_ms: searchTimeMs,
      generation_ms: 0,
      total_ms:
        Date.now() - totalStart,
      search_mode:
        searchResult.search_mode ||
        'NO_RESULT'
    }
  };
}

function generateStructuredAnswer(
  question,
  standaloneQuestion,
  retrievedResults,
  history,
  config
) {
  const prompt =
    getActivePrompt('answer');

  const context =
    buildContext(retrievedResults);

  const conversation =
    formatConversationHistory(history);

  const messages = [
    {
      role: 'system',
      content: [
        prompt,
        '',
        '반드시 JSON 객체만 반환한다.',
        '사용자 질문에 필요한 항목만 작성하고 불필요한 항목은 생략하거나 빈 값으로 둔다.',
        '가능한 JSON 필드:',
        '{',
        '  "summary": "짧은 핵심 답변이 실제로 필요할 때만 작성",',
        '  "detail": "추가 설명이 필요할 때만 작성",',
        '  "steps": ["실제 처리 순서가 존재할 때만 작성"],',
        '  "caution": "주의할 내용이 실제로 있을 때만 작성"',
        '}',
        '모든 필드를 억지로 채우지 않는다.',
        '간단한 질문은 summary 하나만으로 답해도 된다.',
        '절차형 질문이 아니면 steps를 만들지 않는다.',
        '주의사항이 없으면 caution을 만들지 않는다.',
        '출처와 이미지 정보는 답변 본문에 쓰지 않는다.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '<RECENT_CONVERSATION>',
        conversation ||
          '이전 대화 없음',
        '</RECENT_CONVERSATION>',
        '',
        '<ORIGINAL_QUESTION>',
        question,
        '</ORIGINAL_QUESTION>',
        '',
        '<STANDALONE_QUESTION>',
        standaloneQuestion,
        '</STANDALONE_QUESTION>',
        '',
        '<RAG_CONTEXT>',
        context,
        '</RAG_CONTEXT>',
        '',
        '현재 질문이 앞선 대화를 가리키면 RECENT_CONVERSATION의 대상과 조건을 유지한다.',
        '사실과 처리 방법은 RAG_CONTEXT를 기준으로 답변한다.'
      ].join('\n')
    }
  ];

  const raw = callOpenAIChat(
    messages,
    {
      model: config.answer_model,
      temperature: config.temperature,
      maxCompletionTokens:
        config.answer_max_tokens,
      responseFormat: {
        type: 'json_object'
      }
    }
  );

  return normalizeAnswerSections(
    safeJsonParse(raw, null),
    raw
  );
}

function generateNoResultConversationAnswer(
  question,
  history,
  config
) {
  if (
    /[?？]|어떻게|어디|언제|무엇|뭐|알려|방법|정책|처리|확인/.test(
      question
    )
  ) {
    return {
      summary:
        '현재 등록된 지식에서 정확한 근거를 찾지 못했습니다.',
      detail:
        '질문의 대상이나 화면명, 메뉴명, 오류 메시지를 조금 더 구체적으로 입력해 주세요.',
      steps: [],
      caution:
        '근거가 없는 운영 절차는 임의로 안내하지 않습니다.'
    };
  }

  return {
    summary: '말씀해 주세요.',
    detail:
      '운영 업무와 관련된 질문을 편하게 이어서 입력해 주세요.',
    steps: [],
    caution: ''
  };
}

function normalizeAnswerSections(
  parsed,
  fallbackText
) {
  const fallback = String(
    fallbackText || ''
  ).trim();

  if (
    !parsed ||
    typeof parsed !== 'object'
  ) {
    return {
      summary: '',
      detail: fallback,
      steps: [],
      caution: ''
    };
  }

  const steps =
    Array.isArray(parsed.steps)
      ? parsed.steps
          .map(function(step) {
            return String(
              step || ''
            ).trim();
          })
          .filter(Boolean)
      : [];

  const sections = {
    summary:
      String(parsed.summary || '')
        .trim(),
    detail:
      String(parsed.detail || '')
        .trim(),
    steps: steps,
    caution:
      String(parsed.caution || '')
        .trim()
  };

  if (
    !sections.summary &&
    !sections.detail &&
    sections.steps.length === 0 &&
    !sections.caution
  ) {
    sections.detail =
      fallback ||
      '답변 내용을 생성하지 못했습니다.';
  }

  return sections;
}

function buildContext(
  retrievedResults
) {
  const maxCount =
    getAllConfig().max_context_count;

  return retrievedResults
    .slice(0, maxCount)
    .map(function(result, index) {
      const knowledge =
        result.knowledge;

      return [
        '--- 근거 ' +
          (index + 1) +
          ' ---',
        'knowledge_id: ' +
          (knowledge.knowledge_id || ''),
        'score: ' + result.score,
        'mall: ' +
          (knowledge.mall || ''),
        'domain: ' +
          (knowledge.domain || ''),
        'sub_domain: ' +
          (knowledge.sub_domain || ''),
        'knowledge_type: ' +
          (knowledge.knowledge_type || ''),
        'title: ' +
          (knowledge.title || ''),
        'question: ' +
          (knowledge.question || ''),
        'answer: ' +
          (knowledge.answer || ''),
        'summary: ' +
          (knowledge.summary || ''),
        'process_steps: ' +
          (knowledge.process_steps || ''),
        'menu_path: ' +
          (knowledge.menu_path || ''),
        'caution: ' +
          (knowledge.caution || ''),
        'keywords: ' +
          (knowledge.keywords || '')
      ].join('\n');
    })
    .join('\n\n');
}

function formatConversationHistory(
  history
) {
  return (history || [])
    .map(function(turn) {
      return [
        '사용자: ' +
          (turn.question || ''),
        '도우미: ' +
          truncateText(
            turn.answer || '',
            1800
          )
      ].join('\n');
    })
    .join('\n\n');
}

function getActivePrompt(
  promptType
) {
  const cache =
    CacheService.getScriptCache();

  const cacheKey =
    PROMPT_CACHE_KEY +
    '_' +
    promptType;

  const cached =
    cache.get(cacheKey);

  if (cached) return cached;

  const rows = getRowsAsObjects(
    SHEET_NAMES.PROMPTS
  );

  const prompt = rows.find(
    function(row) {
      return (
        String(row.prompt_type) ===
          String(promptType) &&
        String(row.status || '')
          .trim()
          .toUpperCase() ===
          'ACTIVE'
      );
    }
  );

  const text =
    prompt &&
    prompt.prompt_text
      ? String(prompt.prompt_text)
      : '제공된 근거 데이터만 사용해서 한국어로 정확하고 간결하게 답변하세요.';

  cache.put(
    cacheKey,
    text,
    60
  );

  return text;
}

function invalidatePromptCache() {
  CacheService
    .getScriptCache()
    .remove(
      PROMPT_CACHE_KEY +
        '_answer'
    );
}

function buildSources(
  retrievedResults
) {
  const selected =
    selectCoreSourceResults(
      retrievedResults
    );

  const seen = {};

  return selected
    .map(function(result) {
      const knowledge =
        result.knowledge || {};

      const key = [
        knowledge.knowledge_id || '',
        knowledge.source_file || '',
        knowledge.source_page || '',
        knowledge.title || ''
      ].join('|');

      if (seen[key]) return null;
      seen[key] = true;

      const imageUrl =
        normalizeSafeUrl(
          knowledge.image_url || ''
        );

      const fileId =
        extractDriveFileIdFromUrl(
          imageUrl
        );

      return {
        knowledge_id:
          knowledge.knowledge_id || '',
        title:
          knowledge.title ||
          '참고 자료',
        source_label:
          buildSourceLabel(knowledge),
        image_url: imageUrl,
        image_preview_url:
          fileId
            ? getDriveFileDirectUrl(
                fileId
              )
            : imageUrl,
        score: Number(result.score) || 0
      };
    })
    .filter(Boolean);
}

function selectCoreSourceResults(
  retrievedResults
) {
  const rows = (retrievedResults || [])
    .filter(function(result) {
      return result && result.knowledge;
    })
    .sort(function(a, b) {
      return (
        (Number(b.score) || 0) -
        (Number(a.score) || 0)
      );
    });

  if (!rows.length) return [];

  const topScore =
    Number(rows[0].score) || 0;

  const selected = [rows[0]];
  const seenKnowledge = {};
  const seenDocumentPage = {};

  seenKnowledge[
    String(
      rows[0].knowledge.knowledge_id || ''
    )
  ] = true;

  seenDocumentPage[
    buildSourceDedupeKey_(
      rows[0].knowledge
    )
  ] = true;

  for (
    let index = 1;
    index < rows.length &&
    selected.length < 3;
    index += 1
  ) {
    const result = rows[index];
    const knowledge = result.knowledge;
    const score = Number(result.score) || 0;
    const relativeThreshold =
      topScore > 0
        ? topScore * 0.78
        : 0;

    if (
      score < relativeThreshold &&
      score < 0.45
    ) {
      continue;
    }

    const knowledgeId = String(
      knowledge.knowledge_id || ''
    );

    const documentPageKey =
      buildSourceDedupeKey_(knowledge);

    if (
      knowledgeId &&
      seenKnowledge[knowledgeId]
    ) {
      continue;
    }

    if (
      documentPageKey &&
      seenDocumentPage[documentPageKey]
    ) {
      continue;
    }

    selected.push(result);

    if (knowledgeId) {
      seenKnowledge[knowledgeId] = true;
    }

    if (documentPageKey) {
      seenDocumentPage[
        documentPageKey
      ] = true;
    }
  }

  return selected;
}

function buildSourceDedupeKey_(
  knowledge
) {
  return [
    String(
      knowledge.source_file || ''
    ).trim(),
    String(
      knowledge.source_page || ''
    ).trim(),
    String(
      knowledge.title || ''
    ).trim()
  ].join('|');
}

function buildSourceLabel(
  knowledge
) {
  const page = String(
    knowledge.source_page || ''
  ).trim();

  return page
    ? '근거 문서 · ' +
        page +
        'p'
    : '근거 문서';
}

function normalizeSafeUrl(value) {
  const url = String(value || '')
    .trim();

  return /^https:\/\//i.test(url)
    ? url
    : '';
}

function sectionsToPlainText(
  sections
) {
  const lines = [];

  if (sections.summary) {
    lines.push(
      '[요약]\n' +
        sections.summary
    );
  }

  if (sections.detail) {
    lines.push(
      '[상세 답변]\n' +
        sections.detail
    );
  }

  if (
    sections.steps &&
    sections.steps.length > 0
  ) {
    lines.push(
      '[처리 순서]\n' +
        sections.steps
          .map(function(step, index) {
            return (
              index +
              1 +
              '. ' +
              step
            );
          })
          .join('\n')
    );
  }

  if (sections.caution) {
    lines.push(
      '[주의사항]\n' +
        sections.caution
    );
  }

  return lines.join('\n\n');
}

function truncateText(
  text,
  maxLength
) {
  const value =
    String(text || '');

  return value.length > maxLength
    ? value.slice(0, maxLength) +
        '…'
    : value;
}

function normalizeSessionId(
  sessionId
) {
  const value = String(
    sessionId || ''
  )
    .trim()
    .replace(
      /[^a-zA-Z0-9_-]/g,
      ''
    )
    .slice(0, 80);

  return (
    value ||
    generateId('SESSION')
  );
}

function getUserFriendlyErrorMessage(
  err
) {
  const message =
    err && err.message
      ? String(err.message)
      : String(err);

  if (
    message.indexOf('HTTP 429') >= 0 ||
    message.indexOf(
      'insufficient_quota'
    ) >= 0
  ) {
    return '현재 AI 서비스 요청이 많거나 API 사용 한도 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
  }

  if (
    message.indexOf(
      'OPENAI_API_KEY'
    ) >= 0
  ) {
    return 'AI 서비스 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.';
  }

  return '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}
