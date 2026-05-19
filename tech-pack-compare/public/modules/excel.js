/*
  Path:     public/modules/excel.js
  Purpose:  SheetJS 7-sheet 匯出 — Cover / Summary / Measurement / Comments&Images / BOM / QA / Workflow Log
  Depends:  window.XLSX (SheetJS CDN), ./i18n.js, ./ui.js
*/

import { I18N } from './i18n.js';
import { sevClassForBomLike, sevClassForMeasurement } from './ui.js';

function sevColorHex(cls) {
  if (cls === 'sev-RED') return 'FEE2E2';
  if (cls === 'sev-YELLOW') return 'FEF3C7';
  if (cls === 'sev-GREY') return 'E5E7EB';
  return null;
}

function colorRows(sheet, dataRowCount, colCount, getColorFn) {
  for (let i = 0; i < dataRowCount; i++) {
    const color = getColorFn(i);
    if (!color) continue;
    for (let c = 0; c < colCount; c++) {
      const addr = window.XLSX.utils.encode_cell({ r: i + 1, c });
      const cell = sheet[addr];
      if (!cell) continue;
      cell.s = cell.s || {};
      cell.s.fill = { fgColor: { rgb: color }, patternType: 'solid' };
    }
  }
}

/**
 * @param {object} env  envelope 形 { success, data:{...}, meta:{...} }
 * @param {object} ctx  { styleNumber, brandName, season, outputMode }
 */
export function exportEnvelopeToXlsx(env, ctx = {}) {
  if (!env || !window.XLSX) return null;
  const XLSX = window.XLSX;
  const arts = env.data?.artifacts || {};
  const meta = env.meta || {};

  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Cover ─────────────────────────────────────
  const cover = [
    ['AI Tech Pack Comparator — 比對報告'],
    [],
    ['款式編號 (Style)',     ctx.styleNumber || ''],
    ['品牌 (Brand)',          ctx.brandName   || ''],
    ['季度 (Season)',         ctx.season       || ''],
    ['輸出模式 (Output Mode)', ctx.outputMode  || ''],
    [],
    ['Request ID',  env.data?.request_id || ''],
    ['版本',         meta.version    || ''],
    ['Provider',     meta.provider   || ''],
    ['Model',        meta.model_used || ''],
    ['Token 使用',   meta.total_tokens || 0],
    ['處理時間 (ms)', meta.duration_ms  || 0],
    ['快取命中',      meta.cached ? '是' : '否'],
    ['匯出時間',      new Date().toISOString()],
    [],
    ['Warnings'],
    ...((meta.warnings || []).map((w) => [String(w)]))
  ];
  const coverSheet = XLSX.utils.aoa_to_sheet(cover);
  coverSheet['!cols'] = [{ wch: 24 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, coverSheet, 'Cover');

  // ─── Sheet 2: 總結 ─────────────────────────────────────
  const sum = arts.summary || {};
  const sumRows = [
    ['── 統計 ──'],
    ['總變更',   sum.total_changes ?? 0],
    ['尺寸變更', sum.total_measurement_changes ?? 0],
    ['註解項',   sum.total_comment_items ?? 0],
    ['圖像變更', sum.total_image_changes ?? 0],
    ['BOM 變更', sum.total_bom_changes ?? 0],
    [],
    ['── 重點摘要 ──'],
    ...(sum.bullet_points || []).map((b) => [b]),
    [],
    ['── 成本風險 ──'],
    ...(sum.cost_risk_items || []).map((b) => [b]),
    [],
    ['── 生產風險 ──'],
    ...(sum.production_risk_items || []).map((b) => [b]),
    [],
    ['── 決策建議 ──'],
    ['標題', '詳述', '影響 POM'],
    ...(sum.decisions || []).map((d) => [d.title, d.detail, (d.impacted_poms || []).join(', ')])
  ];
  const sumSheet = XLSX.utils.aoa_to_sheet(sumRows);
  sumSheet['!cols'] = [{ wch: 22 }, { wch: 60 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, sumSheet, '總結');

  // ─── Sheet 3: 尺寸變更 ─────────────────────────────────
  const mHeader = ['POM 代碼', 'POM 名稱', '尺碼', '舊值', '新值', '差異', '單位', '狀態', '超容差', '信心', '舊頁', '新頁'];
  const mRows = arts.measurement_changes || [];
  const mData = mRows.map((r) => [
    r.pom_code || '', r.pom_name, r.size_label, r.old_value, r.new_value, r.diff_value,
    r.unit, r.status, r.tolerance_exceeded ? '是' : '否', r.confidence,
    r.source_page_old, r.source_page_new
  ]);
  const mSheet = XLSX.utils.aoa_to_sheet([mHeader, ...mData]);
  mSheet['!cols'] = mHeader.map((h) => ({ wch: Math.max(h.length + 2, 10) }));
  colorRows(mSheet, mData.length, mHeader.length, (i) => {
    const r = mRows[i];
    return sevColorHex(sevClassForMeasurement(r?.status, r?.tolerance_exceeded));
  });
  XLSX.utils.book_append_sheet(wb, mSheet, '尺寸變更');

  // ─── Sheet 4: 註解與圖像 ───────────────────────────────
  const cHeader = ['類型', 'ID', '來源/變更類型', '內容/描述', '關聯 POM', '嚴重度', '信心'];
  const cAll = [
    ...((arts.comments || []).map((c) => ({
      kind: 'comment', row: [
        '註解', c.comment_id || '', c.source, c.comment_text, c.related_pom || '', c.severity, c.confidence
      ], item: c
    }))),
    ...((arts.images || []).map((i) => ({
      kind: 'image', row: [
        '圖像', i.image_id || '', i.change_type,
        `舊: ${i.before_desc || ''}\n新: ${i.after_desc || ''}\n差異: ${i.diff_summary || ''}`,
        '', '', i.confidence
      ], item: i
    })))
  ];
  const cSheet = XLSX.utils.aoa_to_sheet([cHeader, ...cAll.map((x) => x.row)]);
  cSheet['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 60 }, { wch: 18 }, { wch: 12 }, { wch: 8 }];
  colorRows(cSheet, cAll.length, cHeader.length, (i) => sevColorHex(sevClassForBomLike(cAll[i]?.item?.severity)));
  XLSX.utils.book_append_sheet(wb, cSheet, '註解與圖像');

  // ─── Sheet 5: 物料清單 ─────────────────────────────────
  const bHeader = ['料號', '類型', '描述', '顏色', '規格', '供應商', '舊用量', '新用量', '差異', '單位', '狀態', '影響', '嚴重度', '關聯 POM', '信心', '備註'];
  const bRows = arts.bom_changes || [];
  const bData = bRows.map((r) => [
    r.material_code || '', r.material_type, r.description, r.color || '', r.size_or_spec || '',
    r.supplier || '', r.old_qty, r.new_qty, r.diff_qty, r.unit || '', r.status, r.impact,
    r.severity, r.related_pom || '', r.confidence, r.notes || ''
  ]);
  const bSheet = XLSX.utils.aoa_to_sheet([bHeader, ...bData]);
  bSheet['!cols'] = bHeader.map((h) => ({ wch: Math.max(h.length + 2, 10) }));
  colorRows(bSheet, bData.length, bHeader.length, (i) => sevColorHex(sevClassForBomLike(bRows[i]?.severity)));
  XLSX.utils.book_append_sheet(wb, bSheet, '物料清單');

  // ─── Sheet 6: QA Review ────────────────────────────────
  const qa = arts.qa_review || {};
  const qHeader = ['嚴重度', 'Agent', '訊息'];
  // QA shape: status, overall_risk, recommendation, issues OR findings (兼容兩種)
  const qaList = qa.issues || qa.findings || [];
  const qData = qaList.map((f) => [f.severity, f.agent || '', f.message]);
  const qRows = [
    ['QA 狀態',  I18N.severity[qa.status] || qa.status || ''],
    ['整體風險', I18N.severity[qa.overall_risk] || qa.overall_risk || ''],
    ['建議',     qa.recommendation || ''],
    [],
    qHeader,
    ...qData
  ];
  const qSheet = XLSX.utils.aoa_to_sheet(qRows);
  qSheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, qSheet, 'QA Review');

  // ─── Sheet 7: Workflow Log ─────────────────────────────
  const logHeader = ['#', 'Agent', '狀態', '耗時(ms)', 'Tokens', 'Warnings', 'Error'];
  const log = env.data?.workflow_log || [];
  const logRows = log.map((row, idx) => [
    idx + 1,
    row.agent || row.name || '',
    row.status || '',
    row.duration_ms ?? '',
    row.tokens ?? row.total_tokens ?? '',
    Array.isArray(row.warnings) ? row.warnings.join(' · ') : (row.warnings || ''),
    row.error || ''
  ]);
  const logSheet = XLSX.utils.aoa_to_sheet([logHeader, ...logRows]);
  logSheet['!cols'] = [{ wch: 4 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 50 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, logSheet, 'Workflow Log');

  // ─── 檔名 ──────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const styleSlug = (ctx.styleNumber || 'STYLE')
    .toString()
    .replace(/[^A-Za-z0-9_\-]/g, '_')
    .slice(0, 32);
  const fname = `TechPack_${styleSlug}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fname);
  return fname;
}

export default { exportEnvelopeToXlsx };
