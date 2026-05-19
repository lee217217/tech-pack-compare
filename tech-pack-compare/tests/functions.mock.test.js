/*
  Path:     tests/functions.mock.test.js
  Purpose:  Phase 5 — 8 個 Netlify functions endpoint 在 mock 模式直接 import handler 驗證
            (零 server, 零依賴, node --test)
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

const USER  = 'USER-DEMO-001';
const ADMIN = 'ADMIN-TEST-2026';

function makeEvent({ method = 'POST', body = {}, license = USER } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (license) headers['x-license-key'] = license;
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

async function callJson(handler, event) {
  const res = await handler(event, {});
  let body = null;
  try { body = JSON.parse(res.body); } catch {}
  return { statusCode: res.statusCode, body };
}

/* ── 1. health (公開, 不需 license) ──────────────────── */
test('GET /health — 200 + success:true + provider:mock', async () => {
  const r = await callJson(healthHandler,
    makeEvent({ method: 'GET', body: '', license: null }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
  // /health 回 provider 為 object: { active, status, model_*, api_key_configured }
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
    makeEvent({ body: { ...SAMPLE, output_mode: 'FULL' } }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
  assert.equal(r.body?.data?.output_mode, 'FULL');
  assert.equal(r.body?.data?.agentStatus?.qaReview, 'DONE');
});

/* ── 3. run-workflow DEBUG_ALL — non-admin 降級 ──────── */
test('POST /run-workflow DEBUG_ALL non-admin — 自動降級 FULL', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE, output_mode: 'DEBUG_ALL' }, license: USER }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.data?.output_mode, 'FULL', '非 admin DEBUG_ALL 應降級');
});

/* ── 4. run-workflow DEBUG_ALL — admin 保留 ──────────── */
test('POST /run-workflow DEBUG_ALL admin — 保留 DEBUG_ALL + meta.debug', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: { ...SAMPLE, output_mode: 'DEBUG_ALL' }, license: ADMIN }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.data?.output_mode, 'DEBUG_ALL');
  assert.ok(r.body?.meta?.debug, 'meta.debug 應存在');
});

/* ── 5. POST /measurement (single agent) ─────────────── */
test('POST /measurement — 200 + success:true', async () => {
  const r = await callJson(measurementHandler, makeEvent({ body: SAMPLE }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
});

/* ── 6. POST /bom ───────────────────────────────────── */
test('POST /bom — 200 + success:true', async () => {
  const r = await callJson(bomHandler, makeEvent({ body: SAMPLE }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body?.success, true);
});

/* ── 7. POST /comments + /images + /summarize + /extract 全部 200 */
test('POST /extract /comments /images /summarize — 全部 200', async () => {
  for (const [name, h] of [
    ['extract',   extractHandler],
    ['comments',  commentsHandler],
    ['images',    imagesHandler],
    ['summarize', summarizeHandler]
  ]) {
    const r = await callJson(h, makeEvent({ body: SAMPLE }));
    assert.equal(r.statusCode, 200, `${name} 應 200, 實為 ${r.statusCode}`);
    assert.equal(r.body?.success, true, `${name} success 應 true`);
  }
});

/* ── 8. Auth & validation guards ─────────────────────── */
test('POST /run-workflow — 缺 license 回 401', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: SAMPLE, license: null }));
  assert.equal(r.statusCode, 401);
  assert.equal(r.body?.success, false);
  assert.equal(r.body?.error?.code, 'UNAUTHORIZED');
});

test('POST /run-workflow — malformed JSON 回 400', async () => {
  const r = await callJson(runWorkflowHandler,
    makeEvent({ body: 'not-json-{' }));
  assert.equal(r.statusCode, 400);
  assert.equal(r.body?.error?.code, 'BAD_REQUEST');
});
