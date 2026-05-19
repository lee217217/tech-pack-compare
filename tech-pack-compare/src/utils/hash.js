/**
 * Path: src/utils/hash.js
 * Purpose: 統一 SHA-256 hashing 工具，給 cacheService / dedupe / requestId 用
 *          避免重複內容重送 LLM，節省 token
 * Depends on: Node.js 內建 `node:crypto`（Netlify Functions 已內建，不需額外裝）
 *
 * Design notes:
 *   - 全部 async-friendly：避免在 hot path 阻塞 event loop
 *   - 文字會先正規化（trim / 折疊空白）再 hash，避免格式雜訊造成 cache miss
 *   - 提供 short(8) / long(64) 兩種長度，前者用於 log，後者用於 cache key
 */

import { createHash, randomUUID } from 'node:crypto';

/**
 * 對文字做 SHA-256，回傳 64 字元 hex
 * @param {string} input
 * @returns {string}
 */
export function sha256(input) {
  const text = input == null ? '' : String(input);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 短 hash（前 8 字元）— 用於 log / requestId / 顯示
 * @param {string} input
 * @returns {string}
 */
export function shortHash(input) {
  return sha256(input).slice(0, 8);
}

/**
 * 對文字做正規化後再 hash —— 給 cache key 用
 * 將連續空白折疊成單一空格，去除前後空白
 * @param {string} input
 * @returns {string}
 */
export function normalizedHash(input) {
  const normalized = String(input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return sha256(normalized);
}

/**
 * 任意 JS 物件 → 穩定 hash（keys 排序後 JSON.stringify）
 * 用於 LLM request payload 去重
 * @param {object} obj
 * @returns {string}
 */
export function objectHash(obj) {
  return sha256(stableStringify(obj));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * 產生新的 request id（UUID v4，無 `-`，前綴 `req_`）
 * @returns {string}
 */
export function makeRequestId() {
  return 'req_' + randomUUID().replace(/-/g, '').slice(0, 16);
}

export default {
  sha256,
  shortHash,
  normalizedHash,
  objectHash,
  makeRequestId
};
