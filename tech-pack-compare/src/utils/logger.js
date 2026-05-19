/**
 * Path: src/utils/logger.js
 * Purpose: 結構化 logger — 每行一個 JSON，給 Netlify Functions log 用
 *          自動 redact API key、bearer token、long base64 圖片等敏感欄位
 * Depends on: src/utils/json.js (safeStringify)
 *
 * Design notes:
 *   - 統一 schema: { ts, level, agent, requestId, msg, ...extra }
 *   - 預設 INFO，可透過 LOG_LEVEL 環境變數調整
 *   - Netlify dashboard 會自動 parse JSON log，方便搜尋
 *   - logger.child({ agent: 'measurement', requestId }) 取得 scoped logger
 */

import { safeStringify } from './json.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

/**
 * Redact 敏感資料：API key、Authorization header、過長 base64 圖片
 * @param {*} value
 * @returns {*}
 */
function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    // base64 圖片：超過 200 字元就截斷
    if (value.length > 1000 && /^data:image\//.test(value)) {
      return value.slice(0, 60) + `...[truncated ${value.length} chars]`;
    }
    // API key 樣式
    if (/^(pplx-|sk-|sk-ant-|gsk_|hf_)[A-Za-z0-9_\-]{8,}/.test(value)) {
      return value.slice(0, 6) + '***REDACTED***';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      // 整個 key 名稱包含敏感字眼就完全 redact
      if (/api[_-]?key|authorization|bearer|secret|password|token/i.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redact(value[k]);
      }
    }
    return out;
  }
  return value;
}

function write(level, payload) {
  if (LEVELS[level] < currentLevel()) return;
  const line = safeStringify({
    ts: new Date().toISOString(),
    level,
    ...redact(payload)
  });
  // 不同 level 走不同 stream，方便 Netlify UI 過濾
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * 建立 root logger
 * @param {object} [base={}]  附加在每行 log 的 base context
 */
export function createLogger(base = {}) {
  return {
    debug: (msg, extra = {}) => write('debug', { ...base, msg, ...extra }),
    info:  (msg, extra = {}) => write('info',  { ...base, msg, ...extra }),
    warn:  (msg, extra = {}) => write('warn',  { ...base, msg, ...extra }),
    error: (msg, extra = {}) => write('error', { ...base, msg, ...extra }),

    /**
     * 衍生 scoped logger（合併 base）
     * @param {object} extraBase
     */
    child(extraBase = {}) {
      return createLogger({ ...base, ...extraBase });
    },

    /**
     * 記錄 LLM token usage（給帳單 / 成本分析）
     * @param {{prompt_tokens?:number, completion_tokens?:number, total_tokens?:number, model?:string, provider?:string}} usage
     */
    usage(usage = {}) {
      write('info', {
        ...base,
        msg: 'llm_usage',
        provider: usage.provider,
        model: usage.model,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0
      });
    },

    /**
     * 包住一段 async 工作並自動計時、log start/end
     * @template T
     * @param {string} task
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async time(task, fn) {
      const start = Date.now();
      write('info', { ...base, msg: `${task}.start` });
      try {
        const result = await fn();
        write('info', { ...base, msg: `${task}.done`, durationMs: Date.now() - start });
        return result;
      } catch (e) {
        write('error', { ...base, msg: `${task}.error`, durationMs: Date.now() - start, error: e?.message });
        throw e;
      }
    }
  };
}

// 預設 logger（無 base context）
export const logger = createLogger();
export default logger;
