# Changelog — AI Tech Pack Comparator v2

依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 1.1.0 格式 + [SemVer](https://semver.org/lang/zh-TW/) 2.0.0。日期格式 ISO 8601 (Asia/Hong_Kong)。

---

## [2.1.1] — 2026-05-19

主題：**PDF.js 載入修復 (KI-009) + UI 升級至 Linear/Vercel/Notion 級 (UI-1〜12)**。

### Fixed — 修復

#### KI-009 「PDF.js 尚未載入」
- `netlify.toml` CSP 完整覆蓋：`script-src` + `worker-src` + `style-src` + `font-src` 同時允許 `cdnjs.cloudflare.com` + `cdn.jsdelivr.net` + Google Fonts 系列。
- `public/index.html` 移除原 inline `<script src>` PDF.js boot，改由 `upload.js` ES module dynamic `import()` `.mjs` 載入。Tailwind / SheetJS / Google Fonts 仍以 CDN script 點型型載入。
- `public/modules/upload.js`：
  - `PDFJS_VERSION = '4.0.379'` 預 pin。
  - `PDFJS_CDNS = [cdnjs, jsdelivr]` (順序 fallback)。
  - `loadPdfJs()` 每 CDN 試 2 次，全部失敗則 throw 友善訊息「無法載入 PDF.js · 請檢查網路」。
  - `prewarmPdfJs()` 用 `requestIdleCallback` 預讀，免首次上傳延遲。
  - `getPdfJsInfo()` 提供給 Inspector 關於「引擎資訊」卡使用。
  - `console.log('[Tech Pack Comparator] PDF.js x.y.z loaded from <cdn>')` boot 診斷（用戶明確要求，例外於 no-console-log 規則）。
  - 上傳前 `typeof pdfjsLib === 'undefined'` 檢查及頻便 trigger lazy load。

### Changed — UI 升級

#### UI-1 Design Tokens
- `style.css` 已有 tokens 架構，v2.1.1 記入 「.dark override」來送兩個 colour scheme。新增 `--brand-50/100/300/500/600/700/800`、`--success-bg`、`--sev-yellow-bg`、`--sev-red-bg` 變量作為 chip / pill 現有 token。

#### UI-2/7 Top Nav + Sidebar
- topbar 加入 breadcrumb (`Workspace › Compare Tech Pack › Step N · …`) 按 step 動態更新。
- 5 個 status pill: Provider / Mode / License / Duration / Tokens 使用 chip-style + pulse dot + hover lift。
- avatar (32px gradient circle)。sidebar 版本 badge v2.1.1。

#### UI-3 Stepper 升級
- `wizard-lg` ：48px 圓圈 + 2px border + SVG icon。active step `box-shadow 0 0 0 4px var(--brand-100)` + `pulse-circle` animation。done step 顯示 `✓`。connector 由 done step 個後轉為 `linear-gradient(brand-500→success)`。

#### UI-4 Dropzone 三態
- idle / hover (lift -1px + indigo border) / drag-over (`scale 1.01` + glow ring + indigo bg) 狀態。
- 上傳完成：`.dz-done` 卡 (thumb / filename / pages·size / 重新上傳 + 移除-X 這兩個 icon button)。進度時 `dz-progress-pct` 顯示百分比。

#### UI-5 Workspace Card + Helper text
- `.workspace-card` 加 `card-header-left` (圖示 + 標題 + sub-text)。`card-icon` 36px rounded-square with indigo bg。`.helper-text` 藍色 left border + brand-50 bg 提示條。
- 「下一步」按鈕 `.btn-arrow` + `.btn-glow` 加漸層 hover 動画。

#### UI-6 Inspector 升級 (5 collapse cards + empty SVG)
- 原本 flat sections 改為 5 個 `<details>` 原生 collapse 卡：
  1. 📄 上傳的檔案 （A/B file-card with file-pill / name / meta / size/BOM chips）
  2. ⚙️ 執行配置
  3. 📊 結果統計 (2×2 stat-grid, 20px num + uppercase label)
  4. 📜 最近動作 (in-memory 最後 5 個動作時間軸)
  5. 🔧 引擎資訊 (PDF.js 版本 / CDN / UI 版本 / outputMode)
- empty state SVG 提醒使用者上傳 PDF。

#### UI-9/10/11 Micro-interactions / Loading / Dark mode
- 所有 `.card`/`.btn`/`.ins-card` 加 hover lift -1px 動画。
- `.skeleton` shimmer keyframe class 備用。
- `.dark` override block ：workspace-card header gradient / helper-text / pill / stat 背景取暗色。`toast.js` (未動) 本來已含交互從使用 dark token。

#### UI-12 4 Tab 升級
- Summary tab: `.sum-hero` 四個 28px gradient hero stat 取代原簡單 stat-grid。
- Tab 底部 `.tab-indicator` 滑動 underline (cubic-bezier `.4,0,.2,1` 0.3s)，遷換 tab 時 `transform: translateX` + `width` 同步動態。resize 時重新計算。
- _measurement / comments / bom / debug 仍用 v2.1.0 結構 (在 UI-1/3/4/6 token 上接手即升級)。Phase-2 可再加 sticky header / split view。_

#### 其他
- **Confetti**: workflow 完成彈 36 個 CSS keyframe 彩條（無 canvas / 無外部 lib，2.2s 自清）。
- **Rotating tips**: Step 1 `.helper-text` 每 5s 輪換 5 句提示。
- **Activity timeline**: in-memory 保留最近 5 動作（上傳 A / 上傳 B / Workflow 完成 …）。

### Tests
- 新增 `tests/pdfjs.load.test.js` — 12 個結構性檢查（版本鎖定、CDN 清單、`.mjs` 後綴、retry/fallback、GlobalWorkerOptions、友善訊息、CSP coverage)。未真實 fetch CDN — 由 LOCAL_VERIFICATION_CHECKLIST 手動驗證。
- 全部 mock test：**62/62 通過** (原 50 + 12 新)。

### Design Decisions (auto-decided per 「不中途問問題」規則)
1. PDF.js 改 ES module dynamic import (.mjs)，不在 HTML 設 inline `<script src>`。Pros: CSP 更嚴、worker URL 完全動態、需要時才載入。Cons: 期望現代瀏覽器 (Chrome 89+/Safari 14+/Firefox 89+)。
2. boot 用 `console.log` 印 PDF.js CDN + 版本（用戶明確要求 — 例外於 no-console-log 規則，其他仍用 logger）。
3. dynamic import 用 `/* @vite-ignore */` 註解接受未來 bundler 化容错。
4. Inspector 用 `<details open>` HTML 原生 collapse 而非自訂 JS（0 deps + native a11y）。
5. Confetti 用 36 個 `<span>` + CSS @keyframes（無需 canvas / 外部 lib）。
6. Activity timeline 僅 in-memory（重新整理即清空，符「最近 5 個」規格）。
7. Tab indicator 單一 `.tab-indicator` span 用 `transform: translateX` + `width` 動作（變化 1 個元素 vs 多個 underline）。
8. 預設 `requestIdleCallback` 預載 PDF.js，免首次上傳延遲 ~500　1500ms。

### Known Limitations (carried to v2.1.2)
- `measurement` / `comments` / `bom` / `debug` 4 tab 進階 UI-12 (filter / sticky / split-view / impact stats) 未都全部落地，現階段繼承 v2.1.0 表格佈局 + UI-1 token 上色。全部 5 outputMode 均仍可用。
- Local screenshot 由 sandbox 無 puppeteer/playwright headless browser 跡 — 詳見 `docs/LOCAL_VERIFICATION_CHECKLIST_v2.1.1.md`。

---

## [2.1.0] — 2026-05-19

主題：**Open Mode (免注冊試用) + PDF.js 上傳 + SaaS 三區介面 + 7-sheet Excel**。

### Added — 新增

#### Open Mode（預設啟用）
- `FEATURES.requireLicense` 預設 `false` — 任何人無需 license 即可試用。`X-License-Key` 變 optional。
- `rateLimiter.OPEN_ACCESS_LICENSE = 'OPEN-ACCESS'`；無 header 時以此進行 per-license 計數。
- `ADMIN_LICENSE_KEY` 帶頭仍然能解 `DEBUG_ALL` outputMode。
- IP rate limit (per-min 30 / per-day 500) 現在是第一道防線。

#### PDF.js 上傳（取代 textarea）
- `public/modules/upload.js` ：dropzone + drag-drop + thumbnail（首頁縮圖）+ per-page text extraction（PDF.js worker, cdnjs 4.0.379）。
- 自動偵測 `SIZE TABLE` / `BOM` regex → `sizeTablePages[]` / `bomPages[]` hint 傳給 LLM。
- `relevantImages` 最多 6 頁（`FILE_LIMITS.maxImagePages`），480px JPEG q=0.7，避免 Netlify 6MB payload 上限。
- `extractorAgent.normalizeDoc()` 同時接受 **legacy `rawText`** 與 **v2.1 structured `pages[]`** payload，向後兼容。
- `validatePdfPayload(side, obj)` 審查不同 shape：rawText 或 pages[] 任一即可。>5MB 警告、relevantImages 超上限裁斷 + warning。

#### SaaS 三區介面 + 4-步 wizard
- `public/index.html`：sidebar (240px) / workspace / inspector (320px) 三區布局 + 4-step wizard（上傳 → 選項 → 執行 → 檢視）。
- `public/style.css`：重寫為 CSS design tokens (indigo/slate B2B 調色盤) + dark / light theme。
- Google Fonts：Inter / JetBrains Mono / Noto Sans TC。
- `netlify.toml` CSP 增 `worker-src 'self' blob: cdnjs`、`font-src` 加 Google Fonts CDN。

#### 前端模組化 `public/modules/`
- `i18n.js` / `logger.js` / `state.js` / `theme.js` / `toast.js` / `api.js` / `ui.js` / `progress.js` / `upload.js` / `excel.js`
- 4 tab 及 Debug tab 拆到 `public/modules/tabs/`：`summary.js` / `measurement.js` / `comments.js` / `bom.js` / `qa.js` / `debug.js`
- `app.js` 重寫為純 orchestrator，不再含業務邏輯。

#### Excel 7-sheet 匯出
- 原 5 sheet + **封面 Cover**（meta + KI 帶出）+ **Workflow Log**（每個 agent 狀態/tokens/duration）。
- 檔名：`TechPack_{styleSlug}_{ISO日期}.xlsx`。

### Changed — 變更

- **License 從 required 變 optional**。`X-License-Key` header 在 Open Mode 不再必需。仍可透過 `REQUIRE_LICENSE=true` 重新啟用嚴格模式。
- `meta.version` 為 `v2.1.0`、`FRAMEWORK_VERSION` export 提供給前端讀取。

### Tests — 測試

- `tests/functions.mock.test.js` 重寫：**Open Mode 200**、v2.1 structured pages、IP rate limit 連敲 31 次 → 429、admin DEBUG_ALL 保留 + non-admin 降級 FULL。
- `tests/payload.test.js` 新增：`validatePdfPayload` 9 case（legacy / pages / null / >5MB / relevantImages 裁斷等）。
- 總 **50 / 50 mock pass**（包含原 41 case + 9 新增）。

### 設計 trade-off（自決，記錄於此）

1. **Open Mode 預設開** — 用戶明確要求試用門檻零。將來產品化 SaaS 要接付費時，設 `REQUIRE_LICENSE=true` 即可重新嚴格。
2. **PDF.js 只送 text + 前 6 頁圖片** — 防 6MB；掃描版 PDF (無 text layer) 有限，KI-009 標記。
3. **兩種 payload shape 並存** — 保留 legacy `rawText` 承接 v1 / v2.0 老客戶；新 `pages[]` 能帶 sizeTable / BOM hint 提高 LLM 準確度。
4. **SaaS layout 選 indigo + slate** — 定調 B2B、適合公司內部使用的色盤；避免太 saturated（如 brand red / blue）。
5. **IP rate limit 依然 in-memory** — Netlify multi-instance 下不是絕對準，但 cost-controlling 效果仍在；Phase 6 可接 Redis。
6. **`screenshot_page` 跳過** — 本次交付環境不適合跑 `netlify dev` server；交付以 README 的使用說明代替，本地跑 `npm start` 可看到新 UI。

### KI 狀態更新

| ID | 狀態 | 註 |
|---|---|---|
| KI-001 | ✅ RESOLVED in v2.1 | PDF.js 已接（掃描版另計 KI-009）|
| KI-005 | ✅ RESOLVED in v2.1 | extractor 接 v2.1 structured pages |
| KI-009 | 新 OPEN · LOW | 掃描版 PDF 無 text layer — 需 OCR (v3) |
| KI-010 | 新 OPEN · LOW | relevantImages 6 頁上限 — v3 vision 接入後能拿高 |
| KI-011 | 新 OPEN · LOW | Netlify cold-start in-memory rate state 會清空 |
| KI-012 | 新 OPEN · LOW | 從 Open Mode 切回付費需重設 `REQUIRE_LICENSE` |

---

## [2.0.0] — 2026-05-19

第一個正式版,由 v1 完整重寫。Multi-agent + Schema-validated + Provider-locked + 繁中(HK) UI。

### Added — 新增

#### Phase 1 — 結構與文件
- 樹狀檔案結構 (`AGENTS.md` / `README.md` / `.env.example` / `netlify.toml`)
- `docs/api-contracts.md` — 8 endpoint API 合約
- `docs/deployment-checklist.md` — Netlify 上線檢查清單
- `docs/KNOWN_ISSUES.md` — KI-001 ~ KI-008 issue tracker

#### Phase 2 — 核心 src/
- **Group A · utils + config** (6 檔, 819 行):`logger.js` / `i18n.js` (zh-HK 字典) / `hash.js` / `json.js` / `models.js` / `limits.js`
- **Group B · 7 JSON Schema** (776 行):measurementChange / commentArtifact / imageArtifact / bomArtifact / summaryArtifact / qaReview / workflowResult — 全部 `additionalProperties:false`、enum 大寫常數、`type:["number","null"]` 為 nullable
- **Group C · 5 services** (1116 行):`schemaValidator.js` (AJV) / `cacheService.js` / `rateLimiter.js` / `llmClient.js` / `mockProvider.js`
- **Group D1 · 6 specialist agents** (1174 行):extractor / measurement / comment / image / bom / summarizer — 全部 `{ ok, data, warnings, error }` 永不 throw 合約
- **Group D2 · qaReview + coordinator** (992 行):新增 `BOM_ONLY` / `DEBUG_ALL` outputMode、`agentStatus`、`warnings`、`meta.debug`

#### Phase 3 — Netlify Functions
- **8 個 endpoint**(共 819 行):`/api/health` (公開) / `/api/run-workflow` / `/api/{extract,measurement,comments,images,bom,summarize}`
- `netlify/functions/_lib/workflowService.js` (381 行):共用 `handleRequest()` 處理 method/auth/rate/body-parse/error-envelope
- CSP 鎖定 `connect-src` 只允 `api.perplexity.ai` + `self` (KI-008)

#### Phase 4 — 前端 (Vanilla HTML + Tailwind CDN)
- `public/index.html` (160 行):4 tab + 5 outputMode radio + 7-step 進度條 + License Key 持久化 + Style Number 輸入 + 主題切換
- `public/app.js` (641 行):envelope render + SheetJS Excel export (5 sheet,繁中標題,severity 條件著色)
- `public/theme.js` (33 行):`prefers-color-scheme` + `localStorage`
- `public/style.css` (59 行):severity 標籤色、step chip 動效、data table sticky

#### Phase 5 — 測試 + 部署
- `tests/schema.test.js` (12 case) — schema valid / invalid / additionalProperties / enum
- `tests/agents.mock.test.js` (8 case) — 7 agent 各自 mock 模式跑通
- `tests/coordinator.mock.test.js` (9 case) — 5 outputMode + DEBUG_ALL 降級 + KI-006 tokens_used 欄位
- `tests/functions.mock.test.js` (9 case) — 8 endpoint + auth + malformed JSON guard
- `tests/phase3-round1.test.mjs` — 既有 Round 1 mock 整合驗證 (10 case)
- 全部 `node --test` 零依賴, **39/39 mock pass**

### Fixed — 修正

- **KI-002 ✅ RESOLVED** (Group C):tool_use 取代 response_format 給 Sonar Pro,JSON 抽取一致化
- **KI-006 ✅ RESOLVED** (Phase 3 wrap-up):
  - `src/services/llmClient.js` `callPerplexity()`:`usage.total_tokens` 缺值時改用 `prompt_tokens + completion_tokens` 兜底
  - `src/agents/coordinatorAgent.js`:新增 `pickAgentTokens()` helper 從 `result.tokensUsed` / `result.tokens_used` / `result.meta.tokensUsed` / `result.meta.total_tokens` 取值,於 `runOne()` 回填到 `workflow_log[i].tokens_used` 並累加到 `meta.total_tokens`

### Changed — 變更

- **Provider 鎖定 Perplexity Sonar Pro** (KI-008 設計決定);OpenAI / Anthropic / Ollama provider 程式碼保留但預設 disabled
- `outputMode` 統一 5 種 UPPERCASE:`FULL` / `SUMMARY` / `MEASUREMENT_ONLY` / `BOM_ONLY` / `DEBUG_ALL`
- `DEBUG_ALL` 需 `context.debugAllowed===true`(對應 `ADMIN_LICENSE_KEY`),否則自動降級 `FULL`

### 設計 trade-off (自決,記錄於此)

1. **沒有用 SSE/WebSocket 推進度條** — 前端統一在 fetch 開始時把 7 step 全標 `RUNNING`,fetch 完成後一次 render 真實 `agentStatus`。理由:簡化、減少 Netlify function complication;trade-off 是用戶看到 1~5 秒「全部 RUNNING」狀態。
2. **SheetJS Community 不支援豐富 cell style** — Excel 匯出條件著色用 `cell.s.fill`,在純 community 版會被忽略。要完整著色須升 `xlsx-js-style` 套件;目前先寫 metadata,Phase 6 再決定是否升級。資料完整性不受影響。
3. **PDF.js 留 Phase 6** — 前端先用 textarea 貼 rawText,不解析 PDF。理由:PDF.js + image base64 base64 傳輸太佔 6MB Netlify payload 限額;Phase 6 評估配合 vision provider 一同上。
4. **沒有用 npm run test 集中 script** — 直接用 `node --test tests/` glob,因為已經零依賴。`package.json` 已存在 `test` script 指向 round1 file,Phase 6 再合併。

### KI 狀態總覽 (v2.0.0 結束時)

| ID | 狀態 | 嚴重 | 預計修復 |
|---|---|---|---|
| KI-001 | OPEN | LOW    | Phase 5 (已有 mock,真 PDF 待 Phase 6) |
| KI-002 | ✅ RESOLVED | MEDIUM | Group C |
| KI-003 | OPEN | MEDIUM | 架構決定,不修 |
| KI-004 | OPEN | MEDIUM | Phase 3 (隱式修) |
| KI-005 | OPEN | LOW    | Phase 6 (v2.1 extractor schema) |
| KI-006 | ✅ RESOLVED | LOW    | Phase 3 wrap-up |
| KI-007 | OPEN | LOW    | v3 (vision provider) |
| KI-008 | OPEN | LOW    | v3 (設計決定 — Sonar Pro lock) |

---

## [Unreleased]

### 規劃中 (v2.1 / v3)

- KI-005 / KI-007 / KI-008 對應的延後項目
- PDF.js 真實解析 + 圖片裁切上傳 (Phase 6)
- vision provider 接入 (v3)
- 多 license 級別 / quota / per-user analytics
