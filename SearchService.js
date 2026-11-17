const RAG_SEARCH_CACHE_VERSION_PROPERTY = 'RAG_SEARCH_CACHE_VERSION';

function searchKnowledge(question, contextualQuestion) {
  const start = Date.now();
  const normalizedQuestion = normalizeSearchText(question);

  if (!normalizedQuestion) {
    throw new Error('검색 질문이 비어 있습니다.');
  }

  const config = getAllConfig();
  const knowledgeRows = getSearchableKnowledge();

  if (config.exact_match_enabled) {
    const exactResults = findExactKnowledgeMatches(
      normalizedQuestion,
      knowledgeRows,
      config.top_k
    );

    if (exactResults.length > 0) {
      return {
        question: question,
        search_query: question,
        results: exactResults,
        elapsed_ms: Date.now() - start,
        embedding_model: config.embedding_model,
        search_mode: 'EXACT'
      };
    }
  }

  const queryText = String(contextualQuestion || question).trim();
  const cached = getCachedSearchResult(queryText, config);

  if (cached) {
    cached.elapsed_ms = Date.now() - start;
    cached.search_mode = 'VECTOR_CACHE';
    return cached;
  }

  const questionEmbedding = callOpenAIEmbedding(queryText);
  const currentModel = config.embedding_model;

  const activeRows = getRowsAsObjects(SHEET_NAMES.EMBEDDINGS).filter(
    function(row) {
      return (
        String(row.status || '').trim().toUpperCase() === 'ACTIVE' &&
        String(row.embedding_model || '').trim() === currentModel
      );
    }
  );

  const bestScoreByKnowledgeId = {};

  activeRows.forEach(function(row) {
    const vector = safeJsonParse(row.embedding_json, null);
    if (!Array.isArray(vector)) return;

    const score = cosineSimilarity(questionEmbedding, vector);
    if (score < config.similarity_threshold) return;

    const knowledgeId = String(row.knowledge_id);

    if (
      bestScoreByKnowledgeId[knowledgeId] === undefined ||
      score > bestScoreByKnowledgeId[knowledgeId]
    ) {
      bestScoreByKnowledgeId[knowledgeId] = score;
    }
  });

  const scored = Object.keys(bestScoreByKnowledgeId)
    .map(function(knowledgeId) {
      return {
        knowledge_id: knowledgeId,
        score: bestScoreByKnowledgeId[knowledgeId]
      };
    })
    .sort(function(a, b) {
      return b.score - a.score;
    })
    .slice(0, config.top_k);

  const knowledgeMap = {};

  knowledgeRows.forEach(function(knowledge) {
    knowledgeMap[String(knowledge.knowledge_id)] = knowledge;
  });

  const results = scored
    .map(function(item) {
      return {
        knowledge_id: item.knowledge_id,
        score: item.score,
        knowledge: knowledgeMap[String(item.knowledge_id)] || null
      };
    })
    .filter(function(item) {
      return item.knowledge !== null;
    });

  const response = {
    question: question,
    search_query: queryText,
    results: results,
    elapsed_ms: Date.now() - start,
    embedding_model: currentModel,
    search_mode: 'VECTOR'
  };

  putCachedSearchResult(queryText, config, response);
  return response;
}

function findExactKnowledgeMatches(normalizedQuestion, knowledgeRows, limit) {
  const matches = [];

  knowledgeRows.forEach(function(knowledge) {
    const storedQuestion = normalizeSearchText(knowledge.question);
    const title = normalizeSearchText(knowledge.title);
    let score = 0;

    if (storedQuestion && storedQuestion === normalizedQuestion) {
      score = 1;
    } else if (title && title === normalizedQuestion) {
      score = 0.995;
    }

    if (score > 0) {
      matches.push({
        knowledge_id: knowledge.knowledge_id,
        score: score,
        knowledge: knowledge
      });
    }
  });

  return matches
    .sort(function(a, b) {
      return b.score - a.score;
    })
    .slice(0, limit);
}

function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.,。！？]/g, '');
}

function buildSearchCacheKey(queryText, config) {
  const version =
    PropertiesService.getScriptProperties().getProperty(
      RAG_SEARCH_CACHE_VERSION_PROPERTY
    ) || '1';

  const raw = [
    version,
    config.embedding_model,
    config.top_k,
    config.similarity_threshold,
    normalizeSearchText(queryText)
  ].join('|');

  return 'RAG_SEARCH_' + createTextHash(raw).slice(0, 40);
}

function getCachedSearchResult(queryText, config) {
  if (!config.search_cache_seconds || config.search_cache_seconds < 1) {
    return null;
  }

  const cached = CacheService.getScriptCache().get(
    buildSearchCacheKey(queryText, config)
  );

  return cached ? safeJsonParse(cached, null) : null;
}

function putCachedSearchResult(queryText, config, result) {
  if (!config.search_cache_seconds || config.search_cache_seconds < 1) {
    return;
  }

  try {
    CacheService.getScriptCache().put(
      buildSearchCacheKey(queryText, config),
      JSON.stringify(result),
      config.search_cache_seconds
    );
  } catch (err) {}
}

function invalidateRagSearchCache() {
  const properties = PropertiesService.getScriptProperties();
  const current = Number(
    properties.getProperty(RAG_SEARCH_CACHE_VERSION_PROPERTY) || 1
  );

  properties.setProperty(
    RAG_SEARCH_CACHE_VERSION_PROPERTY,
    String(current + 1)
  );
}

function cosineSimilarity(vecA, vecB) {
  if (
    !Array.isArray(vecA) ||
    !Array.isArray(vecB) ||
    vecA.length !== vecB.length
  ) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < vecA.length; index++) {
    const a = Number(vecA[index]);
    const b = Number(vecB[index]);

    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;

    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function testSearch(question) {
  requireAdmin();
  return searchKnowledge(
    question || 'PG 결제는 어떤 순서로 진행돼?',
    ''
  );
}