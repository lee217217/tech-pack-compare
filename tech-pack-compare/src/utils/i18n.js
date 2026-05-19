/**
 * Path: src/utils/i18n.js
 * Purpose: 繁體中文（香港）文案字典 + 簡易 t() 函式
 *          所有給 user 看的文字（UI、錯誤、agent fallback summary）走這裡
 *          未來要加英文版只要新增一個 dict + 改 currentLocale 即可
 * Depends on: 無
 *
 * Usage:
 *   import { t } from '../utils/i18n.js';
 *   t('error.file_too_large', { mb: 25 });
 *   → 「檔案過大（25MB），上限為 20MB。」
 */

const DICT = {
  'zh-HK': {
    // ───── 通用 ─────
    'common.ok': '成功',
    'common.failed': '失敗',
    'common.unknown_error': '發生未知錯誤，請稍後再試。',
    'common.timeout': '請求逾時，請稍後再試。',
    'common.loading': '處理中…',

    // ───── 錯誤 ─────
    'error.missing_input': '缺少必要輸入。',
    'error.invalid_file_type': '檔案格式不正確，只接受 PDF。',
    'error.file_too_large': '檔案過大（{mb}MB），上限為 {max}MB。',
    'error.rate_limited': '請求過於頻繁，請於 {seconds} 秒後再試。',
    'error.invalid_license': 'License Key 無效或已過期。',
    'error.missing_license': '缺少 License Key。',
    'error.llm_failed': 'AI 模型呼叫失敗：{reason}。已使用備用結果，建議稍後重試。',
    'error.schema_invalid': 'AI 回應格式不正確，已使用備用結果。',
    'error.workflow_crashed': '工作流程發生錯誤，請重試或聯絡管理員。',
    'error.invalid_method': '請求方法不被允許，只接受 {expected}。',
    'error.invalid_json_body': '請求 body 不是合法 JSON。',
    'error.payload_too_large': 'Payload 過大（{mb}MB），上限 {max}MB。',
    'error.internal': '伺服器內部錯誤，請稍後再試。',
    'error.bad_request': '請求內容不正確：{detail}。',

    // ───── Agent 顯示名稱（給進度條用）─────
    'agent.extractor': '文字 / 圖像提取',
    'agent.measurement': '尺寸表比對',
    'agent.comment': '客戶 COMMENT 分析',
    'agent.image': '圖像差異識別',
    'agent.summarizer': '整合報告',
    'agent.qaReview': '品質複核',
    'agent.coordinator': '工作流程編排',

    // ───── Agent 狀態 ─────
    'status.pending': '等待中',
    'status.running': '進行中',
    'status.done': '完成',
    'status.error': '失敗',
    'status.skipped': '略過',

    // ───── 報告區塊標題 ─────
    'report.summary': '摘要',
    'report.measurement_changes': '尺寸變更',
    'report.comments_and_images': '客戶意見與圖像',
    'report.action_items': '跟進事項',
    'report.decisions': '建議決策',
    'report.qa_review': '品質複核',

    // ───── 表格欄位 ─────
    'table.pom': 'POM 編號',
    'table.description': '說明',
    'table.old_size': '舊版尺寸',
    'table.new_size': '新版尺寸',
    'table.diff': '差異',
    'table.status': '狀態',
    'table.confidence': '可信度',

    // ───── Diff status ─────
    'diff.added': '新增',
    'diff.removed': '移除',
    'diff.changed': '修改',
    'diff.unchanged': '未變更',

    // ───── Fallback 文案 ─────
    'fallback.no_diff_found': '未發現明顯差異，建議人手再次檢視。',
    'fallback.measurement_unavailable': '尺寸表資料不足，未能進行自動比對。',
    'fallback.summary_unavailable': '部分 AI 服務暫時無法使用，以下為簡化版報告。',

    // ───── 按鈕 ─────
    'button.run': '開始比對',
    'button.copy': '複製',
    'button.export_excel': '匯出 Excel',
    'button.export_summary': '匯出摘要',
    'button.toggle_theme': '切換深色 / 淺色',
    'button.upload_a': '上載 Tech Pack A',
    'button.upload_b': '上載 Tech Pack B',

    // ───── 提示 ─────
    'hint.copied': '已複製到剪貼板',
    'hint.export_done': '匯出完成',
    'hint.no_data': '尚無資料'
  }
};

let currentLocale = 'zh-HK';

/**
 * 設定當前語言（目前只有 zh-HK，但保留 API 給未來 i18n）
 * @param {string} locale
 */
export function setLocale(locale) {
  if (DICT[locale]) currentLocale = locale;
}

/**
 * 翻譯 + 模板替換
 *   t('error.file_too_large', { mb: 25, max: 20 })
 *   → 「檔案過大（25MB），上限為 20MB。」
 * @param {string} key
 * @param {object} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
  const dict = DICT[currentLocale] || DICT['zh-HK'];
  let str = dict[key];
  if (str == null) {
    // 找不到 key 不丟錯，回 key 名，方便 debug
    return `[i18n missing: ${key}]`;
  }
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

/**
 * 取得整個 dictionary（給前端 inject）
 * @returns {object}
 */
export function getAllStrings() {
  return { ...(DICT[currentLocale] || DICT['zh-HK']) };
}

export default { t, setLocale, getAllStrings };
