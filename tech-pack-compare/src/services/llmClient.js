/**
 * Path: src/services/llmClient.js
 * Purpose: 統一 LLM 介面 — 4 個真實 provider + 1 個 mock provider
 *          所有 agent 對外只看 `chat({ messages, schema, model_tier, agent_name })`
 *          內部負責 provider 路由、json_schema 形態轉換、retry、timeout、cache、redact、token usage log
 * Depends on:
 *   - src/config/models.js (resolveModel, getActiveProvider, providerStatus)
 *   - src/config/limits.js (TIMEOUTS, FEATURES)
 *   - src/schemas/index.js (SCHEMAS, asResponseFormat)
 *   - src/services/cacheService.js
 *   - src/utils/logger.js
 *   - src/utils/json.js (parseLlmJson)
 *   - src/utils/hash.js (objectHash for cache key)
 *   - src/utils/i18n.js
 *
 * 重要規則：
 *   1. 所有 API key 只在這個檔案讀，agent 不能直接讀 process.env
 *   2. 任何 LLM 調用必須 try/catch，失敗時自動 fallback 到 mock provider，不要 throw
 *   3. `response_format` 只接受單一 artifact schema，**禁止傳 workflowResult**（見 KI-003）
 *   4. Token usage 必須透過 logger.usage() 記錄，給帳單分析用
 */

import { resolveModel, getActiveProvider, providerStatus } from '../config/models.js';
import { TIMEOUTS, FEATURES } from '../config/limits.js';
import { SCHEMAS, asResponseFormat } from '../schemas/index.js';
import * as cache from './cacheService.js';
import { buildMockArtifact } from './mockProvider.js';
import { logger } from '../utils/logger.js';
import { parseLlmJson } from '../utils/json.js';
import { objectHash } from '../utils/hash.js';
import { t } from '../utils/i18n.js';

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string | Array<{type:string, text?:string, image_url?:{url:string}}>} content
 */

/**
 * @typedef {Object} ChatRequest
 * @property {ChatMessage[]} messages
 * @property {string} [schema]            SCHEMA_NAMES 之一 — agent 想要的結構化輸出
 * @property {'low'|'medium'|'high'} [model_tier]   預設 medium
 * @property {string} [agent_name]        log 用
 * @property {string} [provider]          強制指定 provider（覆寫 .env）
 * @property {string} [requestId]         log correlate 用
 * @property {boolean} [allowCache]       預設 true
 */

/**
 * @typedef {Object} ChatResponse
 * @property {boolean} ok
 * @property {object|null} data           已 JSON.parse 過的物件（若有 schema）
 * @property {string} rawText             LLM 原始 message.content
 * @property {string} provider            真實調用的 provider
 * @property {string} model               真實 model name
 * @property {number} tokensUsed
 * @property {boolean} cached
 * @property {string|null} warning        非致命警告（例如 retry 過、用了 fallback）
 * @property {string|null} error          致命錯誤（已 fallback 到 mock 仍走不通才會出現）
 */

// ───────────────────────────────────────────────────────────
//                        對外主 API
// ───────────────────────────────────────────────────────────

/**
 * 統一 chat 介面
 * @param {ChatRequest} req
 * @returns {Promise<ChatResponse>}
 */
export async function chat(req) {
  const {
    messages,
    schema = null,
    model_tier = 'medium',
    agent_name = 'unknown',
    provider: forceProvider,
    requestId = null,
    allowCache = true
  } = req || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse({
      provider: 'mock',
      error: '缺少 messages',
      agent_name,
      requestId
    });
  }

  const log = logger.child({ agent: agent_name, requestId });
  const provider = forceProvider || getActiveProvider();
  const resolved = resolveModel(model_tier, provider);

  // ───── cache lookup ─────
  const cacheKey = cache.makeKey({
    provider: resolved.provider,
    model: resolved.spec.name,
    schema,
    messages
  }, `llm:${agent_name}`);

  if (allowCache && FEATURES.enablePromptCache) {
    const hit = cache.get(cacheKey);
    if (hit) {
      log.info('llm.cache.hit', { provider: resolved.provider, model: resolved.spec.name, schema });
      return { ...hit, cached: true };
    }
  }

  // ───── 跑 provider（含 retry） ─────
  let lastErr = null;
  for (let attempt = 1; attempt <= TIMEOUTS.maxRetries; attempt++) {
    try {
      const result = await callProvider({
        provider: resolved.provider,
        endpoint: resolved.endpoint,
        envKey: resolved.envKey,
        spec: resolved.spec,
        messages,
        schema,
        log,
        attempt
      });
      if (allowCache && FEATURES.enablePromptCache) cache.set(cacheKey, result);
      return { ...result, cached: false };
    } catch (e) {
      lastErr = e;
      const backoff = TIMEOUTS.baseRetryMs * Math.pow(2, attempt - 1);
      log.warn('llm.retry', {
        provider: resolved.provider,
        attempt,
        maxAttempts: TIMEOUTS.maxRetries,
        backoffMs: backoff,
        error: e?.message
      });
      if (attempt < TIMEOUTS.maxRetries) {
        await sleep(backoff);
      }
    }
  }

  // ───── 全部 retry 失敗 → fallback to mock ─────
  log.error('llm.allRetriesFailed.fallbackToMock', {
    provider: resolved.provider,
    finalError: lastErr?.message
  });

  try {
    const mockResult = await callProvider({
      provider: 'mock',
      endpoint: 'mock://local',
      envKey: null,
      spec: resolveModel(model_tier, 'mock').spec,
      messages,
      schema,
      log,
      attempt: 0
    });
    return {
      ...mockResult,
      warning: t('error.llm_failed', { reason: lastErr?.message || 'unknown' }),
      cached: false
    };
  } catch (e2) {
    return errorResponse({
      provider: resolved.provider,
      error: e2?.message || lastErr?.message || 'LLM 與 fallback 同時失敗',
      agent_name,
      requestId
    });
  }
}

/**
 * 健康檢查 — 給 /health endpoint 用
 * @returns {{ activeProvider: string, providers: object, schemas: number }}
 */
export function health() {
  return {
    activeProvider: getActiveProvider(),
    providers: providerStatus(),
    schemas: Object.keys(SCHEMAS).length
  };
}

// ───────────────────────────────────────────────────────────
//                  Provider 路由（核心 switch）
// ───────────────────────────────────────────────────────────

async function callProvider({ provider, endpoint, envKey, spec, messages, schema, log, attempt }) {
  switch (provider) {
    case 'perplexity': return callPerplexity({ endpoint, envKey, spec, messages, schema, log });
    case 'openai':     return callOpenAI({ endpoint, envKey, spec, messages, schema, log });
    case 'anthropic':  return callAnthropic({ endpoint, envKey, spec, messages, schema, log });
    case 'ollama':     return callOllama({ endpoint, spec, messages, schema, log });
    case 'mock':       return callMock({ spec, messages, schema, log });
    default:
      throw new Error(`未知 provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────
//                      Perplexity
// ───────────────────────────────────────────────────────────

async function callPerplexity({ endpoint, envKey, spec, messages, schema, log }) {
  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error(`Missing API key: ${envKey}`);

  const body = {
    model: spec.name,
    temperature: spec.temperature,
    max_tokens: spec.max_tokens,
    messages
  };
  if (schema && SCHEMAS[schema] && spec.supportsJsonSchema) {
    body.response_format = asResponseFormat(schema);
  }

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `Perplexity ${res.status}`);
  }

  const rawText = String(data?.choices?.[0]?.message?.content || '');
  // KI-006 fix: Sonar Pro 不同版本 usage 欄位可能只回 prompt_tokens + completion_tokens，裡头庋 total_tokens
  const usage = data?.usage || {};
  const tokensUsed =
    (typeof usage.total_tokens === 'number' && usage.total_tokens) ||
    ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) ||
    0;
  log.usage({ provider: 'perplexity', model: spec.name, ...usage, computed_total: tokensUsed });

  return finalize({
    provider: 'perplexity',
    model: spec.name,
    rawText,
    tokensUsed,
    schema
  });
}

// ───────────────────────────────────────────────────────────
//                      OpenAI
// ───────────────────────────────────────────────────────────

async function callOpenAI({ endpoint, envKey, spec, messages, schema, log }) {
  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error(`Missing API key: ${envKey}`);

  const body = {
    model: spec.name,
    temperature: spec.temperature,
    max_tokens: spec.max_tokens,
    messages
  };
  if (schema && SCHEMAS[schema] && spec.supportsJsonSchema) {
    body.response_format = asResponseFormat(schema);
  }

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI ${res.status}`);
  }

  const rawText = String(data?.choices?.[0]?.message?.content || '');
  const tokensUsed = data?.usage?.total_tokens || 0;
  log.usage({ provider: 'openai', model: spec.name, ...(data?.usage || {}) });

  return finalize({ provider: 'openai', model: spec.name, rawText, tokensUsed, schema });
}

// ───────────────────────────────────────────────────────────
//                      Anthropic (Claude)
//   不支援 json_schema → 用 tool_use 模擬（見 KI-002）
// ───────────────────────────────────────────────────────────

async function callAnthropic({ endpoint, envKey, spec, messages, schema, log }) {
  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error(`Missing API key: ${envKey}`);

  // Anthropic 把 system message 抽出來放最外層
  let systemText = '';
  const others = [];
  for (const m of messages) {
    if (m.role === 'system') systemText += (typeof m.content === 'string' ? m.content : '') + '\n';
    else others.push(m);
  }

  /** @type {object} */
  const body = {
    model: spec.name,
    max_tokens: spec.max_tokens,
    temperature: spec.temperature,
    system: systemText.trim() || undefined,
    messages: others.map(m => ({
      role: m.role,
      content: m.content
    }))
  };

  // tool_use 模擬 json_schema
  if (schema && SCHEMAS[schema]) {
    const sch = { ...SCHEMAS[schema] };
    delete sch.$id;
    delete sch.$schema;
    body.tools = [{
      name: schema,
      description: sch.description || 'Structured output',
      input_schema: sch
    }];
    body.tool_choice = { type: 'tool', name: schema };
  }

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic ${res.status}`);
  }

  // 抓 tool_use block
  let rawText = '';
  let parsedDirect = null;
  if (Array.isArray(data?.content)) {
    for (const blk of data.content) {
      if (blk.type === 'tool_use' && blk.input) {
        parsedDirect = blk.input;
        rawText = JSON.stringify(blk.input);
      } else if (blk.type === 'text' && !rawText) {
        rawText = String(blk.text || '');
      }
    }
  }

  const tokensUsed = (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0);
  log.usage({
    provider: 'anthropic',
    model: spec.name,
    prompt_tokens: data?.usage?.input_tokens || 0,
    completion_tokens: data?.usage?.output_tokens || 0,
    total_tokens: tokensUsed
  });

  // tool_use 已經是物件，不用再 parse
  if (parsedDirect) {
    return {
      ok: true,
      data: parsedDirect,
      rawText,
      provider: 'anthropic',
      model: spec.name,
      tokensUsed,
      cached: false,
      warning: null,
      error: null
    };
  }
  return finalize({ provider: 'anthropic', model: spec.name, rawText, tokensUsed, schema });
}

// ───────────────────────────────────────────────────────────
//                      Ollama (local)
// ───────────────────────────────────────────────────────────

async function callOllama({ endpoint, spec, messages, schema, log }) {
  /** @type {object} */
  const body = {
    model: spec.name,
    messages,
    stream: false,
    options: {
      temperature: spec.temperature,
      num_predict: spec.max_tokens
    }
  };
  // Ollama 從 0.5+ 支援 format 為 JSON schema object
  if (schema && SCHEMAS[schema]) {
    const sch = { ...SCHEMAS[schema] };
    delete sch.$id;
    delete sch.$schema;
    body.format = sch;
  }

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Ollama ${res.status}`);

  const rawText = String(data?.message?.content || '');
  const tokensUsed = (data?.prompt_eval_count || 0) + (data?.eval_count || 0);
  log.usage({
    provider: 'ollama',
    model: spec.name,
    prompt_tokens: data?.prompt_eval_count || 0,
    completion_tokens: data?.eval_count || 0,
    total_tokens: tokensUsed
  });

  return finalize({ provider: 'ollama', model: spec.name, rawText, tokensUsed, schema });
}

// ───────────────────────────────────────────────────────────
//                      Mock (offline / fallback / test)
//   依 schema 名稱回相應的合法 dummy artifact
// ───────────────────────────────────────────────────────────

async function callMock({ spec, messages, schema, log }) {
  const dummy = buildMockArtifact(schema, messages);
  const rawText = JSON.stringify(dummy);
  log.info('llm.mock.invoked', { schema, model: spec.name });
  return {
    ok: true,
    data: dummy,
    rawText,
    provider: 'mock',
    model: spec.name,
    tokensUsed: 0,
    cached: false,
    warning: null,
    error: null
  };
}

// ───────────────────────────────────────────────────────────
//                      共用 helpers
// ───────────────────────────────────────────────────────────

/**
 * 把 rawText 轉成 { ok, data, ... } 統一回應
 */
function finalize({ provider, model, rawText, tokensUsed, schema }) {
  let data = null;
  if (schema) {
    data = parseLlmJson(rawText, null);
    if (!data) {
      // parse 失敗：仍回 ok:false，呼叫端會降級
      return {
        ok: false,
        data: null,
        rawText,
        provider,
        model,
        tokensUsed,
        cached: false,
        warning: t('error.schema_invalid'),
        error: 'LLM 回應無法解析為 JSON'
      };
    }
  }
  return {
    ok: true,
    data,
    rawText,
    provider,
    model,
    tokensUsed,
    cached: false,
    warning: null,
    error: null
  };
}

function errorResponse({ provider, error, agent_name, requestId }) {
  logger.error('llm.error', { provider, agent: agent_name, requestId, error });
  return {
    ok: false,
    data: null,
    rawText: '',
    provider,
    model: '',
    tokensUsed: 0,
    cached: false,
    warning: null,
    error
  };
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.llmRequestMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(t('common.timeout'));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default { chat, health };
