const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_MAX_RETRIES = 3;

function callOpenAIChat(messages, options) {
  const config = getAllConfig();
  const settings = options || {};

  const payload = {
    model: settings.model || config.answer_model,
    messages: messages,
    temperature:
      settings.temperature !== undefined
        ? Number(settings.temperature)
        : config.temperature,
    max_completion_tokens:
      settings.maxCompletionTokens || config.answer_max_tokens
  };

  if (settings.responseFormat) {
    payload.response_format = settings.responseFormat;
  }

  const json = fetchOpenAIJson('/chat/completions', payload);

  if (
    !json ||
    !Array.isArray(json.choices) ||
    !json.choices[0] ||
    !json.choices[0].message ||
    typeof json.choices[0].message.content !== 'string'
  ) {
    throw new Error('OpenAI Chat API 응답 형식이 올바르지 않습니다.');
  }

  return json.choices[0].message.content;
}

function callOpenAIEmbedding(text) {
  const config = getAllConfig();

  if (!text || String(text).trim() === '') {
    throw new Error('임베딩할 텍스트가 비어 있습니다.');
  }

  const payload = {
    model: config.embedding_model,
    input: String(text)
  };

  const json = fetchOpenAIJson('/embeddings', payload);

  if (
    !json ||
    !Array.isArray(json.data) ||
    !json.data[0] ||
    !Array.isArray(json.data[0].embedding)
  ) {
    throw new Error('OpenAI Embedding API 응답 형식이 올바르지 않습니다.');
  }

  return json.data[0].embedding;
}

function fetchOpenAIJson(path, payload) {
  const apiKey = getOpenAiApiKey();
  let lastError = null;

  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(OPENAI_BASE_URL + path, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code >= 200 && code < 300) {
        try {
          return JSON.parse(body);
        } catch (parseError) {
          throw new Error('OpenAI API JSON 파싱에 실패했습니다.');
        }
      }

      const retryable = code === 429 || code >= 500;
      const apiMessage = extractOpenAIErrorMessage(body);

      lastError = new Error(
        'OpenAI API 오류: HTTP ' + code + ' / ' + apiMessage
      );

      if (!retryable || attempt >= OPENAI_MAX_RETRIES) {
        throw lastError;
      }

      Utilities.sleep(getRetryDelayMs(attempt));
    } catch (err) {
      lastError = err;

      const message =
        err && err.message ? String(err.message) : String(err);

      const retryableNetworkError =
        message.indexOf('Address unavailable') >= 0 ||
        message.indexOf('timed out') >= 0 ||
        message.indexOf('Service invoked too many times') >= 0;

      if (!retryableNetworkError || attempt >= OPENAI_MAX_RETRIES) {
        throw err;
      }

      Utilities.sleep(getRetryDelayMs(attempt));
    }
  }

  throw lastError || new Error('OpenAI API 호출에 실패했습니다.');
}

function extractOpenAIErrorMessage(body) {
  try {
    const json = JSON.parse(body);
    if (json && json.error && json.error.message) {
      return String(json.error.message);
    }
  } catch (err) {}

  return String(body || '').slice(0, 500);
}

function getRetryDelayMs(attempt) {
  const base = Math.pow(2, attempt) * 1000;
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}