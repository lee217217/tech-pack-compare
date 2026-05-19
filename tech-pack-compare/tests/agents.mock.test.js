/*
  Path:     tests/agents.mock.test.js
  Purpose:  Phase 5 — 7 個 specialist agent 各自 mock 模式跑通 + 回傳結構符合 spec
  Depends:  src/agents/*Agent.js
  Run:      LLM_PROVIDER=mock node --test tests/agents.mock.test.js
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runExtractorAgent }   from '../src/agents/extractorAgent.js';
import { runMeasurementAgent } from '../src/agents/measurementAgent.js';
import { runCommentAgent }     from '../src/agents/commentAgent.js';
import { runImageAgent }       from '../src/agents/imageAgent.js';
import { runBomAgent }         from '../src/agents/bomAgent.js';
import { runSummarizerAgent }  from '../src/agents/summarizerAgent.js';
import { runQaReviewAgent }    from '../src/agents/qaReviewAgent.js';

process.env.LLM_PROVIDER = 'mock';

// ── shared mock input ─────────────────────────────────────
const REQ = 'req_agent_mock_001';
const SAMPLE_OLD = {
  rawText: 'Brand: ACME\nStyle: ST-2026-001\nSeason: SS26\n\nSIZE TABLE\nChest Width M: 50cm\nBody Length M: 70cm\n\nBOM\nFabric: 100% Cotton Jersey 180gsm, Navy, 1.2 YD, Luen Thai'
};
const SAMPLE_NEW = {
  rawText: 'Brand: ACME\nStyle: ST-2026-001\nSeason: SS26\n\nSIZE TABLE\nChest Width M: 51.5cm\nBody Length M: 70cm\n\nBOM\nFabric: 100% Cotton Jersey 200gsm, Navy, 1.35 YD, Luen Thai'
};

async function runExtract() {
  const r = await runExtractorAgent({
    input: { techPackA: SAMPLE_OLD, techPackB: SAMPLE_NEW, buyerComments: 'Please confirm chest revision.' },
    context: {},
    requestId: REQ
  });
  assert.equal(r.ok, true, `extractor 失敗: ${r.error || ''}`);
  return r.data;
}

/* ── 1. extractor ───────────────────────────────────────── */
test('extractorAgent — 解析兩份 doc 不 throw,回 ExtractedPackage', async () => {
  const data = await runExtract();
  assert.ok(data.docA && data.docB, '需含 docA / docB');
  assert.ok(Array.isArray(data.docA.pages), 'docA.pages 需為陣列');
  assert.ok(Array.isArray(data.docB.pages), 'docB.pages 需為陣列');
  assert.ok(data.docA.metadata && data.docB.metadata, '需含 metadata');
});

/* ── 2. measurement ─────────────────────────────────────── */
test('measurementAgent — mock 模式回傳 changes 陣列', async () => {
  const ext = await runExtract();
  const r = await runMeasurementAgent({ input: ext, context: {}, requestId: REQ });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data), 'data 應為陣列 (measurementChange[])');
});

/* ── 3. comment ─────────────────────────────────────────── */
test('commentAgent — mock 模式回傳 comments 陣列', async () => {
  const ext = await runExtract();
  const r = await runCommentAgent({ input: ext, context: {}, requestId: REQ });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data), 'data 應為陣列 (commentArtifact[])');
});

/* ── 4. image ───────────────────────────────────────────── */
test('imageAgent — mock 模式回傳 images 陣列 (text-based)', async () => {
  const ext = await runExtract();
  const r = await runImageAgent({ input: ext, context: {}, requestId: REQ });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data), 'data 應為陣列 (imageArtifact[])');
});

/* ── 5. bom ─────────────────────────────────────────────── */
test('bomAgent — mock 模式回傳 bom_changes 陣列', async () => {
  const ext = await runExtract();
  const r = await runBomAgent({ input: ext, context: {}, requestId: REQ });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data), 'data 應為陣列 (bomArtifact[])');
});

/* ── 6. summarizer ──────────────────────────────────────── */
test('summarizerAgent — mock 模式回 SummaryArtifact (含 bullet_points)', async () => {
  const ext = await runExtract();
  const m = await runMeasurementAgent({ input: ext, context: {}, requestId: REQ });
  const c = await runCommentAgent({ input: ext, context: {}, requestId: REQ });
  const i = await runImageAgent({ input: ext, context: {}, requestId: REQ });
  const b = await runBomAgent({ input: ext, context: {}, requestId: REQ });

  const r = await runSummarizerAgent({
    input: {
      measurement_changes: m.data,
      comments:            c.data,
      images:              i.data,
      bom_changes:         b.data
    },
    context: {},
    requestId: REQ
  });
  assert.equal(r.ok, true);
  assert.ok(r.data, 'summarizer 應回 data (SummaryArtifact)');
  assert.ok(Array.isArray(r.data.bullet_points), 'data.bullet_points 應為陣列');
});

/* ── 7. qaReview ────────────────────────────────────────── */
test('qaReviewAgent — mock 模式回 PASS/WARN/FAIL', async () => {
  const r = await runQaReviewAgent({
    input: {
      measurement_changes: [],
      comments: [],
      images: [],
      bom_changes: [],
      summary: {
        total_changes: 0,
        total_measurement_changes: 0,
        total_comment_items: 0,
        total_image_changes: 0,
        total_bom_changes: 0,
        bullet_points: [],
        cost_risk_items: [],
        production_risk_items: [],
        decisions: []
      }
    },
    context: {},
    requestId: REQ
  });
  assert.equal(r.ok, true);
  assert.ok(['PASS','WARN','FAIL'].includes(r.data.status), `status 應為 PASS/WARN/FAIL, 實為 ${r.data.status}`);
});

/* ── 8. agent 永不 throw 合約 ────────────────────────────── */
test('agent 永不 throw — 餵空 input 也只回 ok:false / warnings', async () => {
  const r = await runMeasurementAgent({ input: {}, context: {}, requestId: REQ });
  assert.ok(typeof r === 'object' && 'ok' in r, '必須回 { ok, ... } envelope');
});
