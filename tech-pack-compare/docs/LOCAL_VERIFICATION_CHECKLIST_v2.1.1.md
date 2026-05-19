# 本地驗收 Checklist — v2.1.1

**為何需要這份 checklist:**Sandbox 環境無法跑 `netlify dev` 或 puppeteer/playwright headless browser 自動截圖,所以以下項目需在你本機驗證。

## 前置

```bash
cd /home/user/workspace/v2
npm i               # 第一次
LLM_PROVIDER=mock netlify dev   # http://localhost:8888
# 或純 static (不過 functions 不會跑):
# python -m http.server -d public 8000
```

## A. KI-009 PDF.js 修復驗收

1. [ ] 開啟 DevTools Console — 應**無 CSP violation**(無 `Refused to load the script` / `Refused to load the worker` 紅錯)
2. [ ] Console 應有 boot log:`[Tech Pack Comparator] PDF.js 4.0.379 loaded from cdnjs`(或 jsdelivr 作 fallback)
3. [ ] DevTools → Network → 篩 `.mjs` — 應看見:
   - `pdf.min.mjs`(主模塊,cdnjs 來源)
   - `pdf.worker.min.mjs`(worker)
4. [ ] 把第一個 cdnjs URL 在 DevTools 改為 ad-blocker level(或斷網 cdnjs.cloudflare.com)後 reload → 應自動 fallback 去 jsdelivr,Console 印 `loaded from jsdelivr`
5. [ ] 全部 CDN 都失敗 → 應跳 Toast 友善訊息「無法載入 PDF.js · 請檢查網路連線」(不 throw raw Error)
6. [ ] 拖一份真 PDF 進 dropzone-a → 應正常解析顯示 thumbnail + page count
7. [ ] Inspector 「🔧 引擎資訊」卡應顯示 `v4.0.379 (cdnjs)` 而非「未載入」

## B. UI-1〜12 視覺驗收

### UI-1 Design Tokens
- [ ] Light mode:背景偏白、indigo accent (`#6366f1`)
- [ ] 切 dark mode (`theme-toggle` 按鈕,右上角 🌙):整個 page 切深色,卡片/pill/breadcrumb 都跟隨

### UI-2 Top Nav
- [ ] Breadcrumb 顯示 `Workspace › Compare Tech Pack › Step 1 · 上傳 PDF`
- [ ] 走 Step 2 / 3 / 4 → breadcrumb 即時更新
- [ ] 5 個 status pill(Provider 綠 / Mode 藍 / License 黃 / Duration 灰 / Tokens 灰)
- [ ] Provider pill 有脈動 dot
- [ ] 右上角 avatar (U) 是 indigo 漸層圓

### UI-3 Stepper
- [ ] 4 個 48px 大圓圈 + SVG icon
- [ ] Active step 圓有指環光 + pulse 動畫
- [ ] Done step 圓變綠 + 顯示 ✓
- [ ] Connector 線:done step 後是漸層 indigo→success,未走過是灰

### UI-4 Dropzone
- [ ] Idle 狀態:dashed border + 雲圖 icon
- [ ] Hover:border 變 indigo + 卡片 lift -1px
- [ ] Drag-over(拖檔在區域上):scale 1.01 + glow ring + indigo bg
- [ ] 解析中:`dz-progress-pct` 顯示百分比
- [ ] 上傳完成:綠卡含 thumb / filename / `N 頁 · KB` / 兩個 icon button(↺ replace, ✕ remove)

### UI-5 Workspace Card + Helper
- [ ] Card header 有 36px 圖示方塊 + 標題 + 灰 sub-text
- [ ] `.helper-text` 是藍色左 border + brand-50 bg
- [ ] Step 1 helper text 每 5 秒輪換 5 句不同提示(fade transition)
- [ ] 「下一步」按鈕有箭頭 + glow + hover 效果

### UI-6 Inspector
- [ ] 未上傳時:顯示 empty SVG + 「尚未開始」+ 「上傳 PDF 後即可看到摘要」
- [ ] 上傳後出現 5 個 collapse 卡:📄 / ⚙️ / 📊 / 📜 / 🔧
- [ ] 每個 head 有 ▸ 箭頭,點擊開合(原生 `<details>`)
- [ ] 📄 卡內 A / B 各一張 file-card,顯示 pill / 檔名(截斷) / `N 頁 · X KB` / 尺寸頁 chip + BOM 頁 chip
- [ ] 📊 卡(跑完 workflow 後):2×2 grid,4 個 28px 大數字
- [ ] 📜 卡:每個動作有 dot + 時間戳(HH:MM:SS)+ 文字(最多 5 個)
- [ ] 🔧 卡:`PDF.js v4.0.379 (cdnjs)`、`UI v2.1.1`、`Output FULL`

### UI-12 Tab indicator
- [ ] 切 tab(Summary → Measurement → Comments → BOM → QA) → 底部 indicator 滑動 (~0.3s easing)
- [ ] Resize 視窗 indicator 重新對齊
- [ ] Summary tab 頂部:4 個 hero stat(28px 數字 + uppercase label,gradient bg)

### Confetti
- [ ] Step 3 點「開始比對」→ 跑完彈 ~36 個彩條落下(2 秒內消失)

### Activity Timeline
- [ ] 上傳 A → 「最近動作」卡頂出現 `上傳 A · file.pdf (Np)`
- [ ] 上傳 B → 同上
- [ ] 跑完 workflow → `Workflow 完成 · NNms · MMM tokens`(綠 dot)
- [ ] 連續 6 次動作後 → 應只剩最後 5 個

## C. 5 outputMode 驗收

依次選 FULL / SUMMARY / MEASUREMENT_ONLY / BOM_ONLY,各跑一次,確認:
- [ ] Tab 顯示正確(SUMMARY 只應有 Summary tab 有內容)
- [ ] 匯出 Excel 對應 sheet 存在
- [ ] DEBUG_ALL 模式只有 Admin license(`ADMIN-*`)能解鎖

## D. 已知限制

- screenshot 自動截圖未提供 — 因 sandbox 無 puppeteer
- 4 tab(measurement/comments/bom/debug)進階 filter/sticky/split-view 留 v2.1.2

## E. 自動 mock test

```bash
cd v2 && LLM_PROVIDER=mock ADMIN_LICENSE_KEY='ADMIN-TEST-2026' \
  LICENSE_KEYS='ADMIN-TEST-2026,USER-DEMO-001' \
  node --test tests/
```
預期 `# pass 62 / # fail 0`。
