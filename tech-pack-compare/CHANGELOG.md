# Changelog — AI Tech Pack Comparator v2

依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 1.1.0 格式 + [SemVer](https://semver.org/lang/zh-TW/) 2.0.0。日期格式 ISO 8601 (Asia/Hong_Kong)。

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
