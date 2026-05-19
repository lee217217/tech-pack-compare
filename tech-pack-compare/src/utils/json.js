/**
 * Path: src/utils/json.js
 * Purpose: JSON 工具集 — safeStringify / safeParse / extractFirstJson / deepMerge
 *          所有 LLM 回應「應該是 JSON 但常常被包在 markdown code block」的場景都走這裡
 * Depends on: 無
 *
 * Design notes:
 *   - safeParse 失敗時不丟錯，回傳 { ok:false, error }
 *   - extractFirstJson 處理三種常見 LLM 輸出格式：
 *       1. 純 JSON
 *       2. ```json ... ``` 包起來
 *       3. 前後夾雜「Here is the result:」之類的散文
 *   - deepMerge 只 merge object，array 採覆蓋（避免 schema 衝突）
 */

/**
 * 安全 stringify：循環引用會被替換成 "[Circular]"，避免 crash
 * @param {*} value
 * @param {number} [indent=0]
 * @returns {string}
 */
export function safeStringify(value, indent = 0) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return undefined;
    return v;
  }, indent);
}

/**
 * 安全 JSON.parse
 * @param {string} text
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
export function safeParse(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'safeParse 收到非字串輸入' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e?.message || 'JSON parse 失敗' };
  }
}

/**
 * 從可能夾雜 markdown / 散文的字串中抓出第一個 JSON 物件或陣列
 * 例如 LLM 回:  "Here you go:\n```json\n{...}\n```\nDone."
 * @param {string} text
 * @returns {{ ok: true, value: any } | { ok: false, error: string, raw: string }}
 */
export function extractFirstJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: '空字串', raw: '' };
  }

  // 1) 先試直接 parse（最快 path）
  const direct = safeParse(text.trim());
  if (direct.ok) return direct;

  // 2) 抓 ```json ... ``` 或 ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    const fenced = safeParse(fence[1].trim());
    if (fenced.ok) return fenced;
  }

  // 3) 抓第一個 { ... } 或 [ ... ]（用 bracket 配對，比 regex 穩）
  const obj = sliceFirstBalanced(text, '{', '}');
  if (obj) {
    const r = safeParse(obj);
    if (r.ok) return r;
  }
  const arr = sliceFirstBalanced(text, '[', ']');
  if (arr) {
    const r = safeParse(arr);
    if (r.ok) return r;
  }

  return { ok: false, error: '找不到有效 JSON 結構', raw: text.slice(0, 500) };
}

/**
 * 找第一個平衡 bracket 包起來的 substring
 * 注意字串內的 quote / escape 處理，避免被內容裡的 `}` 騙到
 * @param {string} text
 * @param {'{'|'['} open
 * @param {'}'|']'} close
 */
function sliceFirstBalanced(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Deep merge：source 蓋掉 target 上同 key 的值
 * Array 採覆蓋（不 concat）— 避免合併兩份 differences 時意外 duplicate
 * @param {object} target
 * @param {object} source
 * @returns {object} 新物件（不 mutate input）
 */
export function deepMerge(target, source) {
  if (!isPlainObject(target)) return clone(source);
  if (!isPlainObject(source)) return clone(target);

  const out = { ...target };
  for (const key of Object.keys(source)) {
    const a = target[key];
    const b = source[key];
    if (isPlainObject(a) && isPlainObject(b)) {
      out[key] = deepMerge(a, b);
    } else if (b === undefined) {
      out[key] = a;
    } else {
      out[key] = clone(b);
    }
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}

/**
 * 從 LLM 回應 message.content 抓 JSON，shortcut 版
 * @param {string} content
 * @param {*} fallback
 */
export function parseLlmJson(content, fallback = null) {
  const r = extractFirstJson(content);
  return r.ok ? r.value : fallback;
}

export default {
  safeStringify,
  safeParse,
  extractFirstJson,
  deepMerge,
  parseLlmJson
};
