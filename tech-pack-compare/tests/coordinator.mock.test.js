/*
  Path:     tests/coordinator.mock.test.js
  Purpose:  Phase 5 — 5 種 outputMode + DEBUG_ALL 降級驗證 (node --test, 零依賴)
  Depends:  src/agents/coordinatorAgent.js
  Run:      LLM_PROVIDER=mock node --test tests/coordinator.mock.test.js
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCoordinatorAgent,
  normalizeOutputMode,
  SUPPORTED_OUTPUT_MODES
} from '../src/agents/coordinatorAgent.js';

process.env.LLM_PROVIDER = 'mock';

const REQ = 'req_coord_001';

const INPUT = {
  techPackA: { rawText: 'Brand: ACME\nSIZE TABLE\nChest M: 50cm\nBOM\nFabric Cotton 1.2 YD' },
  techPackB: { rawText: 'Brand: ACME\nSIZE TABLE\nChest M: 51.5cm\nBOM\nFabric Cotton 1.35 YD' },
  buyerComments: 'Please confirm.'
};

async function run(outputMode, ctx = {}) {
  return runCoordinatorAgent({
    outputMode,
    input: INPUT,
    context: ctx,
    requestId: `${REQ}_${outputMode}`
  });
}

/* ── 1. normalizeOutputMode ───────────────────────────── */
test('normalizeOutputMode — 5 種大寫支援 + 預設 FULL', () => {
  for (const m of SUPPORTED_OUTPUT_MODES) assert.equal(normalizeOutputMode(m), m);
  assert.equal(normalizeOutputMode('full'), 'FULL');
  assert.equal(normalizeOutputMode('UNKNOWN_MODE'), 'FULL');
  assert.equal(normalizeOutputMode(null), 'FULL');
});

/* ── 2. FULL: 7 step DONE, artifacts 6 個齊 ───────────── */
test('coordinator FULL — 7 step 全 DONE,artifacts 6 個齊', async () => {
  const env = await run('FULL');
  assert.equal(env.success, true, `FULL 應成功: ${env.error?.message || ''}`);
  assert.equal(env.data.output_mode, 'FULL');
  const a = env.data.artifacts;
  assert.ok(Array.isArray(a.measurement_changes));
  assert.ok(Array.isArray(a.comments));
  assert.ok(Array.isArray(a.images));
  assert.ok(Array.isArray(a.bom_changes));
  assert.ok(a.summary);
  assert.ok(a.qa_review);
  for (const k of ['extractor','measurement','comment','image','bom','summarizer','qaReview']) {
    assert.equal(env.data.agentStatus[k], 'DONE', `${k} 應 DONE`);
  }
});

/* ── 3. SUMMARY: 只回 summary + qa_review ─────────────── */
test('coordinator SUMMARY — 只回 summary + qa_review', async () => {
  const env = await run('SUMMARY');
  assert.equal(env.success, true);
  assert.equal(env.data.output_mode, 'SUMMARY');
  assert.ok(env.data.artifacts.summary, 'summary 應存在');
});

/* ── 4. MEASUREMENT_ONLY: 跳過 comment/image/bom ───────── */
test('coordinator MEASUREMENT_ONLY — 跳過 comment/image/bom', async () => {
  const env = await run('MEASUREMENT_ONLY');
  assert.equal(env.success, true);
  assert.equal(env.data.output_mode, 'MEASUREMENT_ONLY');
  assert.equal(env.data.agentStatus.measurement, 'DONE');
  assert.equal(env.data.agentStatus.comment,  'SKIPPED');
  assert.equal(env.data.agentStatus.image,    'SKIPPED');
  assert.equal(env.data.agentStatus.bom,      'SKIPPED');
});

/* ── 5. BOM_ONLY: 跳過 measurement/comment/image ──────── */
test('coordinator BOM_ONLY — 跳過 measurement/comment/image', async () => {
  const env = await run('BOM_ONLY');
  assert.equal(env.success, true);
  assert.equal(env.data.output_mode, 'BOM_ONLY');
  assert.equal(env.data.agentStatus.bom,         'DONE');
  assert.equal(env.data.agentStatus.measurement, 'SKIPPED');
  assert.equal(env.data.agentStatus.comment,     'SKIPPED');
  assert.equal(env.data.agentStatus.image,       'SKIPPED');
});

/* ── 6. DEBUG_ALL: 需 admin context ──────────────────── */
test('coordinator DEBUG_ALL — 無 admin 自動降級 FULL', async () => {
  const env = await run('DEBUG_ALL', { debugAllowed: false });
  assert.equal(env.success, true);
  assert.equal(env.data.output_mode, 'FULL', 'DEBUG_ALL 無權限應降級 FULL');
  assert.equal(!!env.meta.debug, false, 'meta.debug 不應出現');
});

test('coordinator DEBUG_ALL — admin context 保留 DEBUG_ALL + meta.debug', async () => {
  const env = await run('DEBUG_ALL', { debugAllowed: true });
  assert.equal(env.success, true);
  assert.equal(env.data.output_mode, 'DEBUG_ALL');
  assert.ok(env.meta.debug, 'meta.debug 應出現');
});

/* ── 7. envelope shape contract ──────────────────────── */
test('coordinator envelope — 含 success/data/error/meta 必填欄位', async () => {
  const env = await run('FULL');
  assert.ok('success' in env);
  assert.ok('data' in env);
  assert.ok('error' in env);
  assert.ok('meta' in env);
  assert.equal(env.meta.version, 'v2.0.0');
  assert.equal(env.meta.provider, 'mock');
  assert.ok(typeof env.meta.duration_ms === 'number');
  assert.ok(typeof env.meta.total_tokens === 'number', 'meta.total_tokens 必須是 number (KI-006)');
  assert.ok(Array.isArray(env.data.workflow_log));
});

/* ── 8. KI-006: workflow_log[].tokens_used 欄位存在 ───── */
test('coordinator workflow_log — 每筆都有 tokens_used 欄位 (KI-006 fix)', async () => {
  const env = await run('FULL');
  for (const entry of env.data.workflow_log) {
    assert.ok('tokens_used' in entry, `${entry.agent} 缺 tokens_used 欄位`);
    assert.ok(typeof entry.tokens_used === 'number', `${entry.agent}.tokens_used 必須是 number`);
  }
});
