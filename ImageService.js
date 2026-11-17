/**
 * Google Drive 이미지 연결 서비스
 *
 * Script Property:
 * RAG_IMAGE_FOLDER_ID
 *
 * 허용 값:
 * 1. Google Drive 폴더 ID
 * 2. Google Drive 폴더 URL
 * 3. 개별 Google Drive 파일 ID
 * 4. 개별 Google Drive 파일 URL
 *
 * 폴더를 지정하면 하위 폴더까지 검색합니다.
 * 개별 파일을 지정하면 해당 파일 1개만 인덱싱합니다.
 */

function getDriveFileViewUrl(fileId) {
  if (!fileId) return '';

  return (
    'https://drive.google.com/file/d/' +
    fileId +
    '/view'
  );
}

function getDriveFilePreviewUrl(fileId) {
  if (!fileId) return '';

  return (
    'https://drive.google.com/file/d/' +
    fileId +
    '/preview'
  );
}

function getDriveFileDirectUrl(fileId) {
  if (!fileId) return '';

  return (
    'https://drive.google.com/thumbnail?id=' +
    encodeURIComponent(fileId) +
    '&sz=w1600'
  );
}

function extractDriveFileIdFromUrl(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  const fileMatch = raw.match(
    /\/file\/d\/([a-zA-Z0-9_-]+)/
  );

  if (fileMatch) {
    return fileMatch[1];
  }

  const idMatch = raw.match(
    /[?&]id=([a-zA-Z0-9_-]+)/
  );

  if (idMatch) {
    return idMatch[1];
  }

  return '';
}

function normalizeDriveRelativePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function extractFileNameFromPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/');

  if (!normalized) return '';

  const parts = normalized.split('/');

  return String(
    parts[parts.length - 1] || ''
  ).trim();
}

function createDriveFileInfo(file, relativePath) {
  const fileId = file.getId();
  const fileName = String(file.getName() || '').trim();
  const path = relativePath || fileName;

  return {
    id: fileId,
    name: fileName,
    relativePath: path,
    viewUrl: getDriveFileViewUrl(fileId),
    previewUrl: getDriveFilePreviewUrl(fileId),
    directUrl: getDriveFileDirectUrl(fileId)
  };
}

function resolveDriveImageResource(resourceValue) {
  const resourceId = getDriveResourceId(resourceValue);

  if (!resourceId) {
    throw new Error(
      'RAG_IMAGE_FOLDER_ID가 비어 있습니다. ' +
      'Drive 폴더 URL·폴더 ID 또는 개별 파일 URL·파일 ID를 등록하세요.'
    );
  }

  try {
    const folder = DriveApp.getFolderById(resourceId);

    folder.getName();

    return {
      type: 'FOLDER',
      id: resourceId,
      folder: folder
    };
  } catch (folderError) {}

  try {
    const file = DriveApp.getFileById(resourceId);

    file.getName();

    return {
      type: 'FILE',
      id: resourceId,
      file: file
    };
  } catch (fileError) {
    throw new Error(
      '등록된 Drive ID에 접근할 수 없습니다. ' +
      '폴더 또는 파일 ID와 Apps Script 실행 계정의 공유 권한을 확인하세요. ' +
      '확인한 ID: ' +
      resourceId
    );
  }
}

function buildDriveImageIndex(resourceValue) {
  const resource = resolveDriveImageResource(resourceValue);

  const result = {
    resourceType: resource.type,
    resourceId: resource.id,
    filesByName: {},
    filesByPath: {},
    duplicateNames: {},
    duplicatePaths: {}
  };

  if (resource.type === 'FILE') {
    addFileToDriveImageIndex(
      result,
      createDriveFileInfo(
        resource.file,
        resource.file.getName()
      )
    );

    return result;
  }

  indexDriveFolderRecursive(
    resource.folder,
    '',
    result
  );

  return result;
}

function addFileToDriveImageIndex(indexResult, info) {
  const nameKey = String(info.name || '')
    .trim()
    .toLowerCase();

  const pathKey = normalizeDriveRelativePath(
    info.relativePath
  );

  if (nameKey) {
    if (indexResult.filesByName[nameKey]) {
      if (!indexResult.duplicateNames[nameKey]) {
        indexResult.duplicateNames[nameKey] = [
          indexResult.filesByName[nameKey]
        ];
      }

      indexResult.duplicateNames[nameKey].push(info);
    } else {
      indexResult.filesByName[nameKey] = info;
    }
  }

  if (pathKey) {
    if (indexResult.filesByPath[pathKey]) {
      if (!indexResult.duplicatePaths[pathKey]) {
        indexResult.duplicatePaths[pathKey] = [
          indexResult.filesByPath[pathKey]
        ];
      }

      indexResult.duplicatePaths[pathKey].push(info);
    } else {
      indexResult.filesByPath[pathKey] = info;
    }
  }
}

function indexDriveFolderRecursive(
  folder,
  relativePath,
  indexResult
) {
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = String(file.getName() || '').trim();

    if (!fileName) continue;

    const fullPath = relativePath
      ? relativePath + '/' + fileName
      : fileName;

    addFileToDriveImageIndex(
      indexResult,
      createDriveFileInfo(file, fullPath)
    );
  }

  const folders = folder.getFolders();

  while (folders.hasNext()) {
    const child = folders.next();

    const childPath = relativePath
      ? relativePath + '/' + child.getName()
      : child.getName();

    indexDriveFolderRecursive(
      child,
      childPath,
      indexResult
    );
  }
}

function findIndexedImage(
  indexResult,
  imageFilePath,
  imageFileName
) {
  const pathKey = normalizeDriveRelativePath(
    imageFilePath
  );

  const fileName =
    String(imageFileName || '').trim() ||
    extractFileNameFromPath(imageFilePath);

  const nameKey = fileName.toLowerCase();

  if (
    pathKey &&
    indexResult.filesByPath[pathKey]
  ) {
    return {
      info: indexResult.filesByPath[pathKey],
      duplicate:
        !!indexResult.duplicatePaths[pathKey],
      matchedBy: 'PATH'
    };
  }

  if (
    nameKey &&
    indexResult.filesByName[nameKey]
  ) {
    return {
      info: indexResult.filesByName[nameKey],
      duplicate:
        !!indexResult.duplicateNames[nameKey],
      matchedBy: 'NAME'
    };
  }

  return {
    info: null,
    duplicate: false,
    matchedBy: ''
  };
}

function updateImageUrlsFromDrive() {
  const resourceValue = getScriptProperty(
    'RAG_IMAGE_FOLDER_ID'
  );

  if (!resourceValue) {
    throw new Error(
      'RAG_IMAGE_FOLDER_ID가 설정되어 있지 않습니다.'
    );
  }

  const sheet = getSheet(
    SHEET_NAMES.RAG_KNOWLEDGE
  );

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return {
      success: true,
      updated: 0,
      preserved: 0,
      missing: 0,
      duplicates: 0,
      message: 'rag_knowledge 데이터가 없습니다.'
    };
  }

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(function(header) {
      return String(header || '').trim();
    });

  const idxKnowledgeId = headers.indexOf(
    'knowledge_id'
  );

  const idxImageUrl = headers.indexOf(
    'image_url'
  );

  const idxImageFilePath = headers.indexOf(
    'image_file_path'
  );

  const idxImageFileName = headers.indexOf(
    'image_file_name'
  );

  if (idxKnowledgeId < 0) {
    throw new Error('knowledge_id 컬럼이 없습니다.');
  }

  if (idxImageUrl < 0) {
    throw new Error('image_url 컬럼이 없습니다.');
  }

  if (idxImageFilePath < 0) {
    throw new Error('image_file_path 컬럼이 없습니다.');
  }

  if (idxImageFileName < 0) {
    throw new Error('image_file_name 컬럼이 없습니다.');
  }

  const rowCount = lastRow - 1;

  const knowledgeIds = sheet
    .getRange(
      2,
      idxKnowledgeId + 1,
      rowCount,
      1
    )
    .getValues();

  const urls = sheet
    .getRange(
      2,
      idxImageUrl + 1,
      rowCount,
      1
    )
    .getValues();

  const paths = sheet
    .getRange(
      2,
      idxImageFilePath + 1,
      rowCount,
      1
    )
    .getValues();

  const names = sheet
    .getRange(
      2,
      idxImageFileName + 1,
      rowCount,
      1
    )
    .getValues();

  const unresolvedIndexes = [];

  let preserved = 0;

  for (let index = 0; index < rowCount; index++) {
    const existingUrl = String(
      urls[index][0] || ''
    ).trim();

    if (
      existingUrl &&
      /^https:\/\/drive\.google\.com\//i.test(
        existingUrl
      )
    ) {
      preserved++;
      continue;
    }

    unresolvedIndexes.push(index);
  }

  if (unresolvedIndexes.length === 0) {
    return {
      success: true,
      updated: 0,
      preserved: preserved,
      missing: 0,
      duplicates: 0,
      message:
        '모든 이미지 URL이 이미 연결되어 있습니다.'
    };
  }

  const indexResult = buildDriveImageIndex(
    resourceValue
  );

  let updated = 0;
  let missing = 0;
  let duplicates = 0;
  let inferredNames = 0;

  unresolvedIndexes.forEach(function(index) {
    const knowledgeId = String(
      knowledgeIds[index][0] || ''
    ).trim();

    const pathValue = String(
      paths[index][0] || ''
    ).trim();

    let nameValue = String(
      names[index][0] || ''
    ).trim();

    if (!nameValue && pathValue) {
      nameValue = extractFileNameFromPath(
        pathValue
      );
    }

    if (!nameValue && knowledgeId) {
      nameValue = knowledgeId + '.png';
    }

    if (!pathValue && !nameValue) {
      return;
    }

    const matched = findIndexedImage(
      indexResult,
      pathValue,
      nameValue
    );

    if (matched.duplicate) {
      duplicates++;
      return;
    }

    if (!matched.info) {
      missing++;
      return;
    }

    if (
      !String(names[index][0] || '').trim() &&
      nameValue
    ) {
      names[index][0] = nameValue;
      inferredNames++;
    }

    urls[index][0] = matched.info.viewUrl;
    updated++;
  });

  sheet
    .getRange(
      2,
      idxImageUrl + 1,
      rowCount,
      1
    )
    .setValues(urls);

  sheet
    .getRange(
      2,
      idxImageFileName + 1,
      rowCount,
      1
    )
    .setValues(names);

  SpreadsheetApp.flush();

  return {
    success: true,
    resource_type: indexResult.resourceType,
    resource_id: indexResult.resourceId,
    updated: updated,
    preserved: preserved,
    missing: missing,
    duplicates: duplicates,
    inferred_file_names: inferredNames,
    message:
      '이미지 연결 완료: 신규 ' +
      updated +
      '건, 기존 유지 ' +
      preserved +
      '건, 미매칭 ' +
      missing +
      '건, 중복 ' +
      duplicates +
      '건'
  };
}

function testRagImageResource() {
  requireAdmin();

  const resourceValue = getScriptProperty(
    'RAG_IMAGE_FOLDER_ID'
  );

  const resource = resolveDriveImageResource(
    resourceValue
  );

  if (resource.type === 'FILE') {
    return {
      success: true,
      type: 'FILE',
      id: resource.id,
      name: resource.file.getName(),
      url: resource.file.getUrl()
    };
  }

  const sampleFiles = [];
  const iterator = resource.folder.getFiles();

  while (
    iterator.hasNext() &&
    sampleFiles.length < 10
  ) {
    sampleFiles.push(
      iterator.next().getName()
    );
  }

  return {
    success: true,
    type: 'FOLDER',
    id: resource.id,
    name: resource.folder.getName(),
    url: resource.folder.getUrl(),
    sample_files: sampleFiles
  };
}