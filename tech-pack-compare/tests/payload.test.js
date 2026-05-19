/*
  Path:     tests/payload.test.js
  Purpose:  v2.1 — validatePdfPayload 對 legacy / structured / oversize / image-truncation
            shape 的接受 / 拒絕 / warning 行為
  Run:      LLM_PROVIDER=mock node --test tests/payload.test.js
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'mock';

import { validatePdfPayload } from '../netlify/functions/_lib/workflowService.js';
import { FILE_LIMITS } from '../src/config/limits.js';

/* ── 1. legacy rawText shape 接受 ─────────────────────── */
test('validatePdfPayload — legacy rawText shape 接受', () => {
  const r = validatePdfPayload('techPackA', { rawText: 'Some text content' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
});

/* ── 2. v2.1 structured pages shape 接受 ──────────────── */
test('validatePdfPayload — v2.1 structured pages shape 接受', () => {
  const r = validatePdfPayload('techPackA', {
    fileName: 'old.pdf',
    fileSize: 12345,
    pageCount: 2,
    metadata: { title: 'OLD', author: null, pageCount: 2 },
    pages: [
      { page: 1, text: 'Hello', isSizeTable: false, isBom: false, hasImage: false },
      { page: 2, text: 'World SIZE TABLE', isSizeTable: true, isBom: false, hasImage: false }
    ],
    sizeTablePages: [2],
    bomPages: [],
    relevantImages: []
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
});

/* ── 3. 兩種都缺 → 400 ─────────────────────────────── */
test('validatePdfPayload — 同時缺 rawText 與 pages → 400', () => {
  const r = validatePdfPayload('techPackA', { fileName: 'empty.pdf' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_REQUEST');
  assert.equal(r.statusCode, 400);
});

/* ── 4. 非 object → 400 ─────────────────────────────── */
test('validatePdfPayload — null / 非 object → 400', () => {
  const r1 = validatePdfPayload('techPackA', null);
  const r2 = validatePdfPayload('techPackA', 'string');
  assert.equal(r1.ok, false);
  assert.equal(r1.statusCode, 400);
  assert.equal(r2.ok, false);
});

/* ── 5. pages 結構不完整 → warning ───────────────────── */
test('validatePdfPayload — pages 缺 page/text 欄位 → warning', () => {
  const r = validatePdfPayload('techPackA', {
    pages: [{ page: 1, text: 'ok' }, { wrong: 'shape' }]
  });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length >= 1);
  assert.ok(r.warnings.some(w => w.includes('pages')));
});

/* ── 6. payload > 5MB → warning ──────────────────────── */
test('validatePdfPayload — >5MB payload 觸發 warning', () => {
  // 構造 ~6MB rawText
  const bigText = 'A'.repeat(6 * 1024 * 1024);
  const r = validatePdfPayload('techPackA', { rawText: bigText });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.includes('5MB')));
});

/* ── 7. relevantImages > maxImagePages 截斷 + warning ── */
test('validatePdfPayload — relevantImages 超過上限被截斷', () => {
  const cap = FILE_LIMITS.maxImagePages;
  const overflow = cap + 4;
  const imgs = Array.from({ length: overflow }, (_, i) => ({
    page: i + 1,
    base64: 'data:image/jpeg;base64,AAAA',
    region: 'full'
  }));
  const obj = { rawText: 'x', relevantImages: imgs };
  const r = validatePdfPayload('techPackA', obj);
  assert.equal(r.ok, true);
  assert.equal(obj.relevantImages.length, cap, 'relevantImages 應截到 cap');
  assert.ok(r.warnings.some(w => w.includes('relevantImages')));
});

/* ── 8. side 名稱會出現在 error 訊息 ─────────────────── */
test('validatePdfPayload — side 名稱出現在 error 訊息', () => {
  const r = validatePdfPayload('techPackB', null);
  assert.ok(String(r.message || '').includes('techPackB'));
});

/* ── 9. 同時 hasRaw + hasPages 也接受 ───────────────── */
test('validatePdfPayload — rawText + pages 同時存在 → 接受', () => {
  const r = validatePdfPayload('techPackA', {
    rawText: 'fallback text',
    pages: [{ page: 1, text: 'page text', isSizeTable: false, isBom: false }]
  });
  assert.equal(r.ok, true);
});
