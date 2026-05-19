# Deployment Checklist — Netlify

Follow top-to-bottom. Check each box before moving on.

## 1. Pre-deploy

- [ ] `npm install` runs cleanly
- [ ] `npm test` passes (uses mock provider — no API key needed)
- [ ] `.env.example` is up to date with any new variables you added
- [ ] `package.json` `version` bumped if this is a release
- [ ] No real API key is committed to git (`grep -r "pplx-\|sk-" .` returns nothing under tracked files)

## 2. Netlify site setup

- [ ] Site is linked to the correct GitHub branch
- [ ] Build command: leave blank (no build step needed)
- [ ] Publish directory: `public`
- [ ] Functions directory: `netlify/functions`
- [ ] Node version: 18 (set in **Site → Build & deploy → Environment → Node version**)

## 3. Environment variables (Netlify UI)

Set under **Site settings → Environment variables**. Don't forget to redeploy after changes.

- [ ] `LLM_PROVIDER` = `perplexity` (or your choice)
- [ ] `PERPLEXITY_API_KEY` (if provider=perplexity)
- [ ] `OPENAI_API_KEY` (optional, but required if any agent prefers it)
- [ ] `ANTHROPIC_API_KEY` (optional)
- [ ] `OLLAMA_BASE_URL` (only if running a self-hosted reachable Ollama)
- [ ] `ADMIN_LICENSE_KEY` — **change from default!**
- [ ] `LICENSE_KEYS` — comma-separated, one per customer
- [ ] `MAX_FILE_MB` (default 20)
- [ ] `RATE_LIMIT_PER_MIN` (default 10)
- [ ] `ALLOWED_ORIGINS` — your production domain(s), NOT `*`

## 4. First deploy verification

- [ ] Open `https://<your-site>.netlify.app/` — UI loads, 繁中 text shows
- [ ] `GET https://<your-site>.netlify.app/.netlify/functions/health` → `ok: true`
- [ ] Try sample workflow with 2 small PDFs — agents progress bar updates
- [ ] Open browser DevTools → Network → confirm no API key is visible in any frontend request
- [ ] Open Netlify **Functions → logs** — confirm logs don't leak keys (we redact, but verify)

## 5. Post-deploy hardening

- [ ] Rotate `ADMIN_LICENSE_KEY` to a fresh random value
- [ ] Set `ALLOWED_ORIGINS` to your real domain
- [ ] Configure Netlify **Deploy notifications** so you know when builds break
- [ ] Enable Netlify **Analytics** to monitor function usage / cost
- [ ] (Optional) Set up uptime monitor pinging `/health` every 5 min

## 6. Rollback plan

- Netlify keeps every deploy. To roll back: **Deploys → pick a green deploy → Publish deploy**.
- If a function is broken but the static site works, you can also delete the function from `netlify/functions/` and redeploy — frontend will show a graceful error rather than crash.
