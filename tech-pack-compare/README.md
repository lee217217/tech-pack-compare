# AI Tech Pack Comparator v2

> 製衣業 Tech Pack 智能比對系統 — Multi-Agent + Schema-Validated + Provider-Locked (Perplexity Sonar Pro)
> Target users: Apparel Sales / Merchandiser / PD team
> UI language: 繁體中文（香港）
> 版本: **v2.1.0** (2026-05-19) · **Open Mode 預設啟用**

---

## 🚀 Quick Start (無需 license)

```bash
cd v2
npm install

# (a) Mock 離線測 — 50/50 全綠
LLM_PROVIDER=mock node --test tests/

# (b) 本機跑 UI （v2.1 Open Mode：不需 LICENSE_KEYS）
LLM_PROVIDER=mock netlify dev
# 開 http://localhost:8888
# 拖 PDF 到 dropzone、選 outputMode、按「執行」即可

# (選) 要解 DEBUG_ALL outputMode 才需 admin license。在 inspector 輸 ADMIN_LICENSE_KEY 到 X-License-Key 欄位即可。
```

可選 env：
- `REQUIRE_LICENSE=true` — 重新啟用嚴格模式（未來付費版用）
- `ADMIN_LICENSE_KEY` — 設了之後帶在 `X-License-Key` header 可解 `DEBUG_ALL`
- `LICENSE_KEYS` — 只在 `REQUIRE_LICENSE=true` 時必需

上線 Netlify: 看 [DEPLOY.md](./DEPLOY.md) (15 分鐘 step-by-step)。

---

## ✨ v2 升級重點（vs v1）

| 範疇 | v1 (現況) | v2 (本次升級) |
|---|---|---|
| 架構 | 4 個 monolithic Netlify functions，邏輯散落 | **Multi-Agent + Coordinator**，每個 agent 獨立 prompt + JSON schema |
| LLM | 只 hardcode Perplexity `sonar` / `sonar-pro` | **Model Router**：Perplexity / OpenAI GPT-5.5 / Claude / Ollama（.env 切換） |
| 輸出 | Free-text → fragile regex 解析 | **強制 `response_format: json_schema`** + AJV 驗證 |
| Token | 每次重送整份 PDF 文字 | **Hash 去重 + prompt caching hint**（省約 16.6%） |
| 報告 | 單張長頁面 | **3 個 Tab**：Summary / Measurement Changes / Comments & Images |
| UX | 無進度顯示 | **Run Workflow 進度條** + 每個 agent 狀態 |
| 安全 | API key 暴露風險、無 rate limit、無檔案限制 | Rate limit / License key / 20MB 限制 / MIME 檢查 / CSP / CORS |
| 主題 | 只有淺色 | **深色 / 淺色切換** |
| 輸出選項 | 只有單一 mode | `outputMode: FULL / SUMMARY / MEASUREMENT_ONLY / BOM_ONLY / DEBUG_ALL` |

---

## 📁 檔案結構（v2）

```
ai-techpack-comparator-v2/
├── README.md                       ← 本檔
├── AGENTS.md                       ← 給未來 AI 工具讀的架構說明（省 token）
├── CHANGELOG.md                    ← v1 → v2 變更紀錄
├── .env.example                    ← 環境變數樣本
├── .gitignore
├── package.json                    ← Node 18+, type: module, 不裝 axios
├── netlify.toml                    ← Netlify 部署設定 + headers
│
├── public/                         ← 純靜態前端（Netlify publish 目錄）
│   ├── index.html                  ← 主頁面（Tailwind CDN，3 Tab）
│   ├── app.js                      ← 前端主邏輯（vanilla JS）
│   ├── theme.js                    ← 深色 / 淺色切換
│   └── pdfjs-loader.js             ← PDF.js 載入封裝
│
├── netlify/functions/              ← Serverless endpoints (Node 18+, fetch only)
│   ├── health.js                   ← 健康檢查
│   ├── run-workflow.js             ← 主入口：coordinatorAgent
│   ├── extract.js                  ← PDF 文字 + 圖像 OCR
│   ├── measurement.js              ← 尺寸表結構化比對
│   ├── comments.js                 ← 客人 COMMENT + 圖像註釋
│   ├── images.js                   ← 尺寸表後相關圖像 vision diff
│   └── summarize.js                ← 報告 merge
│
├── src/
│   ├── agents/                     ← 7 個專業 agent（每個獨立 prompt + schema）
│   │   ├── extractorAgent.js
│   │   ├── measurementAgent.js
│   │   ├── commentAgent.js
│   │   ├── imageAgent.js
│   │   ├── bomAgent.js             ← 物料/BOM 比對（FABRIC/TRIM/LABEL...）
│   │   ├── summarizerAgent.js
│   │   ├── qaReviewAgent.js
│   │   └── coordinatorAgent.js     ← 編排上述所有 agent
│   │
│   ├── services/
│   │   ├── llmClient.js            ← Model Router (Perplexity/OpenAI/Claude/Ollama)
│   │   ├── schemaValidator.js      ← AJV JSON Schema 驗證
│   │   ├── workflowService.js      ← Workflow 編排 + 進度回傳
│   │   ├── cacheService.js         ← Hash 去重 + in-memory prompt cache
│   │   └── rateLimiter.js          ← 簡易 in-memory rate limit + license check
│   │
│   ├── schemas/                    ← 所有 agent 的 JSON Schema
│   │   ├── measurementChange.schema.json
│   │   ├── commentArtifact.schema.json
│   │   ├── imageArtifact.schema.json
│   │   ├── bomArtifact.schema.json
│   │   ├── summaryArtifact.schema.json
│   │   ├── qaReview.schema.json
│   │   └── workflowResult.schema.json
│   │
│   ├── utils/
│   │   ├── hash.js                 ← SHA-1 short hash (for dedupe)
│   │   ├── json.js                 ← safeJsonParse / extractFirstJson
│   │   ├── logger.js               ← 結構化 log（給 Netlify Functions log）
│   │   └── i18n.js                 ← 繁中（香港）UI 文字常數
│   │
│   └── config/
│       ├── models.js               ← 各 provider 的 model name + endpoint
│       └── limits.js               ← MAX_FILE_MB, RATE_LIMIT_PER_MIN 等
│
├── tests/
│   ├── sample-run.test.js          ← 用 dummy JSON 跑通整個 workflow（無需真 PDF）
│   └── fixtures/
│       ├── techpack-A.json         ← Dummy Tech Pack A（含 measurement + comments）
│       └── techpack-B.json         ← Dummy Tech Pack B
│
└── docs/
    ├── deployment-checklist.md     ← 部署到 Netlify 的逐步檢查清單
    └── api-contracts.md            ← 所有 endpoint 的 request/response 規格
```

---

## 🚀 快速開始（本地開發）

### 1. 安裝依賴

```bash
git clone <your-repo>
cd ai-techpack-comparator-v2
npm install
```

> 我們只裝 `ajv`（schema 驗證）和 `netlify-cli`（local dev）。
> **不**裝 axios — 全部用原生 `fetch`。
> **不**用 TypeScript / Next.js / React — 保持 vanilla JS。

### 2. 建立 `.env`

```bash
cp .env.example .env
```

最低限度需要填：

```env
# 必填：選一個 provider
LLM_PROVIDER=perplexity            # perplexity | openai | anthropic | ollama
PERPLEXITY_API_KEY=pplx-xxxxxxxxxx

# License key（測試用 admin key，部署時請改掉）
ADMIN_LICENSE_KEY=ADMIN-TEST-2026

# 可選：其他 provider
# OPENAI_API_KEY=sk-xxx
# ANTHROPIC_API_KEY=sk-ant-xxx
# OLLAMA_BASE_URL=http://localhost:11434
```

### 3. 本地啟動

```bash
npm run dev          # netlify dev → http://localhost:8888
```

### 4. 跑 sample test（不用真 PDF）

```bash
npm test
```

會用 `tests/fixtures/techpack-A.json` 與 `techpack-B.json` 跑完整 workflow，輸出 mock 報告。

---

## ☁️ 部署到 Netlify

### 方法 A：透過 GitHub（推薦）

1. Push 整個 repo 到 GitHub
2. Netlify → **Add new site → Import from Git** → 選你的 repo
3. Build settings 會自動讀 `netlify.toml`，不用改
4. Site settings → **Environment variables** 加入：
   - `LLM_PROVIDER`
   - `PERPLEXITY_API_KEY`（或你選的 provider key）
   - `ADMIN_LICENSE_KEY`
5. Deploy → 等 build 完成 → 開 URL

### 方法 B：CLI 直接 deploy

```bash
npm i -g netlify-cli
netlify login
netlify init      # 第一次：連 site
netlify deploy --prod
```

### 設置完成後驗證

```
GET  https://<your-site>.netlify.app/.netlify/functions/health
```

應該回傳 `{ ok: true, service: 'techpack-compare-v2', providers: [...] }`。

詳細部署檢查清單請看 `docs/deployment-checklist.md`。

---

## 🔐 安全與 Quota

| 項目 | 設定 | 位置 |
|---|---|---|
| 檔案大小 | 每份 PDF ≤ 20MB | `src/config/limits.js` |
| 檔案格式 | 只接受 `application/pdf` | `netlify/functions/run-workflow.js` |
| Rate limit | 每 IP 每分鐘 10 requests | `src/services/rateLimiter.js` |
| License key | header `x-license-key` 必填 | `src/services/rateLimiter.js` |
| CORS | 預設只允許同源 + 環境變數白名單 | `netlify.toml` + functions |
| CSP / X-Frame-Options | strict CSP（禁第三方腳本） | `netlify.toml` |
| API key | 全部後端，前端永遠拿不到 | `src/services/llmClient.js` |

---

## 📡 主要 API（v2）

| Endpoint | 用途 |
|---|---|
| `GET  /health` | 健康檢查 + provider 狀態 |
| `POST /run-workflow` | **主入口**：跑整個 coordinator agent，支援 outputMode |
| `POST /extract` | 只跑 extractorAgent（debug 用） |
| `POST /measurement` | 只跑 measurementAgent |
| `POST /comments` | 只跑 commentAgent |
| `POST /images` | 只跑 imageAgent |
| `POST /summarize` | 只跑 summarizerAgent |

所有 request/response schema 請看 `docs/api-contracts.md`。

---

## 🧠 LLM Provider 切換

只要改 `.env` 一行：

```env
LLM_PROVIDER=openai     # 改用 GPT-5.5（measurement diff 推薦）
```

支援的 provider：

- `perplexity` — 預設，便宜快速，有 web grounding
- `openai` — GPT-5.5 系列，複雜推理 / measurement diff（幻覺低約 60%）
- `anthropic` — Claude 4.5 / 4.7 系列，長文檔分析
- `ollama` — 本地 Gemma 4 31B 或其他開源模型，敏感客戶資料 offline fallback

部分 agent 可以**強制使用特定 provider**（在 `src/agents/<agent>.js` 內以 `preferProvider` 設定）。

---

## 🛠 開發小提醒

- **不要**在前端寫任何 API key
- **不要**改成 `import axios` — 統一用 `fetch`
- **不要**改成 TypeScript
- **不要**引入 Next.js / React
- 新增 agent → 同時補一份 `src/schemas/<name>.schema.json`
- 改 prompt → 在 agent 檔案頂端註解寫變更日期 + 改動原因

---

## 📞 Support

如果你 fork / 二次開發遇到問題，請先看 `AGENTS.md`（給 AI 工具讀，但人類也能看懂），裡面有完整 architecture context。

---

License: 內部使用 / 商業授權待定
