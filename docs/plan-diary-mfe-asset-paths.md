# Plan: Diary MFE asset paths (fix blank page in iframe)

**Goal:** Fix the blank diary screen when the diary app is loaded inside the shell iframe. Root cause: Next.js emits asset URLs without `basePath`, but the dev server serves assets only under `basePath`, so all JS/CSS return 404.

**Scope:** Plan only. No implementation in this document.

---

## 1. Problem summary

| What | Detail |
|------|--------|
| **Symptom** | Diary iframe shows blank page; console shows 404 for every `http://localhost:4280/_next/static/chunks/...` |
| **Cause** | With `basePath: "/mfe/diary"` and `assetPrefix: "http://localhost:4280"`, Next.js emits `assetPrefix + "/_next/static/..."` (no basePath). The dev server with basePath serves assets only at `/mfe/diary/_next/static/...`. |
| **Where** | diary-web (`next.config.ts`, and possibly gateway if we choose proxy-based fix) |

---

## 2. Options to fix the mismatch

### Option A: Emit asset URLs that include basePath (diary only)

- **Idea:** Make Next.js emit `http://localhost:4280/mfe/diary/_next/static/...` so the browser requests the path the dev server actually serves.
- **How:** Next.js does not offer a single “prefix assets with basePath when using assetPrefix” flag. Workarounds:
  - **A1.** Set `assetPrefix` to include basePath in dev: `assetPrefix: "http://localhost:4280/mfe/diary"`. Then emitted URLs become `http://localhost:4280/mfe/diary/_next/static/...`. Verify in Next 16 + Turbopack that this is applied consistently to all chunks and that the dev server serves at that path (already confirmed: `/mfe/diary/_next/static/...` returns 200).
  - **A2.** If A1 leaves some assets without the prefix, check for Next.js config or Turbopack options that control asset path prefixing; document any findings.
- **Pros:** No gateway changes; fix is contained in diary-web.  
- **Cons:** Relies on Next.js/Turbopack behaviour; may need a follow-up if some assets still 404.

### Option B: Gateway proxies diary static assets under /mfe/diary

- **Idea:** Keep diary emitting `http://localhost:4280/_next/static/...`. Gateway proxies `GET /mfe/diary/_next/*` to the diary. Then either:
  - **B1.** Change diary’s dev `assetPrefix` to the gateway origin and path: `http://localhost:3000/mfe/diary` so the browser requests `http://localhost:3000/mfe/diary/_next/static/...` → gateway → diary’s `/mfe/diary/_next/static/...` (gateway strips `/mfe/diary` and forwards to diary root, or forwards path as-is; must match how diary serves).
  - **B2.** Or keep assetPrefix as `http://localhost:4280` and add a second proxy in the gateway: e.g. `GET /mfe/diary-assets/_next/*` → proxy to `http://localhost:4280/mfe/diary/_next/*`, and set diary’s assetPrefix to `http://localhost:3000/mfe/diary-assets` so all asset requests go through the gateway. More moving parts.
- **Pros:** Clear separation: gateway owns “how the app is reached”; diary can keep basePath semantics.  
- **Cons:** Gateway and diary config both change; more complexity; HMR WebSocket would still need handling if we want live reload (separate plan).

### Option C: Don’t use basePath in development

- **Idea:** In dev only, set `basePath` to `""` (or a dev-only env that omits `/mfe/diary`). Dev server then serves app at `/` and assets at `/_next/static/...`. The iframe would load the diary at a URL that the gateway proxies to the diary root (e.g. gateway `/mfe/diary` → diary `/`).
- **How:** `basePath: process.env.NEXT_PUBLIC_DIARY_BASE_PATH ?? (process.env.NODE_ENV === 'development' ? '' : '/mfe/diary')`, and ensure the gateway forwards `/mfe/diary` and `/mfe/diary/*` to the diary with path rewrite so the diary sees `/` and `/*` (e.g. strip `/mfe/diary` before forwarding).
- **Pros:** Dev asset paths are simple; no 404s.  
- **Cons:** Dev and production configs differ; path rewrite in gateway must be correct; links and router in diary must work when basePath is empty in dev (usually do if they use relative or Next’s basePath).

---

## 3. Recommended approach

- **Prefer Option A (diary-only, emit URLs with basePath).**  
  - **Step 1:** In diary-web `next.config.ts`, set dev `assetPrefix` to `"http://localhost:4280/mfe/diary"`.  
  - **Step 2:** Restart diary dev server, load the app in the iframe, and verify in DevTools that every requested asset URL is `http://localhost:4280/mfe/diary/_next/static/...` and returns 200.  
  - **Step 3:** If any asset still 404s, document which (e.g. by checking Network tab and HTML source) and either adjust config or consider Option B/C for those paths only.

- **If Option A is unreliable** (e.g. Turbopack emits some paths without basePath):  
  - **Fallback:** Option C (no basePath in dev + gateway path rewrite) is the next simplest; Option B is an alternative if we want all traffic through the gateway in dev.

---

## 4. HMR WebSocket (optional, later)

- **Issue:** In the iframe, the HMR client connects to `ws://localhost:3000/...` (document origin) instead of `ws://localhost:4280`.  
- **Impact:** Hot reload doesn’t work in the iframe; app behaviour is unaffected.  
- **Plan:** Defer. If needed later, options are: proxy WebSocket on the gateway for `/_next/webpack-hmr` to the diary dev server, or configure Next.js/Turbopack so the HMR client uses the diary origin when `assetPrefix` is set (if supported).

---

## 5. Implementation checklist (when implementing)

- [ ] Update diary-web `next.config.ts` (Option A: `assetPrefix` including basePath in dev).
- [ ] Restart diary dev server and verify all asset requests return 200 and the diary page renders in the iframe.
- [ ] If 404s remain: document URLs and consider gateway path rewrite (Option C) or proxy (Option B).
- [ ] (Optional) Add a short note in diary README or plan about basePath + assetPrefix in dev and that HMR may not work in the iframe.

---

## 6. References

- Current behaviour: `GET /mfe/diary` → 200; `GET /_next/static/...` → 404; `GET /mfe/diary/_next/static/...` → 200 (verified 2026-03-12).
- Plan for shell as MFE host: `docs/plan-shell-as-mfe-host.md`.
