const REBUILD_STATE_PROPERTY = 'EMBEDDING_REBUILD_STATE';


/**
 * embeddings 시트의 embedding_hash 컬럼을 자동 점검한다.
 *
 * - 컬럼이 없으면 embedding_text 바로 다음 열에 자동 생성
 * - 기존 행의 embedding_hash가 비어 있으면 embedding_text 기준으로 자동 입력
 * - OpenAI API는 호출하지 않음
 */
function ensureEmbeddingHashReady_() {
  const sheet = getSheet(
    SHEET_NAMES.EMBEDDINGS
  );

  let lastColumn =
    sheet.getLastColumn();

  if (lastColumn < 1) {
    throw new Error(
      'embeddings 시트의 헤더를 찾을 수 없습니다.'
    );
  }

  let headers = sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getValues()[0]
    .map(function(value) {
      return String(value || '').trim();
    });

  const textIndex =
    headers.indexOf(
      'embedding_text'
    );

  if (textIndex < 0) {
    throw new Error(
      'embeddings 시트에 embedding_text 컬럼이 없습니다.'
    );
  }

  let hashIndex =
    headers.indexOf(
      'embedding_hash'
    );

  let columnCreated = false;

  if (hashIndex < 0) {
    /*
     * embedding_text 바로 다음 위치에 새 열을 만든다.
     */
    sheet.insertColumnAfter(
      textIndex + 1
    );

    sheet
      .getRange(
        1,
        textIndex + 2
      )
      .setValue(
        'embedding_hash'
      );

    SpreadsheetApp.flush();

    lastColumn =
      sheet.getLastColumn();

    headers = sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0]
      .map(function(value) {
        return String(value || '').trim();
      });

    hashIndex =
      headers.indexOf(
        'embedding_hash'
      );

    columnCreated = true;
  }

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      columnCreated: columnCreated,
      backfilled: 0,
      totalRows: 0
    };
  }

  const rowCount =
    lastRow - 1;

  const textValues = sheet
    .getRange(
      2,
      textIndex + 1,
      rowCount,
      1
    )
    .getValues();

  const hashValues = sheet
    .getRange(
      2,
      hashIndex + 1,
      rowCount,
      1
    )
    .getValues();

  let backfilled = 0;

  const nextHashValues =
    hashValues.map(
      function(row, index) {
        const currentHash =
          String(
            row[0] || ''
          ).trim();

        if (currentHash) {
          return [
            currentHash
          ];
        }

        const embeddingText =
          String(
            textValues[index][0] ||
            ''
          );

        if (!embeddingText) {
          return [''];
        }

        backfilled += 1;

        return [
          createTextHash(
            embeddingText
          )
        ];
      }
    );

  if (backfilled > 0) {
    sheet
      .getRange(
        2,
        hashIndex + 1,
        rowCount,
        1
      )
      .setValues(
        nextHashValues
      );

    SpreadsheetApp.flush();
  }

  return {
    ok: true,
    columnCreated:
      columnCreated,
    backfilled:
      backfilled,
    totalRows:
      rowCount
  };
}

/**
 * 수동 점검용 관리자 함수.
 * 일반 임베딩 실행 시 자동 처리되므로 보통 직접 실행할 필요는 없다.
 */
function repairEmbeddingHashes() {
  requireAdmin();

  const lock =
    LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    return {
      ok: false,
      error:
        '다른 임베딩 작업이 실행 중입니다. 잠시 후 다시 시도하세요.'
    };
  }

  try {
    const result =
      ensureEmbeddingHashReady_();

    return {
      ok: true,
      message:
        result.columnCreated
          ? 'embedding_hash 컬럼을 만들고 기존 해시값을 채웠습니다.'
          : result.backfilled > 0
            ? '비어 있던 기존 embedding_hash 값을 채웠습니다.'
            : 'embedding_hash 컬럼과 해시값이 정상입니다.',
      columnCreated:
        result.columnCreated,
      backfilled:
        result.backfilled,
      totalRows:
        result.totalRows
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 질문 검색에 영향을 주는 지식 필드를 임베딩용 문자열로 만든다.
 */
function buildEmbeddingText(knowledge) {
  return [
    'mall: ' + (knowledge.mall || ''),
    'domain: ' + (knowledge.domain || ''),
    'sub_domain: ' + (knowledge.sub_domain || ''),
    'type: ' + (knowledge.knowledge_type || ''),
    'title: ' + (knowledge.title || ''),
    'question: ' + (knowledge.question || ''),
    'answer: ' + (knowledge.answer || ''),
    'summary: ' + (knowledge.summary || ''),
    'keywords: ' + (knowledge.keywords || ''),
    'menu_path: ' + (knowledge.menu_path || '')
  ].join('\n');
}

function createTextHash(text) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );

  return digest
    .map(function(byte) {
      const normalized = byte < 0 ? byte + 256 : byte;
      return normalized.toString(16).padStart(2, '0');
    })
    .join('');
}

/**
 * 현재 embeddings 시트를 한 번만 읽어 빠르게 조회할 수 있는 인덱스를 만든다.
 */
function buildActiveEmbeddingIndex(rows) {
  const index = {};

  (rows || []).forEach(function(row) {
    if (
      String(row.status || '').trim().toUpperCase() !==
      'ACTIVE'
    ) {
      return;
    }

    const knowledgeId = String(row.knowledge_id || '');
    if (!knowledgeId) return;

    if (!index[knowledgeId]) {
      index[knowledgeId] = [];
    }

    index[knowledgeId].push(row);
  });

  return index;
}

function hasCurrentEmbedding(
  knowledge,
  activeIndex,
  model
) {
  const knowledgeId = String(knowledge.knowledge_id || '');
  const embeddingText = buildEmbeddingText(knowledge);
  const embeddingHash = createTextHash(embeddingText);
  const rows = activeIndex[knowledgeId] || [];

  return rows.some(function(row) {
    return (
      String(row.embedding_model || '').trim() === model &&
      String(row.embedding_hash || '').trim() ===
        embeddingHash
    );
  });
}

function createEmbeddingForKnowledge(knowledgeId, forceRebuild) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    throw new Error(
      '다른 임베딩 작업이 실행 중입니다. 잠시 후 다시 시도하세요.'
    );
  }

  try {
    ensureEmbeddingHashReady_();

    const knowledge = getKnowledgeById(knowledgeId);

    if (!knowledge) {
      throw new Error(
        '지식데이터를 찾을 수 없습니다: ' + knowledgeId
      );
    }

    const allowedStatuses = new Set(getSearchableStatuses());
    const status = String(knowledge.status || '')
      .trim()
      .toUpperCase();

    if (!allowedStatuses.has(status)) {
      throw new Error(
        '현재 검색 허용 상태의 지식만 임베딩할 수 있습니다: ' +
          knowledgeId
      );
    }

    return createEmbeddingForKnowledgeUnlocked(
      knowledge,
      !!forceRebuild
    );
  } finally {
    lock.releaseLock();
  }
}

function createEmbeddingForKnowledgeUnlocked(
  knowledge,
  forceRebuild
) {
  const knowledgeId = String(knowledge.knowledge_id);
  const embeddingText = buildEmbeddingText(knowledge);
  const embeddingHash = createTextHash(embeddingText);
  const model = String(
    getConfigValue(
      'embedding_model',
      'text-embedding-3-small'
    )
  ).trim();

  const activeRows = getRowsAsObjects(
    SHEET_NAMES.EMBEDDINGS
  ).filter(function(row) {
    return (
      String(row.knowledge_id) === knowledgeId &&
      String(row.status || '').trim().toUpperCase() ===
        'ACTIVE'
    );
  });

  const current = activeRows.find(function(row) {
    return (
      String(row.embedding_model || '').trim() === model &&
      String(row.embedding_hash || '').trim() ===
        embeddingHash
    );
  });

  if (current && !forceRebuild) {
    return {
      ok: true,
      skipped: true,
      knowledge_id: knowledgeId,
      reason:
        '현재 지식내용과 모델에 맞는 ACTIVE 임베딩이 이미 있습니다.'
    };
  }

  /*
   * 새 임베딩 생성에 실패하면 기존 ACTIVE 임베딩은 유지된다.
   */
  const embedding = callOpenAIEmbedding(embeddingText);

  deactivateActiveEmbeddingsUnlocked(
    knowledgeId,
    activeRows
  );

  saveEmbedding(
    knowledgeId,
    embeddingText,
    embeddingHash,
    embedding,
    model
  );

  return {
    ok: true,
    skipped: false,
    knowledge_id: knowledgeId,
    dimensions: embedding.length,
    embedding_model: model
  };
}

function createEmbeddingsForApproved(limit) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    return {
      ok: false,
      error:
        '다른 임베딩 작업이 실행 중입니다. 잠시 후 다시 시도하세요.'
    };
  }

  try {
    const hashRepair =
      ensureEmbeddingHashReady_();

    const maxCount = Math.max(
      1,
      Math.floor(Number(limit || 50))
    );
    const searchable = getSearchableKnowledge();
    const embeddingRows = getRowsAsObjects(
      SHEET_NAMES.EMBEDDINGS
    );
    const activeIndex = buildActiveEmbeddingIndex(
      embeddingRows
    );
    const model = String(
      getConfigValue(
        'embedding_model',
        'text-embedding-3-small'
      )
    ).trim();

    const refreshTargets = searchable.filter(
      function(knowledge) {
        return !hasCurrentEmbedding(
          knowledge,
          activeIndex,
          model
        );
      }
    );

    const target = refreshTargets.slice(0, maxCount);
    const results = [];

    target.forEach(function(knowledge) {
      try {
        /*
         * 배치 잠금이 이미 있으므로 내부 함수는 추가 잠금을 잡지 않는다.
         */
        results.push(
          createEmbeddingForKnowledgeUnlocked(
            knowledge,
            false
          )
        );
      } catch (err) {
        saveErrorLog(
          'createEmbeddingsForApproved',
          err,
          {
            knowledge_id: knowledge.knowledge_id
          }
        );

        results.push({
          ok: false,
          knowledge_id: knowledge.knowledge_id,
          error:
            err && err.message
              ? err.message
              : String(err)
        });
      }
    });

    return {
      ok: true,
      hashRepair: hashRepair,
      totalSearchable: searchable.length,
      processed: results.length,
      remaining: Math.max(
        0,
        refreshTargets.length - target.length
      ),
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}

function rebuildAllEmbeddings(limit, confirmationToken) {
  if (
    String(confirmationToken || '').trim() !==
    'FULL_REBUILD'
  ) {
    return {
      ok: false,
      requiresConfirmation: true,
      error:
        '전체 강제 재임베딩 확인값이 없습니다. ' +
        '일반 임베딩은 createEmbeddingsForApproved를 사용하세요.'
    };
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    return {
      ok: false,
      error:
        '다른 임베딩 작업이 실행 중입니다. 잠시 후 다시 시도하세요.'
    };
  }

  try {
    const hashRepair =
      ensureEmbeddingHashReady_();

    const batchSize = Math.max(
      1,
      Math.floor(Number(limit || 50))
    );
    const properties =
      PropertiesService.getScriptProperties();
    const model = String(
      getConfigValue(
        'embedding_model',
        'text-embedding-3-small'
      )
    ).trim();

    /*
     * knowledge_id 순서가 변경되어도 배치 진행이 꼬이지 않도록
     * 항상 ID 기준으로 정렬하고 전체 목록 fingerprint를 저장한다.
     */
const searchable = getSearchableKnowledge().sort(
  function(a, b) {
    return String(a.knowledge_id).localeCompare(
      String(b.knowledge_id)
    );
  }
);

    const knowledgeIds = searchable.map(function(row) {
      return String(row.knowledge_id);
    });

    const datasetFingerprint = createTextHash(
      model + '\n' + knowledgeIds.join('\n')
    );

    let state = safeJsonParse(
      properties.getProperty(REBUILD_STATE_PROPERTY),
      null
    );

    if (
      state &&
      state.completed &&
      state.fingerprint === datasetFingerprint &&
      state.model === model
    ) {
      return {
        ok: true,
        hashRepair: hashRepair,
        batchProcessed: 0,
        processedTotal: state.total || searchable.length,
        total: state.total || searchable.length,
        remaining: 0,
        completed: true,
        results: [],
        message:
          '현재 데이터셋의 전체 재임베딩이 이미 완료되었습니다. ' +
          '같은 데이터를 처음부터 다시 처리하려면 관리자 화면에서 ' +
          '전체 재임베딩 진행 상태를 먼저 초기화하세요.'
      };
    }

    if (
      !state ||
      state.fingerprint !== datasetFingerprint ||
      state.model !== model
    ) {
      state = {
        offset: 0,
        total: searchable.length,
        model: model,
        fingerprint: datasetFingerprint,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed: false
      };

      properties.setProperty(
        REBUILD_STATE_PROPERTY,
        JSON.stringify(state)
      );
    }

    const batch = searchable.slice(
      state.offset,
      state.offset + batchSize
    );
    const results = [];

    batch.forEach(function(knowledge) {
      try {
        results.push(
          createEmbeddingForKnowledgeUnlocked(
            knowledge,
            true
          )
        );
      } catch (err) {
        saveErrorLog('rebuildAllEmbeddings', err, {
          knowledge_id: knowledge.knowledge_id
        });

        results.push({
          ok: false,
          knowledge_id: knowledge.knowledge_id,
          error:
            err && err.message
              ? err.message
              : String(err)
        });
      }
    });

    /*
     * 실패 건도 결과에 남기되 진행 위치는 다음 배치로 이동한다.
     * 실패 건은 이후 "필요한 임베딩 생성"에서 다시 감지된다.
     */
    state.offset += batch.length;
    state.completed = state.offset >= state.total;
    state.updated_at = new Date().toISOString();

    /*
     * 완료 상태도 저장한다.
     * 같은 데이터셋에서 버튼을 다시 눌러도 처음부터 재실행되지 않는다.
     * 의도적으로 다시 시작하려면 cancelEmbeddingRebuild()로 상태를
     * 초기화한 뒤 실행해야 한다.
     */
    properties.setProperty(
      REBUILD_STATE_PROPERTY,
      JSON.stringify(state)
    );

    return {
      ok: true,
      hashRepair: hashRepair,
      batchProcessed: batch.length,
      processedTotal: Math.min(
        state.offset,
        state.total
      ),
      total: state.total,
      remaining: Math.max(
        0,
        state.total - state.offset
      ),
      completed: state.completed,
      results: results,
      message: state.completed
        ? '전체 재임베딩이 완료되었습니다.'
        : '이번 배치가 완료되었습니다. 같은 버튼을 다시 눌러 다음 배치를 진행하세요.'
    };
  } finally {
    lock.releaseLock();
  }
}

function cancelEmbeddingRebuild() {
  requireAdmin();

  PropertiesService.getScriptProperties().deleteProperty(
    REBUILD_STATE_PROPERTY
  );

  return {
    ok: true,
    message: '전체 재임베딩 진행 상태가 초기화되었습니다. 다음 실행은 첫 번째 지식부터 시작합니다.'
  };
}

function deactivateActiveEmbeddingsUnlocked(
  knowledgeId,
  activeRows
) {
  const rows = activeRows || [];

  if (rows.length === 0) return;

  const sheet = getSheet(SHEET_NAMES.EMBEDDINGS);
  const headers = getHeaders(SHEET_NAMES.EMBEDDINGS);
  const statusIndex = headers.indexOf('status');
  const updatedAtIndex = headers.indexOf('updated_at');

  if (statusIndex < 0) {
    throw new Error(
      'embeddings 시트에 status 컬럼이 없습니다.'
    );
  }

  rows.forEach(function(row) {
    sheet
      .getRange(row._rowNumber, statusIndex + 1)
      .setValue('OLD');

    if (updatedAtIndex >= 0) {
      sheet
        .getRange(row._rowNumber, updatedAtIndex + 1)
        .setValue(new Date());
    }
  });
}

function saveEmbedding(
  knowledgeId,
  embeddingText,
  embeddingHash,
  embeddingJson,
  model
) {
  appendObjectRow(SHEET_NAMES.EMBEDDINGS, {
    embedding_id: generateId('EMB'),
    knowledge_id: knowledgeId,
    embedding_text: embeddingText,
    embedding_hash: embeddingHash,
    embedding_json: JSON.stringify(embeddingJson),
    embedding_model: model,
    embedding_version: 'v2',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date()
  });
}