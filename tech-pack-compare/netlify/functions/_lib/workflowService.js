/**
 * Path: netlify/functions/_lib/workflowService.js
 * Purpose: 所有 Netlify Functions 共用的 middleware／helper：
 *          CORS / OPTIONS / license / rate limit / JSON body parse / 20MB 上限 /
 *          requestId 注入 / context.debugAllowed 注入 / 統一 envelope 回應。
 *          所有 function handler 都該透過 handleRequest() 包裝。
 * Depends on:
 *   - src/services/rateLimiter.js (checkLicense / checkRate / extractIp / extractLicense)
 *   - src/services/llmClient.js (health)
 *   - src/utils/hash.js (makeRequestId)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js (t)
 *   - src/config/limits.js (FILE_LIMITS / CORS)
 *
 * 變更日期 / 改動原因：
 *   2026-05-19  初版（Phase 3）— Sonar Pro lock
 */

import { checkLicense, checkRate, extractIp, extractLicense } from '../../../src/services/rateLimiter.js';
import { health as llmHealth } from '../../../src/services/llmClient.js';
import { makeRequestId } from '../../../src/utils/hash.js';
import { logger } from '../../../src/utils/logger.js';
import { t } from '../../../src/utils/i18n.js';
import { FILE_LIMITS, CORS } from '../../../src/config/limits.js';

const VERSION = 'v2.0.0';

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
function corsHeaders(originHeader) {
  const allowList = (CORS?.allowedOrigins || ['*']);
  let allow = '*';
  if (!allowList.includes('*') && originHeader && allowList.includes(originHeader)) {
    allow = originHeader;
  } else if (allowList.includes('*')) {
    allow = '*';
  } else {
    allow = allowList[0] || '*';
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-License-Key, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

// ─────────────────────────────────────────────
// Envelope helpers
// ─────────────────────────────────────────────
/**
 * 成功回應。data 應符合 workflowResult.data 或為 function-specific payload。
 * meta 預設會自動補 version / provider / cached=false / warnings=[]。
 */
export function okResponse(data, meta = {}, { headers = {}, statusCode = 200 } = {}) {
  const provider = pickProvider();
  const finalMeta = {
    version: VERSION,
    duration_ms: typeof meta.duration_ms === 'number' ? meta.duration_ms : 0,
    total_tokens: typeof meta.total_tokens === 'number' ? meta.total_tokens : 0,
    provider,
    cached: !!meta.cached,
    warnings: Array.isArray(meta.warnings) ? meta.warnings.slice(0, 100) : [],
    debug: meta.debug ?? null,
    // function-specific extras (not validated against schema for single-agent endpoints)
    ...stripStandardMeta(meta)
  };
  return jsonResponse(statusCode, {
    success: true,
    data: data ?? null,
    error: null,
    meta: finalMeta
  }, headers);
}

/**
 * 失敗回應。永遠回 envelope shape：{ success:false, data:null, error:{...}, meta:{...} }
 */
export function errorResponse(code, message, statusCode = 500, detail = null, { headers = {}, warnings = [] } = {}) {
  return jsonResponse(statusCode, {
    success: false,
    data: null,
    error: {
      code: String(code || 'INTERNAL_ERROR'),
      message: String(message || t('error.internal')),
      detail: detail ?? null
    },
    meta: {
      version: VERSION,
      duration_ms: 0,
      total_tokens: 0,
      provider: pickProvider(),
      cached: false,
      warnings: Array.isArray(warnings) ? warnings.slice(0, 100) : [],
      debug: null
    }
  }, headers);
}

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function stripStandardMeta(m) {
  const out = { ...m };
  delete out.version;
  delete out.duration_ms;
  delete out.total_tokens;
  delete out.provider;
  delete out.cached;
  delete out.warnings;
  delete out.debug;
  return out;
}

function pickProvider() {
  try {
    const h = llmHealth?.();
    return h?.provider || process.env.LLM_PROVIDER || 'mock';
  } catch {
    return process.env.LLM_PROVIDER || 'mock';
  }
}

// ─────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────
/**
 * 解析 JSON body。會做 20MB 大小檢查。
 * @returns {{ok:true, data:any} | {ok:false, code:string, message:string, statusCode:number}}
 */
export function parseJsonBody(event) {
  const maxMb = FILE_LIMITS?.maxFileMB || FILE_LIMITS?.maxFileMb || 20;
  const maxBytes = maxMb * 1024 * 1024;
  const raw = typeof event.body === 'string' ? event.body : '';
  const isBase64 = !!event.isBase64Encoded;

  // 估算大小（base64 約 4/3 倍）
  const approxBytes = isBase64 ? Math.floor((raw.length * 3) / 4) : Buffer.byteLength(raw, 'utf8');
  if (approxBytes > maxBytes) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: t('error.payload_too_large', {
        mb: Math.round(approxBytes / 1024 / 1024),
        max: maxMb
      }),
      statusCode: 413
    };
  }

  if (!raw || raw.length === 0) {
    return { ok: true, data: {} };
  }

  try {
    const decoded = isBase64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    const data = JSON.parse(decoded);
    return { ok: true, data: data && typeof data === 'object' ? data : {} };
  } catch (err) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: t('error.invalid_json_body'),
      statusCode: 400
    };
  }
}

/**
 * 從 body 內 { pdfBase64 } 抽出 Buffer，並做 20MB 檢查。
 * 真 multipart 解析留 Phase 5。
 * @returns {{ok:true, buffer:Buffer} | {ok:false, code, message, statusCode}}
 */
export function parseBase64Pdf(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) {
    return { ok: false, code: 'BAD_REQUEST', message: t('error.missing_input'), statusCode: 400 };
  }
  const maxMb = FILE_LIMITS?.maxFileMB || FILE_LIMITS?.maxFileMb || 20;
  const maxBytes = maxMb * 1024 * 1024;
  // 去前綴 data:application/pdf;base64,
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Math.floor((cleaned.length * 3) / 4);
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: t('error.payload_too_large', {
        mb: Math.round(bytes / 1024 / 1024),
        max: maxMb
      }),
      statusCode: 413
    };
  }
  try {
    const buffer = Buffer.from(cleaned, 'base64');
    return { ok: true, buffer };
  } catch (err) {
    return { ok: false, code: 'BAD_REQUEST', message: t('error.invalid_json_body'), statusCode: 400 };
  }
}

// ─────────────────────────────────────────────
// Auth / Rate limit
// ─────────────────────────────────────────────
/**
 * 檢查 license key（從 X-License-Key header 或 body.license_key）。
 * @returns {{ok:true, license:string, isAdmin:boolean} | {ok:false, code, message, statusCode}}
 */
export function requireLicense(event, bodyData = {}) {
  const headerLicense = extractLicense(event.headers || {});
  const bodyLicense = typeof bodyData?.license_key === 'string' ? bodyData.license_key : null;
  const license = headerLicense || bodyLicense || null;

  const result = checkLicense(license);
  if (!result.allowed) {
    const msg = (result.reason === 'missing')
      ? t('error.missing_license')
      : t('error.invalid_license');
    return { ok: false, code: 'UNAUTHORIZED', message: msg, statusCode: 401 };
  }

  const adminKey = process.env.ADMIN_LICENSE_KEY || 'ADMIN-TEST-2026';
  return { ok: true, license, isAdmin: license === adminKey };
}

/**
 * Rate limit 檢查（per IP + license）。
 */
export function requireRateLimit(event, license) {
  const ip = extractIp(event.headers || {});
  const result = checkRate(ip, license);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: t('error.rate_limited', { seconds }),
      statusCode: 429,
      headers: {
        'Retry-After': String(seconds),
        'X-RateLimit-Remaining': String(result.remaining ?? 0)
      }
    };
  }
  return { ok: true, remaining: result.remaining, resetAt: result.resetAt };
}

// ─────────────────────────────────────────────
// Main wrapper
// ─────────────────────────────────────────────
/**
 * 包裝整個 function handler。
 * @param {object} param0
 * @param {object} param0.event   Netlify event
 * @param {object} param0.context Netlify context
 * @param {string} param0.fnName  function 名（用於 log）
 * @param {object} options
 * @param {string[]} [options.methods=['POST']]   允許的 HTTP method
 * @param {boolean} [options.requireAuth=true]    是否需要 license
 * @param {boolean} [options.rateLimit=true]      是否套 rate limit（需 requireAuth=true）
 * @param {boolean} [options.parseBody=true]      是否預先 parse JSON body
 * @param {function} handler async ({ event, body, requestId, log, license, isAdmin, debugAllowed }) => netlify response
 */
export async function handleRequest({ event, context, fnName }, options, handler) {
  const opts = {
    methods: ['POST'],
    requireAuth: true,
    rateLimit: true,
    parseBody: true,
    ...options
  };
  const origin = (event.headers?.origin) || (event.headers?.Origin) || '';
  const baseHeaders = corsHeaders(origin);

  // OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: baseHeaders, body: '' };
  }

  // Method check
  if (!opts.methods.includes(event.httpMethod)) {
    const r = errorResponse(
      'METHOD_NOT_ALLOWED',
      t('error.invalid_method', { expected: opts.methods.join(', ') }),
      405,
      null,
      { headers: { ...baseHeaders, Allow: opts.methods.join(', ') } }
    );
    return r;
  }

  const requestId = makeRequestId();
  const log = logger.child({ requestId, function: fnName });
  log.info('fn.start', { method: event.httpMethod, path: event.path });

  // Body parse
  let body = {};
  if (opts.parseBody && event.httpMethod !== 'GET') {
    const parsed = parseJsonBody(event);
    if (!parsed.ok) {
      log.warn('fn.bad_body', { code: parsed.code });
      return errorResponse(parsed.code, parsed.message, parsed.statusCode, null, { headers: baseHeaders });
    }
    body = parsed.data;
  }

  // License
  let license = null;
  let isAdmin = false;
  if (opts.requireAuth) {
    const auth = requireLicense(event, body);
    if (!auth.ok) {
      log.warn('fn.unauthorized', { code: auth.code });
      return errorResponse(auth.code, auth.message, auth.statusCode, null, { headers: baseHeaders });
    }
    license = auth.license;
    isAdmin = auth.isAdmin;

    // Rate limit
    if (opts.rateLimit) {
      const rl = requireRateLimit(event, license);
      if (!rl.ok) {
        log.warn('fn.rate_limited');
        return errorResponse(rl.code, rl.message, rl.statusCode, null, {
          headers: { ...baseHeaders, ...(rl.headers || {}) }
        });
      }
    }
  }

  // Business handler
  try {
    const result = await handler({
      event,
      context,
      body,
      requestId,
      log,
      license,
      isAdmin,
      debugAllowed: isAdmin
    });
    // 把 CORS header 合進 result（若 handler 沒帶）
    const merged = {
      ...result,
      headers: { ...baseHeaders, ...(result?.headers || {}) }
    };
    log.info('fn.done', { statusCode: merged.statusCode });
    return merged;
  } catch (err) {
    log.error('fn.crashed', { err: err?.message, stack: err?.stack?.slice(0, 500) });
    return errorResponse(
      'INTERNAL_ERROR',
      `${t('error.internal')}（${err?.message || 'unknown'}）`,
      500,
      null,
      { headers: baseHeaders }
    );
  }
}

export default {
  handleRequest,
  okResponse,
  errorResponse,
  parseJsonBody,
  parseBase64Pdf,
  requireLicense,
  requireRateLimit
};
