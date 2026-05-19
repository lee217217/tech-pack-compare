/**
 * Path: src/services/schemaValidator.js
 * Purpose: AJV 封裝 — 預編譯所有 schema，提供 validate(name, data) 統一介面
 *          所有 agent / coordinator 對 LLM 回應的合法性檢查都走這裡
 * Depends on:
 *   - ajv, ajv-formats (npm)
 *   - src/schemas/index.js (SCHEMAS, SCHEMA_NAMES)
 *   - src/utils/logger.js
 *
 * 為什麼預編譯：
 *   AJV.compile() 對複雜 schema 約 5-20ms，每次 validate 重新 compile 會白白吃 cold start 預算
 *   這裡在 module load 時把 6 份 schema 全部 compile 一次，之後 O(1) 查表
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS, SCHEMA_NAMES, SCHEMA_IDS } from '../schemas/index.js';
import { logger } from '../utils/logger.js';

const ajv = new Ajv2020({
  allErrors: true,             // 一次回所有錯誤，不要 fail-fast，方便 debug
  strict: false,               // 容許部分 vendor extension（例如 description）
  removeAdditional: false,     // 我們要 additionalProperties:false 嚴格擋下，不要靜默移除
  useDefaults: true,           // 套用 schema 內的 default 值
  coerceTypes: false           // 不自動轉型，保留 LLM 原本輸出讓 issue 可見
});
addFormats(ajv);

// 全部 schema 預先 addSchema（支援 $ref 跨檔）
for (const [name, schema] of Object.entries(SCHEMAS)) {
  try {
    ajv.addSchema(schema, schema.$id);
  } catch (e) {
    logger.error('schemaValidator.addSchema.failed', { name, error: e?.message });
  }
}

// 預編譯 validator
const VALIDATORS = {};
for (const name of Object.values(SCHEMA_NAMES)) {
  const id = SCHEMA_IDS[name];
  try {
    const v = ajv.getSchema(id);
    if (!v) {
      logger.error('schemaValidator.getSchema.notFound', { name, id });
      continue;
    }
    VALIDATORS[name] = v;
  } catch (e) {
    logger.error('schemaValidator.compile.failed', { name, error: e?.message });
  }
}

logger.info('schemaValidator.ready', {
  count: Object.keys(VALIDATORS).length,
  schemas: Object.keys(VALIDATORS)
});

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {Array<{ path: string, message: string, keyword: string, params?: object }>} errors
 * @property {*} value    經 default 套用後的物件（同一 reference，AJV mutate 原物件）
 */

/**
 * 驗證 data 是否符合指定 schema
 * @param {string} schemaName  必須是 SCHEMA_NAMES 中之一
 * @param {*} data
 * @returns {ValidationResult}
 */
export function validate(schemaName, data) {
  const validator = VALIDATORS[schemaName];
  if (!validator) {
    return {
      valid: false,
      errors: [{ path: '', message: `Unknown schema: ${schemaName}`, keyword: 'meta' }],
      value: data
    };
  }
  // AJV 會 mutate data（套用 default、coerce），我們先深拷貝避免污染原 input
  const cloned = deepClone(data);
  const ok = validator(cloned);
  return {
    valid: !!ok,
    errors: ok ? [] : (validator.errors || []).map(formatError),
    value: cloned
  };
}

/**
 * 等同 validate，但失敗時 throw —— 適用於「絕對應該合法」的 boundary 檢查
 * @param {string} schemaName
 * @param {*} data
 * @returns {*} 驗證後的 value
 */
export function validateOrThrow(schemaName, data) {
  const r = validate(schemaName, data);
  if (!r.valid) {
    const err = new Error(
      `Schema [${schemaName}] validation failed: ` +
      r.errors.slice(0, 3).map(e => `${e.path} ${e.message}`).join('; ')
    );
    err.code = 'SCHEMA_INVALID';
    err.errors = r.errors;
    throw err;
  }
  return r.value;
}

/**
 * 檢查 schema 是否已註冊
 * @param {string} schemaName
 * @returns {boolean}
 */
export function hasSchema(schemaName) {
  return !!VALIDATORS[schemaName];
}

/**
 * 取得已註冊 schema 名稱列表（給 /health debug 用）
 * @returns {string[]}
 */
export function listSchemas() {
  return Object.keys(VALIDATORS);
}

// ─────────────────────── 內部 helpers ───────────────────────

function formatError(e) {
  return {
    path: e.instancePath || '(root)',
    message: e.message || 'invalid',
    keyword: e.keyword,
    params: e.params
  };
}

function deepClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
  return out;
}

export default { validate, validateOrThrow, hasSchema, listSchemas };
