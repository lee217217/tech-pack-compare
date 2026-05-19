/**
 * Path: src/services/rateLimiter.js
 * Purpose: 兩層配額限制 — (1) per IP 每分鐘 sliding window  (2) per license key 每日 hard limit
 *          也驗證 license key 是否在允許清單內
 * Depends on:
 *   - src/config/limits.js (RATE_LIMITS)
 *   - src/utils/logger.js
 *   - src/utils/i18n.js
 *
 * 設計：
 *   - 純 in-memory，與 cacheService 同一個 instance scope
 *   - Netlify Functions 多 instance 時不會精準（但 cost-controlling effect 仍在）
 *   - Phase 6 升 Redis 時保持 API 不變
 *
 * 介面：
 *   - checkLicense(licenseKey) → { allowed, reason? }
 *   - checkRate(ip, licenseKey) → { allowed, remaining, resetAt, reason? }
 *   - 推薦呼叫順序：先 checkLicense，再 checkRate（避免無 license 也吃配額）
 */

import { RATE_LIMITS, FEATURES } from '../config/limits.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';

/** v2.1 Open Mode 虛擬 license—無 X-License-Key 請求都用它 */
export const OPEN_ACCESS_LICENSE = 'OPEN-ACCESS';

/** @type {Map<string, number[]>}  per IP 的 timestamp 陣列（sliding window） */
const ipWindow = new Map();

/** @type {Map<string, { count: number, resetAt: number }>}  per license 每日計數 */
const licenseDaily = new Map();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 驗證 license key 是否在允許名單
 * @param {string} licenseKey
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkLicense(licenseKey) {
  // v2.1 Open Mode: 預設 requireLicense=false—無 / 連不上名單都放行當 OPEN-ACCESS
  const has = !!(licenseKey && typeof licenseKey === 'string' && licenseKey.trim());
  if (!FEATURES.requireLicense) {
    if (!has) return { allowed: true, effectiveLicense: OPEN_ACCESS_LICENSE, isAdmin: false };
    const trimmed = licenseKey.trim();
    const admin = (process.env.ADMIN_LICENSE_KEY || '').trim();
    const isAdmin = !!admin && trimmed === admin;
    return { allowed: true, effectiveLicense: trimmed, isAdmin };
  }
  // 厳格模式 (未來 v3 付費版)
  if (!has) {
    return { allowed: false, reason: t('error.missing_license') };
  }
  const allowed = getAllowedLicenses();
  if (!allowed.includes(licenseKey.trim())) {
    return { allowed: false, reason: t('error.invalid_license') };
  }
  const admin = (process.env.ADMIN_LICENSE_KEY || '').trim();
  return { allowed: true, effectiveLicense: licenseKey.trim(), isAdmin: !!admin && licenseKey.trim() === admin };
}

/**
 * 檢查兩級 rate limit（IP 每分鐘 + license 每日）
 * 注意：呼叫此函式即代表「消耗一格 quota」，請只在真正要 dispatch 工作前呼叫一次
 * @param {string} ip
 * @param {string} licenseKey 已通過 checkLicense
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, reason?: string }}
 */
export function checkRate(ip, licenseKey) {
  const now = Date.now();

  // ───── Layer 1: per IP sliding window ─────
  const ipKey = ip || 'unknown';
  const arr = ipWindow.get(ipKey) || [];
  // 移除過期 timestamp
  const fresh = arr.filter(ts => ts > now - RATE_LIMITS.windowMs);
  if (fresh.length >= RATE_LIMITS.perMinute) {
    const oldest = fresh[0];
    const resetAt = oldest + RATE_LIMITS.windowMs;
    const seconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
    ipWindow.set(ipKey, fresh);
    logger.warn('rateLimiter.ipBlocked', { ip: ipKey, count: fresh.length, limit: RATE_LIMITS.perMinute });
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: t('error.rate_limited', { seconds })
    };
  }

  // ───── Layer 2: per license daily quota ─────
  if (RATE_LIMITS.perDayPerLicense > 0) {
    const lic = licenseDaily.get(licenseKey);
    if (lic && lic.resetAt > now) {
      if (lic.count >= RATE_LIMITS.perDayPerLicense) {
        logger.warn('rateLimiter.licenseQuotaExceeded', { licensePrefix: licenseKey.slice(0, 6), count: lic.count });
        return {
          allowed: false,
          remaining: 0,
          resetAt: lic.resetAt,
          reason: t('error.rate_limited', { seconds: Math.ceil((lic.resetAt - now) / 1000) })
        };
      }
    }
  }

  // ───── 通過 → 記錄消耗 ─────
  fresh.push(now);
  ipWindow.set(ipKey, fresh);

  const lic = licenseDaily.get(licenseKey);
  if (!lic || lic.resetAt <= now) {
    licenseDaily.set(licenseKey, { count: 1, resetAt: now + ONE_DAY_MS });
  } else {
    lic.count++;
  }

  // 清理過舊 IP entries（不要無限長大）
  if (ipWindow.size > 5000) trimIpMap(now);

  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMITS.perMinute - fresh.length),
    resetAt: now + RATE_LIMITS.windowMs
  };
}

/**
 * 從 Request headers 抓 IP（順序：x-nf-client-connection-ip → x-forwarded-for → fallback）
 * @param {Headers | Record<string,string>} headers
 * @returns {string}
 */
export function extractIp(headers) {
  const get = (k) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(k) || '';
    return headers[k] || headers[k.toLowerCase()] || '';
  };
  const nf = get('x-nf-client-connection-ip');
  if (nf) return nf;
  const fwd = get('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  return 'unknown';
}

/**
 * 從 headers 抓 license key
 * @param {Headers | Record<string,string>} headers
 * @returns {string}
 */
export function extractLicense(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get('x-license-key') || '';
  return headers['x-license-key'] || headers['X-License-Key'] || '';
}

/**
 * 清空 state — test 用
 */
export function clearAll() {
  ipWindow.clear();
  licenseDaily.clear();
}

/**
 * 取得目前 state 統計（給 /health 用）
 */
export function stats() {
  return {
    activeIps: ipWindow.size,
    activeLicenses: licenseDaily.size,
    config: {
      perMinute: RATE_LIMITS.perMinute,
      perDayPerLicense: RATE_LIMITS.perDayPerLicense
    }
  };
}

// ─────────────────────── 內部 helpers ───────────────────────

function getAllowedLicenses() {
  const admin = (process.env.ADMIN_LICENSE_KEY || '').trim();
  const rest = (process.env.LICENSE_KEYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const all = [];
  if (admin) all.push(admin);
  all.push(...rest);
  // 完全沒設定時 (dev mode)：放行一個 fallback，但 log warn
  if (all.length === 0) {
    if (!getAllowedLicenses._warned) {
      logger.warn('rateLimiter.noLicenseConfigured', { msg: 'ADMIN_LICENSE_KEY / LICENSE_KEYS 均未設定，使用 DEV-OPEN 作 fallback。' });
      getAllowedLicenses._warned = true;
    }
    return ['DEV-OPEN'];
  }
  return all;
}

function trimIpMap(now) {
  for (const [ip, arr] of ipWindow) {
    const fresh = arr.filter(ts => ts > now - RATE_LIMITS.windowMs);
    if (fresh.length === 0) ipWindow.delete(ip);
    else ipWindow.set(ip, fresh);
  }
}

logger.info('rateLimiter.ready', {
  perMinute: RATE_LIMITS.perMinute,
  perDayPerLicense: RATE_LIMITS.perDayPerLicense
});

export default { checkLicense, checkRate, extractIp, extractLicense, clearAll, stats };
