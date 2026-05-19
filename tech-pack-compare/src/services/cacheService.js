/**
 * Path: src/services/cacheService.js
 * Purpose: 簡易 in-memory cache（hash 為 key）— 給 llmClient 重複 prompt 去重用
 *          Phase 6 可換成 Redis / Upstash，介面保持不變
 * Depends on:
 *   - src/utils/hash.js (normalizedHash / objectHash)
 *   - src/utils/logger.js
 *   - src/config/limits.js (FEATURES.enablePromptCache)
 *
 * 為什麼用 in-memory 已經夠：
 *   - Netlify Functions warm instance 會重用 module state，相鄰 request 可命中
 *   - 同一份 Tech Pack 不同 outputMode 重跑也省 token
 *   - cold start 後 cache 全失效，但這不影響正確性，只影響成本
 *
 * 限制：
 *   - max entries 1000，LRU eviction（最舊的先丟）
 *   - 預設 TTL 10 分鐘，可 per-key 覆寫
 *   - 不支援跨 instance 共享 — 多 region / 高並發場景請 Phase 6 升級
 */

import { normalizedHash, objectHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { FEATURES } from '../config/limits.js';

const DEFAULT_TTL_MS = 10 * 60_000;     // 10 min
const MAX_ENTRIES = 1000;

/** @type {Map<string, { value: any, expiresAt: number, hits: number }>} */
const store = new Map();
let totalHits = 0;
let totalMisses = 0;

/**
 * 對任意輸入產生穩定 cache key
 * 字串 → normalizedHash，物件 → objectHash
 * @param {string | object} input
 * @param {string} [namespace]  例如 agent name，避免不同 agent 撞 key
 * @returns {string}
 */
export function makeKey(input, namespace = 'default') {
  const h = typeof input === 'string' ? normalizedHash(input) : objectHash(input);
  return `${namespace}:${h}`;
}

/**
 * 取出 cache，過期或不存在回 undefined
 * @param {string} key
 * @returns {any | undefined}
 */
export function get(key) {
  if (!FEATURES.enablePromptCache) {
    totalMisses++;
    return undefined;
  }
  const entry = store.get(key);
  if (!entry) {
    totalMisses++;
    return undefined;
  }
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    totalMisses++;
    return undefined;
  }
  entry.hits++;
  // LRU：重新插入到尾端
  store.delete(key);
  store.set(key, entry);
  totalHits++;
  return entry.value;
}

/**
 * 寫入 cache
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlMs] 預設 10 分鐘
 */
export function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (!FEATURES.enablePromptCache) return;
  if (value === undefined) return;          // 不存 undefined（與 miss 衝突）

  // LRU eviction：超過上限時丟最舊的（Map 第一個 key）
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    hits: 0
  });
}

/**
 * 嘗試 get，miss 時呼叫 factory 產出並寫入
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} factory
 * @param {number} [ttlMs]
 * @returns {Promise<{ value: T, cached: boolean }>}
 */
export async function getOrSet(key, factory, ttlMs = DEFAULT_TTL_MS) {
  const cached = get(key);
  if (cached !== undefined) {
    return { value: cached, cached: true };
  }
  const value = await factory();
  set(key, value, ttlMs);
  return { value, cached: false };
}

/**
 * 手動清除某 key
 */
export function del(key) {
  return store.delete(key);
}

/**
 * 清空全部 — 主要給 test 用
 */
export function clearAll() {
  store.clear();
  totalHits = 0;
  totalMisses = 0;
}

/**
 * 取得 cache 統計（給 /health debug 用）
 */
export function stats() {
  return {
    enabled: FEATURES.enablePromptCache,
    size: store.size,
    maxSize: MAX_ENTRIES,
    hits: totalHits,
    misses: totalMisses,
    hitRate: (totalHits + totalMisses) > 0
      ? Number((totalHits / (totalHits + totalMisses)).toFixed(3))
      : 0
  };
}

logger.info('cacheService.ready', { enabled: FEATURES.enablePromptCache, maxEntries: MAX_ENTRIES });

export default { makeKey, get, set, getOrSet, del, clearAll, stats };
