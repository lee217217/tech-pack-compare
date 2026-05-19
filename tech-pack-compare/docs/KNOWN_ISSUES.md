# Known Issues — AI Tech Pack Comparator v2

> 集中追蹤已知但延後處理的技術債、設計權衡、與環境風險。
> 每個 issue 修復後請改成 ✅ Resolved 並補上修復 commit / Phase。

---

## [KI-001] `models.js` 在 module top-level 讀 `process.env`

- **發現於**：Group A
- **嚴重程度**：LOW
- **影響範圍**：
  - `src/config/models.js`（PROVIDERS.ollama.endpoint 在檔案 load 時就讀 `OLLAMA_BASE_URL`）
  - 任何想在執行期動態切換 provider 的單元測試
- **暫時處理**：
  - Netlify Functions cold start 時 env 已注入，production / staging 場景無實際 bug
  - 本地 `npm test` 用 `LLM_PROVIDER=mock`，不會走到 Ollama 那一路
- **正式修復計劃**：Phase 5（寫 test 階段一併調整）
  - 把 `PROVIDERS` 改成 lazy getter（函式形式），每次 `resolveModel()` 才讀 env
  - 或在 test runner 啟動前 `import('../src/config/models.js')` 之前先設好 env
- **需要的條件**：無額外條件，純重構

---

## [KI-002] Claude provider 不支援原生 `response_format: json_schema`

- **發現於**：Group A
- **嚴重程度**：MEDIUM（只有當 `LLM_PROVIDER=anthropic` 才會 hit）
- **影響範圍**：
  - `src/config/models.js`（已標 `supportsJsonSchema: false`）
  - `src/services/llmClient.js`（Group C 必須處理）
- **暫時處理**：
  - 預設 provider 是 perplexity，sonar-pro 原生支援 json_schema，目前無痛
- **正式修復計劃**：Group C `llmClient.js` 落地時
  - Claude 路徑改用 `tool_use` 機制：把 schema 包成 `tools[].input_schema`，強制 `tool_choice: { type: 'tool', name: '...' }`
  - 從 `tool_use.input` 取結構化結果，等同於 json_schema 輸出
  - llmClient 對外的 `chat()` 介面不變，agent 完全感知不到差異
- **需要的條件**：
  - 用戶實際切到 Claude provider 時需提供 `ANTHROPIC_API_KEY`
  - 真實 Claude 路徑要等 Phase 5 sample test 時，由用戶提供 key 才能 end-to-end 驗
  - 在那之前用 mock provider + 單元測試覆蓋 tool_use payload shape

---

## [KI-003] Perplexity / OpenAI 不接受跨檔 `$ref` 作為 `response_format.json_schema`

- **發現於**：Group B
- **嚴重程度**：MEDIUM（會直接影響 LLM 是否接受 schema）
- **影響範圍**：
  - `src/schemas/workflowResult.schema.json`（內部用 `$ref` 連到 5 份子 schema）
  - 任何想把 envelope 直接交給 LLM 產出的構想
- **暫時處理**：
  - **架構分離**：
    - LLM 的 `response_format` 只用單一 artifact schema（measurementChange / commentArtifact / imageArtifact / summaryArtifact / qaReview）
    - `workflowResult` 由 coordinatorAgent 在 code 層組裝，只在「出口」用 AJV 驗證
  - `src/schemas/index.js` 的 `asResponseFormat(name)` 會自動 inline 並移除 `$id`/`$schema`，避免 provider 拒收
- **正式修復計劃**：不修。這是刻意的架構分層，不是 bug。
  - 但 Group C `llmClient.js` 必須在註解明寫「不要把 workflowResult 餵給 LLM」
  - AGENTS.md 已記載此規則，新 contributor 需要看到
- **需要的條件**：無

---

## [KI-004] Node 18 對 `import ... with { type: 'json' }` 仍是 experimental

- **發現於**：Group B
- **嚴重程度**：MEDIUM（直接影響 Netlify Function 是否能啟動）
- **影響範圍**：
  - `src/schemas/index.js`（用 import attribute 直接 import .json）
  - 任何沿用同寫法的未來檔案
- **暫時處理**：
  - 本地 Node（≥ Node 22）跑 OK，npm test 已通
  - Netlify Functions runtime 預設 Node 18：實際行為視 esbuild bundler 是否能正確處理該 syntax，目前未驗證
- **正式修復計劃**：Phase 3 第一個 Netlify Function 部署測試時驗證
  - **若 esbuild + Node 18 失敗**：改成 `readFileSync(new URL('./xxx.schema.json', import.meta.url))` 同步讀檔
  - **若 OK**：保持現狀 + 在 `netlify.toml` 加 `[functions] node_version = "20"` 鎖定 Node 20（已普遍支援）
- **需要的條件**：
  - 需要實際 `netlify dev` 或 deploy 一次 health endpoint 驗證
  - Phase 3 落地 Functions 時順手做

---

## [KI-005] `extractorArtifact.schema.json` 延後到 Phase 6

- **發現於**：Group D1（BOM 升級後）
- **嚴重程度**：LOW
- **影響範圍**：
  - `src/agents/extractorAgent.js`（目前無 strict schema，回傳 free-form package）
  - 下游 measurement / comment / image / bom agent 全部都讀 extractor 的 output
- **暫時處理**：
  - extractorAgent 回傳形狀在程式內固定（pages[].text, pages[].imageBase64?, metadata.brand/style/season, bom_table_raw?, size_table_raw?）
  - 在 extractorAgent.js 頂端 JSDoc 註明 contract，下游 agent 用 JSDoc typedef 對齊
  - mock provider 在 mockProvider.js 已用同樣形狀
- **正式修復計劃**：Phase 6（v2.1）
  - 補 `src/schemas/extractorArtifact.schema.json`
  - extractorAgent 改用 `schema: 'extractorArtifact'` 走 llmClient.chat
  - 此 schema 不會餵 LLM（extractor 是純解析、非 LLM 推理），只在 code 出口做 AJV 驗
- **需要的條件**：先實作 PDF.js 真實解析 + Vision OCR 結果結構穩定後再凍結 schema

---

## [KI-006] ✅ RESOLVED — `workflow_log.tokens_used` 真實 API 已可回填

- **發現於**：Group D2
- **嚴重程度**：LOW
- **影響範圍**：`src/agents/coordinatorAgent.js` / `workflow_log[].tokens_used` / `meta.total_tokens`
- **修復內容**（Phase 3 收尾）：
  1. `src/services/llmClient.js` `callPerplexity()`：兜底 `usage.total_tokens` 缺值時改用 `prompt_tokens + completion_tokens`，確保 Sonar Pro 不同版本回傳格式都能拿到 token 計數。
  2. `src/agents/coordinatorAgent.js` 新增 `pickAgentTokens(result)` helper（接受 `result.tokensUsed` / `result.tokens_used` / `result.meta.tokensUsed` / `result.meta.total_tokens`），於 `runOne()` 將每個 agent 的 token 數回填到 `workflow_log[i].tokens_used` 並累加到 `totalTokens` → `meta.total_tokens`。
- **驗證**：`tests/phase3-round1.test.mjs` mock 全綠（mock provider 仍回 0，符合預期）；Sonar Pro 真實 API Round 2 由用戶執行驗證。
- **狀態**：✅ RESOLVED at Phase 3 wrap-up（v2.0.0）。

---

## [KI-007] `imageAgent` 用 prompt 描述版而非真 vision

- **發現於**：Group D2
- **嚴重程度**：LOW（Sonar Pro 本來就不支援 vision，這是預期行為）
- **影響範圍**：`src/agents/imageAgent.js` / Phase 4 前端 Comments & Images Tab
- **暫時處理**：imageAgent 收 metadata + region 描述，靠文字推論差異。
- **正式修復計劃**：v3 評估接 OpenAI GPT-5.5 vision 或 Claude vision，需擴充 `llmClient.buildMessages()` 支援 image content blocks。
- **需要的條件**：vision-capable provider 啟用 + Netlify function payload < 6MB。

---

## [KI-008] Production provider 鎖定 Perplexity Sonar Pro

- **發現於**：Phase 3
- **嚴重程度**：LOW（設計決定）
- **影響範圍**：所有 agent / `health` endpoint / `.env.example` / 文件
- **暫時處理**：`LLM_PROVIDER` 預設 `perplexity`；其他 provider code path 保留但未驗證。在 `health` endpoint 將 OpenAI / Anthropic / Ollama 標為 `providers_inactive`。
- **正式修復計劃**：v3 視業務需要再啟用 OpenAI / Anthropic / Ollama。
- **需要的條件**：商業需求 + 對應 API key + 額外 prompt tuning per provider。

---

## [KI-009] PDF.js 無法讀取掃描版 PDF 的文字

- **發現於**：v2.1（PDF.js 導入後）
- **嚴重程度**：LOW
- **影響範圍**：`public/modules/upload.js`、所有掃描版 PDF 輸入
- **暫時處理**：上傳後 `page.text` 則為空字串；LLM 只能靠 fileName 推測，結果不穩。UI 顯示 `偵測不到文字內容` warning。
- **正式修復計劃**：v3 評估接 Tesseract.js 或 vision provider 做 OCR 退路。
- **需要的條件**：OCR worker 設定或 vision API key + 6MB payload limit 規劃。

---

## [KI-010] relevantImages 上限 6 頁

- **發現於**：v2.1
- **嚴重程度**：LOW
- **影響範圍**：`FILE_LIMITS.maxImagePages = 8`、`upload.js` 裁斷 sizeTable / BOM hint 超出頁
- **暫時處理**：只取前 `maxImagePages` 頁 480px JPEG，超上限裁斷並記入 warnings。
- **正式修復計劃**：v3 接 vision provider 後以 streaming / chunked upload 拿高。
- **需要的條件**：Netlify Functions 支援超過 6MB 或改接 Background Functions / S3 直傳。

---

## [KI-011] Netlify cold-start 時 in-memory rate state 會清空

- **發現於**：v2.1（Open Mode 後 IP rate limit 變唯一防線）
- **嚴重程度**：LOW
- **影響範圍**：`src/services/rateLimiter.js`、`netlify/functions/*` 所有 endpoint
- **暫時處理**：接受 cost-controlling 只是「足夠好」。Netlify Function multi-instance / cold-start 會讓實際允許數 > per-min 30。
- **正式修復計劃**：Phase 6 接 Upstash Redis 或 Netlify Edge KV 重寫 `rateLimiter` adapter。介面 (`checkRate / checkLicense`) 保持不變。
- **需要的條件**：Redis / KV provider 以及 env var。

---

## [KI-012] 從 Open Mode 切回付費需重設環境變數

- **發現於**：v2.1
- **嚴重程度**：LOW
- **影響範圍**：`src/config/limits.js`、`docs/api-contracts.md`、`README.md`
- **暫時處理**：`FEATURES.requireLicense = boolFromEnv('REQUIRE_LICENSE', false)`；將來要接付費需設 `REQUIRE_LICENSE=true` + 準備好 `LICENSE_KEYS` / `ADMIN_LICENSE_KEY`。
- **正式修復計劃**：v3 接 LemonSqueezy / Stripe webhooks 後動態同步 `LICENSE_KEYS`；不再依賴 env hard list。
- **需要的條件**：付費 provider 在線 webhook + DB（e.g. Neon / Supabase）。

---

## 追蹤狀態

| ID | 狀態 | 嚴重 | 預計修復 |
|---|---|---|---|
| KI-001 | ✅ RESOLVED | LOW    | v2.1（PDF.js 已上） |
| KI-002 | ✅ RESOLVED | MEDIUM | Group C（已用 tool_use 實作） |
| KI-003 | OPEN | MEDIUM | 架構決定，不修 |
| KI-004 | OPEN | MEDIUM | Phase 3 |
| KI-005 | ✅ RESOLVED | LOW    | v2.1（extractor 接 structured pages） |
| KI-006 | ✅ RESOLVED | LOW    | Phase 3 wrap-up（v2.0.0） |
| KI-007 | OPEN | LOW    | v3（需 vision provider） |
| KI-008 | OPEN | LOW    | v3（設計決定） |
| KI-009 | OPEN | LOW    | v3（OCR / vision） |
| KI-010 | OPEN | LOW    | v3（vision + streaming upload） |
| KI-011 | OPEN | LOW    | Phase 6（Redis / Edge KV） |
| KI-012 | OPEN | LOW    | v3（付費 webhook + DB） |

> 新增 issue 時請按 `KI-NNN` 編號遞增。修復後改為 ✅ RESOLVED 並補 commit hash。
