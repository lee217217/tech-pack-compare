/**
 * Phase 3 Round 1 — mock 模式驗收。
 * 直接 import 每個 function 的 handler 並模擬 Netlify event，
 * 不用 netlify dev 啟動本機 server，方便 CI / 沙箱跑。
 */
import { handler as healthHandler } from '../netlify/functions/health.js';
import { handler as runWorkflowHandler } from '../netlify/functions/run-workflow.js';
import { handler as extractHandler } from '../netlify/functions/extract.js';
import { handler as measurementHandler } from '../netlify/functions/measurement.js';
import { handler as commentsHandler } from '../netlify/functions/comments.js';
import { handler as imagesHandler } from '../netlify/functions/images.js';
import { handler as bomHandler } from '../netlify/functions/bom.js';
import { handler as summarizeHandler } from '../netlify/functions/summarize.js';

const ADMIN = 'ADMIN-TEST-2026';
const USER = 'USER-DEMO-001';

function makeEvent({ method = 'POST', body = {}, license = USER, isBase64 = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    origin: 'http://localhost:3000'
  };
  if (license) headers['x-license-key'] = license;
  return {
    httpMethod: method,
    path: '/.netlify/functions/test',
    headers,
    isBase64Encoded: isBase64,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function makeSampleInput() {
  return {
    techPackA: {
      rawText: 'Brand: ACME\nStyle: ST-2026-001\nSeason: SS26\n\nSIZE TABLE\nChest Width M: 50cm\nBody Length M: 70cm\n\nBOM\nFabric: 100% Cotton Jersey 180gsm, Navy, 1.2 YD, Luen Thai Textiles'
    },
    techPackB: {
      rawText: 'Brand: ACME\nStyle: ST-2026-001\nSeason: SS26\n\nSIZE TABLE\nChest Width M: 51.5cm\nBody Length M: 70cm\n\nBOM\nFabric: 100% Cotton Jersey 200gsm, Navy, 1.35 YD, Luen Thai Textiles'
    },
    buyerComments: 'Please confirm chest revision.'
  };
}

async function call(name, handler, event) {
  const res = await handler(event, {});
  const parsed = (() => { try { return JSON.parse(res.body); } catch { return null; } })();
  return { name, statusCode: res.statusCode, body: parsed, raw: res };
}

const results = [];

// ----- Test 1: GET /health -----
results.push(await call('1. GET /health',
  healthHandler,
  makeEvent({ method: 'GET', license: null })
));

// ----- Test 2: POST /run-workflow (FULL) -----
results.push(await call('2. POST /run-workflow FULL',
  runWorkflowHandler,
  makeEvent({ body: { ...makeSampleInput(), outputMode: 'FULL' } })
));

// ----- Test 3: POST /run-workflow (BOM_ONLY) -----
results.push(await call('3. POST /run-workflow BOM_ONLY',
  runWorkflowHandler,
  makeEvent({ body: { ...makeSampleInput(), outputMode: 'BOM_ONLY' } })
));

// ----- Test 4: POST /run-workflow (DEBUG_ALL, admin license) -----
results.push(await call('4. POST /run-workflow DEBUG_ALL (admin)',
  runWorkflowHandler,
  makeEvent({ body: { ...makeSampleInput(), outputMode: 'DEBUG_ALL' }, license: ADMIN })
));

// ----- Test 5: POST /measurement -----
results.push(await call('5. POST /measurement',
  measurementHandler,
  makeEvent({ body: makeSampleInput() })
));

// ----- Test 6: POST /bom -----
results.push(await call('6. POST /bom',
  bomHandler,
  makeEvent({ body: makeSampleInput() })
));

// ----- Test 7: 缺 license → 401 -----
results.push(await call('7. POST /run-workflow without license',
  runWorkflowHandler,
  makeEvent({ body: makeSampleInput(), license: null })
));

// ----- Test 8: rate limit (連敲 12 次 USER license) -----
// 為避免污染其他測試，用一個獨立 license 把 quota 打爆
const SPAM = 'ADMIN-TEST-2026'; // 用 admin 因為 LICENSE_KEYS env 不一定設了 USER-DEMO-001
let last429 = null;
for (let i = 0; i < 15; i++) {
  const r = await call('rate-spam-' + i, runWorkflowHandler, makeEvent({ body: makeSampleInput(), license: SPAM }));
  if (r.statusCode === 429) { last429 = r; break; }
}
results.push({
  name: '8. rate limit (spam)',
  statusCode: last429?.statusCode || 'NEVER_LIMITED',
  body: last429?.body || null
});

// ----- Test 9: 25MB payload → 413 -----
const bigPayload = { junk: 'x'.repeat(26 * 1024 * 1024) };
results.push(await call('9. POST /run-workflow huge payload',
  runWorkflowHandler,
  makeEvent({ body: bigPayload, license: ADMIN })
));

// ----- Test 10: malformed JSON → 400 -----
results.push(await call('10. POST /run-workflow malformed JSON',
  runWorkflowHandler,
  makeEvent({ body: '{not json', license: ADMIN })
));

// ----- Summary -----
console.log('\n========== PHASE 3 ROUND 1 — MOCK MODE ==========\n');
for (const r of results) {
  const summary = {
    statusCode: r.statusCode,
    success: r.body?.success,
    error_code: r.body?.error?.code,
    error_msg: r.body?.error?.message,
    output_mode: r.body?.data?.output_mode,
    provider: r.body?.meta?.provider,
    has_debug: !!r.body?.meta?.debug,
    qa: r.body?.data?.artifacts?.qa_review?.status,
    log: r.body?.data?.workflow_log?.map((x) => [x.agent, x.status])
  };
  console.log(`▸ ${r.name}`);
  console.log('  ' + JSON.stringify(summary));
  console.log();
}
