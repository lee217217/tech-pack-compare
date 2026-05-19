/**
 * Path: src/config/limits.js
 * Purpose: 集中所有 numeric limits — 檔案大小、rate limit、timeout、token budget 等
 *          所有環境變數讀取都在這裡，避免散落各處
 * Depends on: 無
 *
 * 修改規則：
 *   - 不要在其他檔案直接讀 process.env，請走這裡
 *   - 新增 limit 時：(1) 加 const (2) 加 fromEnv 讀取 (3) 在 README/AGENTS.md 更新
 */

function intFromEnv(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function boolFromEnv(name, fallback) {
  const v = String(process.env[name] ?? '').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

// ───────────────────────── 檔案 ─────────────────────────
export const FILE_LIMITS = {
  /** 每份 PDF 最大 MB */
  maxFileMB: intFromEnv('MAX_FILE_MB', 20),
  /** 對應的 byte 數 */
  get maxFileBytes() { return this.maxFileMB * 1024 * 1024; },
  /** 只接受的 MIME */
  allowedMimeTypes: ['application/pdf'],
  /** 上傳圖像最大張數（每 side）— 給 imageAgent 用，避免 vision request 爆 */
  maxImagePages: 8
};

// ───────────────────────── Rate limit ─────────────────────────
export const RATE_LIMITS = {
  /** 每 IP 每分鐘 request 上限 */
  perMinute: intFromEnv('RATE_LIMIT_PER_MIN', 30),
  /** 每 IP 每日上限（Open Mode 防濫用） */
  perDayPerIp: intFromEnv('RATE_LIMIT_PER_DAY_IP', 500),
  /** 每 license key 每日上限（0 = 不限） */
  perDayPerLicense: intFromEnv('RATE_LIMIT_PER_DAY', 500),
  /** sliding window 大小 ms */
  windowMs: 60_000,
  /** rate limit cache TTL（過期才清） */
  cacheTtlMs: 5 * 60_000
};

// ───────────────────────── Timeout ─────────────────────────
export const TIMEOUTS = {
  /** 單次 LLM request 上限 ms */
  llmRequestMs: intFromEnv('REQUEST_TIMEOUT_MS', 55_000),
  /** 整個 coordinator workflow 上限 ms（Netlify Functions 預設 10s, background 15min） */
  workflowMs: intFromEnv('WORKFLOW_TIMEOUT_MS', 90_000),
  /** retry 最大次數（指數退避） */
  maxRetries: 3,
  /** retry 第一次間隔 ms（之後 *2 *2） */
  baseRetryMs: 800
};

// ───────────────────────── Token budget（避免單次塞太多） ─────────────────────────
export const TEXT_BUDGETS = {
  /** 每側 PDF 文字最多送多少 char 到 LLM（≈ token * 2.5） */
  perSidePdfText: intFromEnv('BUDGET_SIDE_PDF_TEXT', 18_000),
  /** Buyer comments */
  buyerComments: intFromEnv('BUDGET_BUYER_COMMENTS', 6_000),
  /** Image OCR raw text */
  imageOcrText: intFromEnv('BUDGET_IMAGE_OCR', 4_000)
};

// ───────────────────────── Feature flags ─────────────────────────
export const FEATURES = {
  enableQaReview: boolFromEnv('ENABLE_QA_REVIEW', true),
  /** 是否在 qaReviewAgent 里額外叫 LLM 做 AI review（預設 off，以免加倍 token 成本） */
  enableAiQaReview: boolFromEnv('ENABLE_AI_QA_REVIEW', false),
  enablePromptCache: boolFromEnv('ENABLE_PROMPT_CACHE', true),
  /** 允許並行跑 measurement / comment / image / bom agent */
  enableParallelAgents: boolFromEnv('ENABLE_PARALLEL_AGENTS', true),
  /**
   * v2.1 Open Mode: 預設 false—無 X-License-Key 也能跨接口
   * 未來付費版 v3 評估恢復 true
   */
  requireLicense: boolFromEnv('REQUIRE_LICENSE', false)
};

// ───────────────────────── CORS ─────────────────────────
export const CORS = {
  /** comma-separated origins，"*" 表示全開（dev only） */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
};

/**
 * 回傳整份 config snapshot（給 /health debug 用，會 redact 敏感資訊）
 */
export function snapshot() {
  return {
    file: { ...FILE_LIMITS, maxFileBytes: FILE_LIMITS.maxFileBytes },
    rate: RATE_LIMITS,
    timeout: TIMEOUTS,
    budgets: TEXT_BUDGETS,
    features: FEATURES,
    cors: CORS
  };
}

export default {
  FILE_LIMITS,
  RATE_LIMITS,
  TIMEOUTS,
  TEXT_BUDGETS,
  FEATURES,
  CORS,
  snapshot
};
