function getSheet(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('시트를 찾을 수 없습니다: ' + sheetName);
  }

  return sheet;
}

function getHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  const lastCol = sheet.getLastColumn();

  if (lastCol === 0) return [];

  return sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function(header) {
      return String(header || '').trim();
    });
}

function getRowsAsObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 1) return [];

  const headers = getHeaders(sheetName);
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return values.map(function(row, index) {
    const obj = { _rowNumber: index + 2 };

    headers.forEach(function(header, columnIndex) {
      if (header !== '') {
        obj[header] = row[columnIndex];
      }
    });

    return obj;
  });
}

function appendObjectRow(sheetName, object) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);

  const row = headers.map(function(header) {
    return object[header] !== undefined ? object[header] : '';
  });

  sheet.appendRow(row);
}

function updateRowByKey(sheetName, keyColumn, keyValue, updateObject) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const keyIndex = headers.indexOf(keyColumn);

  if (keyIndex < 0) {
    throw new Error('키 컬럼을 찾을 수 없습니다: ' + keyColumn);
  }

  const matches = getRowsAsObjects(sheetName).filter(function(row) {
    return String(row[keyColumn]) === String(keyValue);
  });

  if (matches.length === 0) {
    throw new Error('업데이트 대상 행을 찾을 수 없습니다: ' + keyValue);
  }

  if (matches.length > 1) {
    throw new Error(
      '키 값이 중복되어 업데이트할 수 없습니다: ' +
        keyColumn +
        '=' +
        keyValue
    );
  }

  const target = matches[0];
  const columnsToUpdate = Object.keys(updateObject)
    .map(function(key) {
      return {
        key: key,
        colIndex: headers.indexOf(key)
      };
    })
    .filter(function(item) {
      return item.colIndex >= 0;
    });

  columnsToUpdate.forEach(function(item) {
    sheet
      .getRange(target._rowNumber, item.colIndex + 1)
      .setValue(updateObject[item.key]);
  });
}

function getSearchableStatuses() {
  const useOnlyApproved = getBooleanConfig('use_only_approved', true);
  return useOnlyApproved ? ['APPROVED'] : ['APPROVED', 'REVIEW'];
}

function getSearchableKnowledge() {
  const allowedStatuses = new Set(getSearchableStatuses());

  return getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE).filter(function(row) {
    return allowedStatuses.has(String(row.status || '').trim().toUpperCase());
  });
}

function getApprovedKnowledge() {
  return getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE).filter(function(row) {
    return String(row.status || '').trim().toUpperCase() === 'APPROVED';
  });
}

function getKnowledgeById(knowledgeId) {
  const matches = getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE).filter(
    function(row) {
      return String(row.knowledge_id) === String(knowledgeId);
    }
  );

  if (matches.length > 1) {
    throw new Error('knowledge_id가 중복되었습니다: ' + knowledgeId);
  }

  return matches.length === 1 ? matches[0] : null;
}

function getKnowledgeByIds(knowledgeIds) {
  const idSet = new Set(
    (knowledgeIds || []).map(function(id) {
      return String(id);
    })
  );
  const allowedStatuses = new Set(getSearchableStatuses());
  const rows = getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE);
  const duplicateCheck = {};

  rows.forEach(function(row) {
    const id = String(row.knowledge_id || '');
    if (!idSet.has(id)) return;
    duplicateCheck[id] = (duplicateCheck[id] || 0) + 1;
  });

  const duplicates = Object.keys(duplicateCheck).filter(function(id) {
    return duplicateCheck[id] > 1;
  });

  if (duplicates.length > 0) {
    throw new Error(
      '중복 knowledge_id가 있어 검색할 수 없습니다: ' +
        duplicates.join(', ')
    );
  }

  return rows.filter(function(row) {
    return (
      idSet.has(String(row.knowledge_id)) &&
      allowedStatuses.has(String(row.status || '').trim().toUpperCase())
    );
  });
}

function validateKnowledgeIds() {
  const rows = getRowsAsObjects(SHEET_NAMES.RAG_KNOWLEDGE);
  const counts = {};
  const blankRows = [];

  rows.forEach(function(row) {
    const id = String(row.knowledge_id || '').trim();

    if (!id) {
      blankRows.push(row._rowNumber);
      return;
    }

    counts[id] = (counts[id] || 0) + 1;
  });

  const duplicateIds = Object.keys(counts).filter(function(id) {
    return counts[id] > 1;
  });

  return {
    ok: blankRows.length === 0 && duplicateIds.length === 0,
    blank_rows: blankRows,
    duplicate_ids: duplicateIds
  };
}

function generateId(prefix) {
  const ts = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMddHHmmssSSS'
  );
  const rand = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');

  return prefix + '_' + ts + '_' + rand;
}

function safeJsonParse(value, fallback) {
  try {
    if (Array.isArray(value)) return value;
    if (!value) return fallback;
    return JSON.parse(String(value));
  } catch (err) {
    return fallback;
  }
}

function valueOrBlank(value) {
  return value === undefined || value === null ? '' : value;
}