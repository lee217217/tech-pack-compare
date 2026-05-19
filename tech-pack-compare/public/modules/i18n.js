/*
  Path:     public/modules/i18n.js
  Purpose:  繁體中文(HK) 字典 — 所有 UI 文案集中於此
  Depends:  無 (ES module)
*/

export const I18N = {
  app: {
    title: 'AI Tech Pack Comparator',
    subtitle: 'PDF Tech Pack 智能比對 · Multi-Agent Pipeline',
    version: 'v2.1.0',
    framework: 'Multi-Agent Pipeline · Perplexity Sonar Pro'
  },
  nav: {
    upload: '上傳',
    configure: '設定',
    review: '檢視與執行',
    results: '結果',
    dashboard: '工作區',
    history: '紀錄',
    settings: '設定',
    docs: '說明'
  },
  steps: {
    1: '1. 上傳 Tech Pack',
    2: '2. 比對設定',
    3: '3. 檢視與執行',
    4: '4. 結果與匯出'
  },
  outputModes: {
    FULL: '完整 (FULL)',
    SUMMARY: '只看總結 (SUMMARY)',
    MEASUREMENT_ONLY: '只看尺寸 (MEASUREMENT_ONLY)',
    BOM_ONLY: '只看 BOM (BOM_ONLY)',
    DEBUG_ALL: 'Debug 模式 (DEBUG_ALL · admin)'
  },
  outputModeDesc: {
    FULL: '跑齊 7 個 agent,輸出全部 artifact',
    SUMMARY: '只輸出總結 artifact,跳過尺寸/註解/圖像/BOM 表',
    MEASUREMENT_ONLY: '只輸出尺寸比對表',
    BOM_ONLY: '只輸出 BOM 比對表',
    DEBUG_ALL: 'admin 專用 · 附 raw agent log + envelope JSON'
  },
  agentLabels: {
    extractor: '解析',
    measurement: '尺寸',
    comment: '註解',
    image: '圖像',
    bom: 'BOM',
    summarizer: '總結',
    qaReview: 'QA'
  },
  agentNumLabels: {
    extractor: '1. 解析',
    measurement: '2. 尺寸',
    comment: '3. 註解',
    image: '4. 圖像',
    bom: '5. BOM',
    summarizer: '6. 總結',
    qaReview: '7. QA'
  },
  agentStatus: {
    PENDING: '等待中',
    RUNNING: '處理中',
    DONE: '完成',
    SKIPPED: '略過',
    FAILED: '失敗'
  },
  severity: {
    CRITICAL: '嚴重', MAJOR: '重要', MINOR: '輕微', INFO: '資訊',
    HIGH: '高', MEDIUM: '中', LOW: '低',
    ADDED: '新增', REMOVED: '移除', CHANGED: '變更', UNCHANGED: '不變',
    PASS: '通過', WARN: '警告', FAIL: '不通過',
    ERROR: '錯誤'
  },
  fields: {
    styleNumber: '款式編號 (Style Number)',
    brand: '品牌 (Brand)',
    season: '季度 (Season)',
    buyerComments: '買手註解 (Buyer Comments)',
    licenseKey: 'License Key (進階)',
    outputMode: '輸出模式',
    techPackA: '舊版 Tech Pack',
    techPackB: '新版 Tech Pack',
    pageCount: '頁數',
    fileSize: '大小',
    sizeTablePages: '尺寸表頁',
    bomPages: 'BOM 頁'
  },
  buttons: {
    run: '▶ 開始比對',
    running: '處理中…',
    export: '⬇ 匯出 Excel',
    next: '下一步 →',
    back: '← 上一步',
    advanced: '進階設定',
    reset: '重置',
    upload: '選擇 PDF…',
    dropHere: '拖放 PDF 到此 · 或按下選擇',
    removeFile: '移除'
  },
  msg: {
    licenseRequired: '請先輸入 License Key。',
    missingPdf: '請先上傳新舊兩份 Tech Pack PDF (或貼文字)',
    missingText: '請貼上舊版與新版 Tech Pack 文字內容。',
    running: '正在處理…',
    done: '完成',
    failed: '執行失敗',
    noData: '此模式下無資料。',
    cached: '(由快取回應)',
    parsingPdf: '正在解析 PDF…',
    parseOk: 'PDF 解析完成',
    parseFail: 'PDF 解析失敗',
    debugLockedHint: 'Debug 模式只有 admin license 可開啟。在「進階設定」貼上 admin key 即可解鎖。',
    openModeHint: 'Open Mode 啟用 — 無需 License Key 即可使用',
    saasSubtitle: '比對舊新版 Tech Pack 差異 — 自動產出尺寸 / 註解 / 圖像 / BOM 變更表'
  },
  tabs: {
    summary: '總結',
    measurement: '尺寸變更',
    comments: '註解與圖像',
    bom: '物料清單',
    qa: 'QA Review',
    debug: 'Debug'
  },
  stats: {
    totalChanges: '總變更',
    measurement: '尺寸變更',
    comments: '註解項',
    image: '圖像變更',
    bom: 'BOM 變更'
  },
  inspector: {
    title: '工作摘要',
    metaTitle: 'Meta',
    fileTitle: '檔案資訊',
    statTitle: '統計',
    none: '尚未執行'
  }
};

export function t(path, fallback = '') {
  const segs = String(path).split('.');
  let v = I18N;
  for (const s of segs) {
    if (v == null) return fallback;
    v = v[s];
  }
  return v ?? fallback;
}

export default I18N;
