/*
  Path:     tests/schema.test.js
  Purpose:  Phase 5 — 7 個 schema 各跑 valid + invalid case (node --test, 零依賴)
  Depends:  node >=20 內建 test runner、ajv (package.json dep)、
            src/services/schemaValidator.js、src/services/mockProvider.js、
            src/schemas/index.js
  Run:      LLM_PROVIDER=mock node --test tests/schema.test.js
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, listSchemas } from '../src/services/schemaValidator.js';
import { SCHEMA_NAMES } from '../src/schemas/index.js';
import { buildMockArtifact } from '../src/services/mockProvider.js';

/* ── 1. listSchemas 必含 7 個 ──────────────────────────── */
test('schemaValidator listSchemas — 註冊 7 個 schema', () => {
  const names = listSchemas();
  assert.ok(names.length >= 7, `expected ≥7 schemas, got ${names.length}`);
  for (const k of Object.values(SCHEMA_NAMES)) {
    assert.ok(names.includes(k), `missing schema: ${k}`);
  }
});

/* ── 2. 每個 artifact schema 的 mock dummy 必須通過 ──── */
const ARTIFACT_SCHEMAS = [
  SCHEMA_NAMES.MEASUREMENT_CHANGE,
  SCHEMA_NAMES.COMMENT_ARTIFACT,
  SCHEMA_NAMES.IMAGE_ARTIFACT,
  SCHEMA_NAMES.BOM_ARTIFACT,
  SCHEMA_NAMES.SUMMARY_ARTIFACT,
  SCHEMA_NAMES.QA_REVIEW
];

for (const schemaName of ARTIFACT_SCHEMAS) {
  test(`schema valid case — ${schemaName} mock dummy 通過`, () => {
    const dummy = buildMockArtifact(schemaName);
    assert.ok(dummy, `mockProvider 沒有 ${schemaName} dummy`);
    const result = validate(schemaName, dummy);
    assert.equal(result.valid, true, `應通過但失敗: ${JSON.stringify(result.errors)}`);
  });
}

/* ── 3. invalid case: 缺 required field 必須 reject ──── */
test('schema invalid case — measurementChange 缺 pom_name 失敗', () => {
  const bad = buildMockArtifact(SCHEMA_NAMES.MEASUREMENT_CHANGE);
  delete bad.pom_name;
  const r = validate(SCHEMA_NAMES.MEASUREMENT_CHANGE, bad);
  assert.equal(r.valid, false, '應該失敗');
  assert.ok(r.errors && r.errors.length > 0, '應有錯誤訊息');
});

test('schema invalid case — bomArtifact severity enum 不接受小寫', () => {
  const bad = buildMockArtifact(SCHEMA_NAMES.BOM_ARTIFACT);
  bad.severity = 'major';                 // 必須 UPPERCASE
  const r = validate(SCHEMA_NAMES.BOM_ARTIFACT, bad);
  assert.equal(r.valid, false, '小寫 severity 應該 reject');
});

test('schema invalid case — additionalProperties:false 拒絕未知欄位', () => {
  const bad = buildMockArtifact(SCHEMA_NAMES.COMMENT_ARTIFACT);
  bad.unknown_field_xxx = 'should not be allowed';
  const r = validate(SCHEMA_NAMES.COMMENT_ARTIFACT, bad);
  assert.equal(r.valid, false, 'additionalProperties:false 應拒絕未知欄位');
});

test('schema invalid case — qaReview status enum 不接受 OK', () => {
  const bad = buildMockArtifact(SCHEMA_NAMES.QA_REVIEW);
  bad.status = 'OK';                      // 合法是 PASS / WARN / FAIL
  const r = validate(SCHEMA_NAMES.QA_REVIEW, bad);
  assert.equal(r.valid, false, '非法 status 應 reject');
});

/* ── 4. workflowResult envelope 整合驗證 ──────────────── */
test('schema valid case — workflowResult envelope 通過', () => {
  // 用 coordinator 跑一次 mock 拎合法 envelope
  // (這裡為簡化,只測 schema 本身;完整 envelope 由 coordinator.mock.test.js 驗)
  const envelope = {
    success: true,
    data: {
      request_id: 'req_test_001',
      output_mode: 'FULL',
      artifacts: {
        measurement_changes: [buildMockArtifact(SCHEMA_NAMES.MEASUREMENT_CHANGE)],
        comments:            [buildMockArtifact(SCHEMA_NAMES.COMMENT_ARTIFACT)],
        images:              [buildMockArtifact(SCHEMA_NAMES.IMAGE_ARTIFACT)],
        bom_changes:         [buildMockArtifact(SCHEMA_NAMES.BOM_ARTIFACT)],
        summary:             buildMockArtifact(SCHEMA_NAMES.SUMMARY_ARTIFACT),
        qa_review:           buildMockArtifact(SCHEMA_NAMES.QA_REVIEW)
      },
      agentStatus: {
        extractor:'DONE', measurement:'DONE', comment:'DONE',
        image:'DONE', bom:'DONE', summarizer:'DONE', qaReview:'DONE'
      },
      workflow_log: []
    },
    error: null,
    meta: {
      version: 'v2.0.0',
      duration_ms: 1234,
      total_tokens: 0,
      provider: 'mock',
      cached: false,
      warnings: []
    }
  };
  const r = validate(SCHEMA_NAMES.WORKFLOW_RESULT, envelope);
  assert.equal(r.valid, true, `envelope 應通過: ${JSON.stringify(r.errors)}`);
});
