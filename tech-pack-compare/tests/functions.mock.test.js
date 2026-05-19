/*
  Path:     tests/functions.mock.test.js
  Purpose:  v2.1 — Netlify functions endpoint 在 mock 模式直接 import handler 驗證
            (零 server, 零依賴, node --test)
            v2.1: Open Mode 啟用 — 無 license 也能跑;admin license 解 DEBUG_ALL;
            IP rate limit 31 連敲 → 429
  Depends:  netlify/functions/*.js
  Run:      LLM_PROVIDER=mock ADMIN_LICENSE_KEY=ADMIN-TEST-2026 \
              LICENSE_KEYS=ADMIN-TEST-2026,USER-DEMO-001 \
              node --test tests/functions.mock.test.js
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER       = 'mock';
process.env.ADMIN_LICENSE_KEY  = 'ADMIN-TEST-2026';
process.env.LICENSE_KEYS       = 'ADMIN-TEST-2026,USER-DEMO-001';

import { handler as healthHandler }      from '../netlify/functions/health.js';
import { handler as runWorkflowHandler } from '../netlify/functions/run-workflow.js';
import { handler as extractHandler }     from '../netlify/functions/extract.js';
import { handler as measurementHandler } from '../netlify/functions/measurement.js';
import { handler as commentsHandler }    from '../netlify/functions/comments.js';
import { handler as imagesHandler }      from '../netlify/functions/images.js';
import { handler as bomHandler }         from '../netlify/functions/bom.js';
import { handler as summarizeHandler }   from '../netlify/functions/summarize.js';
import { clearAll as clearRateLimit }    from '../src/services/rateLimiter.js';

const USER  = 'USER-DEMO-001';
const ADMIN = 'ADMIN-TEST-2026';

function makeEvent({ method = 'POST', body = {}, license = USER, ip = '127.0.0.1' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (license) headers['x-license-key'] = license;
  if (ip) headers['x-nf-client-connection-ip'] = ip;
  return {
    httpMethod: method,
    path: '/.netlify/functions/test',
    headers,
    isBase64Encoded: false,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

const SAMPLE = {
  techPackA: { rawText: 'Brand: ACME\nSIZE TABLE\nChest M: 50cm\nBOM\nFabric Cotton 1.2 YD' },
  techPackB: { rawText: 'Brand: ACME\nSIZE TABLE\nChest M: 51.5cm\nBOM\nFabric Cotton 1.35 YD' },
  buyerComments: 'Please confirm.'
};

const SAMPLE_PAGES = {
  techPackA: {
    fileName: 'old.pdf', fileSize: 12345, pageCount: 2,
    metadata: { title: 'OLD', author: null, pageCount: 2 },
    pages: [
      { page: 1, text: 'Brand: ACME Style: STYLE-001', isSizeTable: false, isBom: false, hasImage: false },
      { page: 2, text: 'SIZE TABLE\nChest M: 50cm', isSizeTable: true, isBom: false, hasImage: false }
    ],
    rawText: 'Brand: ACME Style: STYLE-001\nSIZE TABLE\nChest M: 50cm',
    sizeTablePages: [2], bomPages: [], relevantImages: []
  },
  techPackB: {
    fileName: 'new.pdf', fileSize: 12345, pageCount: 2,
    metadata: { title: 'NEW', author: null, pageCount: 2 },
    pages: [
      { page: 1, text: 'Brand: ACME Style: STYLE-001', isSizeTable: false, isBom: false, hasImage: false },
      { page: 2, text: 'SIZE TABLE\nChest M: 51.5cm', isSizeTable: true, isBom: false, hasImage: false }
    ],
    rawText: 'Brand: ACME Style: STYLE-001\nSIZE TABLE\nChest M: 51.5cm',
    sizeTablePages: [2], bomPages: [], relevantImages: []
  },
  buyerComments: 'Please confirm.'
};

async function callJson(handler, event) {
  const res = await handler(event, {});
  let body = null;
  try { body = JSON.parse(res.body); } catch {}
  return { statusCode: res.statusCode, body };
}

// 每個 test 自帶不同 IP 避免 rate limit 串擾;groupping tests 後 clearAll() 保險
function uniqIp() {
  return `10.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

/* ── 1. health (公開, 不需 license) ──────────────────── */
test('GET /health — 200 + success:true + provider:mock', async () => {
  const r = await callJson(healthHandler,
    makeEvent({ method: 'GET', body: '', license: null, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
  const prov = r.body?.data?.provider;
  if (typeof prov === 'string') {
    assert.equal(prov, 'mock');
  } else {
    assert.equal(prov?.active, 'mock', 'provider.active 應為 mock');
  }
});

/* ── 2. run-workflow FULL (USER license) ─────────────── */
test('POST /run-workflow FULL — 200 + 7 agent DONE', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE, output_mode: 'FULL' }, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
  assert.equal(r.body?.data?.output_mode, 'FULL');
  assert.equal(r.body?.data?.agentStatus?.qaReview, 'DONE');
});

/* ── 3. run-workflow DEBUG_ALL — non-admin 降級 ──────── */
test('POST /run-workflow DEBUG_ALL non-admin — 自動降級 FULL', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE, output_mode: 'DEBUG_ALL' }, license: USER, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.data?.output_mode, 'FULL', '非 admin DEBUG_ALL 應降級');
});

/* ── 4. run-workflow DEBUG_ALL — admin 保留 + debugAllowed=true ── */
test('POST /run-workflow DEBUG_ALL admin — 保留 DEBUG_ALL + meta.debug', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE, output_mode: 'DEBUG_ALL' }, license: ADMIN, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.data?.output_mode, 'DEBUG_ALL');
  assert.ok(r.body?.meta?.debug, 'meta.debug 應存在');
});

/* ── 5. POST /measurement ─────────────────────────────── */
test('POST /measurement — 200 + success:true', async () => {
  const r = await callJson(measurementHandler, makeEvent({ body: SAMPLE, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
});

/* ── 6. POST /bom ───────────────────────────────────── */
test('POST /bom — 200 + success:true', async () => {
  const r = await callJson(bomHandler, makeEvent({ body: SAMPLE, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
});

/* ── 7. POST /extract /comments /images /summarize 全部 200 */
test('POST /extract /comments /images /summarize — 全部 200', async () => {
  for (const [name, h] of [
    ['extract',   extractHandler],
    ['comments',  commentsHandler],
    ['images',    imagesHandler],
    ['summarize', summarizeHandler]
  ]) {
    const r = await callJson(h, makeEvent({ body: SAMPLE, ip: uniqIp() }));
    assert.equal(r.statusCode, 200, `${name} 應 200, 實為 ${r.statusCode}`);
    assert.equal(r.body?.success, true, `${name} success 應 true`);
  }
});

/* ── 8. v2.1 Open Mode — 無 license 也能 200 ──────────── */
test('Open Mode — 無 license 也能 200 (effective license=OPEN-ACCESS)', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: SAMPLE, license: null, ip: uniqIp() }));
  assert.equal(r.statusCode, 200, '無 license 應 200');
  assert.equal(r.body?.success, true);
});

/* ── 9. v2.1 structured pages payload — extractor 能接 ── */
test('POST /run-workflow — structured pages payload (v2.1)', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE_PAGES, output_mode: 'FULL' }, ip: uniqIp() }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
  assert.equal(r.body?.data?.agentStatus?.extractor, 'DONE');
});

/* ── 10. malformed JSON 回 400 ─────────────────────────── */
test('POST /run-workflow — malformed JSON 回 400', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: 'not-json-{', ip: uniqIp() }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.body?.error?.code, 'BAD_REQUEST');
});

/* ── 11. IP rate limit — 同 IP 31 連敲 extract (POST, rate-limited) → 第 31 ≤ 429 */
test('IP rate limit — 同 IP 連敲 31 次, 至少一次 429', async () => {
  clearRateLimit();
  const ip = '10.99.99.31';
  let blocked = false;
  let blockedAt = -1;
  for (let i = 1; i <= 31; i++) {
    const r = await callJson(extractHandler,
      makeEvent({ body: { techPack: { rawText: 'X' } }, license: null, ip }));
    if (r.statusCode === 429) { blocked = true; blockedAt = i; break; }
  }
  assert.equal(blocked, true, `31 次連敲應觸發 429 (per-min=30), blockedAt=${blockedAt}`);
  clearRateLimit();
});
