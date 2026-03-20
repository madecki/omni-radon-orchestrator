# Plan: Shell as MFE Host (single app experience)

**Goal:** After login, the user stays in one “app”: the shell. The shell shows a simple UI chrome (account, logout, nav) and **embeds** independent MFE apps (Diary, Todo, Health) so that switching between them feels like client-side navigation in a single app, while under the hood each MFE remains a separate application.

**Scope:** Analysis and work plan only. No implementation in this document.

---

## 1. Current state (summary)

| Layer | Current behavior |
|-------|------------------|
| **Shell** | Next.js. Routes: `/`, `/login`, `/register`. After auth, does `window.location.href = "/app/diary"` (full navigation away from shell). No post-login chrome, no MFE embedding. |
| **Gateway** | Path-based routing: `/*` → shell; `/app/diary`, `/app/diary/`, `/app/diary/*` → diary app. So `/app/diary` replaces the document with the diary app’s HTML. |
| **Diary** | Next.js, `basePath: "/app/diary"`, dev on 4280. API calls relative: `/diary`, `/auth/v1/auth/refresh`; redirect to `/login` on session expiry. |
| **Auth** | Gateway sets httpOnly cookies (`access_token`, `refresh_token`, `user_id`) after login/register. All frontends use same origin (gateway) so cookies work. |

**Conclusion:** Today the shell does **not** embed the diary; the gateway switches documents by path. To get “shell as host,” the shell must own the document after login and load MFEs inside that document (iframe or Module Federation).

---

## 2. Target model

1. **Unauthenticated:** Shell only shows login or register. No chrome.
2. **Authenticated:** Shell is the only document. It renders:
   - **Chrome:** Account info (e.g. user id/email from cookie or `/auth/v1/auth/me`), logout, and **nav** (e.g. Diary | Todo | Health).
   - **Content area:** The active MFE (Diary, Todo, or Health), loaded so it feels like one app (no full-page reload when switching).
3. **Routing:** Shell owns the URL after login, e.g.:
   - `/app` → default (e.g. redirect to `/app/diary`)
   - `/app/diary` and `/app/diary/...` (e.g. `/app/diary/entries/123`) → Diary MFE
   - `/app/todo` and `/app/todo/...` → Todo MFE (future)
   - `/app/health` and `/app/health/...` → Health MFE (future)
4. **MFEs:** Remain independent apps (separate repos, own build, own stack). They are “embedded” by the shell via one of the mechanisms below; they do not render the shell chrome.

---

## 3. Embedding options (high level)

| Option | How it works | Pros | Cons |
|--------|---------------|------|-----|
| **A. Iframe** | Shell has one document; chrome + iframe. Iframe `src` = URL that gateway proxies to the MFE (e.g. `/mfe/diary`, `/mfe/diary/entries/123`). Same origin → cookies work. | Simple, MFEs fully independent, any stack per MFE, easy to add Todo/Health later. | Separate document per MFE (focus, scroll, print); need to align deep links and address bar (see below). |
| **B. Module Federation** | Shell = host; Diary (and later Todo, Health) = remotes exposing a root component. Shell renders `<DiaryApp />` in the content area. Single document. | Single DOM, no iframe boundaries, shared React context possible. | Build-time coupling, shared React/Next version constraints, all MFEs must be JS bundles consumable by the host. |
| **C. Web Components / generic mount** | Each MFE builds a single bundle that mounts into a shell-provided DOM node (e.g. custom element or `div` + `script`). | Framework-agnostic shell, MFEs can be different frameworks. | Each MFE must implement a contract (mount/unmount, routing); more custom glue. |

**Recommendation for this plan:** Assume **Option A (iframe)** as the default: minimal changes to existing MFEs, clear gateway contract, and straightforward addition of Todo and Health. Option B can be considered later if you want a single DOM and are willing to align build and React versions.

---

## 4. Proposed architecture (iframe-based)

- **Gateway**
  - **Shell document:** All HTML that should be “the app” after login is served by the shell. So every path that the user can land on (including deep links) must be served by the shell when it’s a “top-level” navigation. That implies:
    - `GET /` → shell (login or redirect)
    - `GET /login`, `GET /register` → shell
    - `GET /app`, `GET /app/*` (e.g. `/app/diary`, `/app/diary/entries/123`, `/app/todo`, `/app/health`) → **shell** (not diary/todo/health). So the shell is the only app that serves the main document for these routes.
  - **MFE content (for iframe):** Gateway exposes a dedicated path prefix per MFE that returns the MFE’s HTML/JS (for the iframe only). Example:
    - `GET /mfe/diary`, `GET /mfe/diary/`, `GET /mfe/diary/*` → proxy to **diary** app.
    - Later: `/mfe/todo/*` → todo app, `/mfe/health/*` → health app.
  - **APIs:** Unchanged: `/auth/*`, `/diary/*`, `/tasks/*` (future), etc.

- **Shell**
  - **Routes (App Router):**
    - `/`, `/login`, `/register` → current behavior (login/register only; redirect to `/app` if already authenticated).
    - `/app` → layout that shows chrome + default MFE (e.g. redirect to `/app/diary` or render diary iframe).
    - `/app/diary/[[...path]]` → same layout; chrome + iframe with `src="/mfe/diary"` or `src={/mfe/diary/${path}` so deep links like `/app/diary/entries/123` load diary at `/mfe/diary/entries/123` inside the iframe.
    - Later: `/app/todo/[[...path]]`, `/app/health/[[...path]]` with iframe `src="/mfe/todo/..."`, `/mfe/health/..."`.
  - **Chrome:** Header/sidebar with: app title, nav links (Diary, Todo, Health), account info (from cookie or `/auth/v1/auth/me`), logout (call auth logout then redirect to `/login`).
  - **Auth guard:** Shell layout for `/app/*` checks session (e.g. `getSessionUserId()` or call `/auth/v1/auth/me`); if not authenticated, redirect to `/login`. No full-page redirect to diary on login; redirect to `/app` or `/app/diary` (shell route).
  - **No more `redirectToDiary()`** as a full document change; it becomes “navigate to shell route `/app/diary`” (client-side or soft nav).

- **Diary (and future MFEs)**
  - **Served under `/mfe/diary`** (not `/app/diary`) so that the “document” for the diary is only ever loaded inside the shell’s iframe. Gateway proxies `/mfe/diary/*` → diary app.
  - **Diary app config:** `basePath` (or equivalent) set to `/mfe/diary` (e.g. `NEXT_PUBLIC_DIARY_BASE_PATH=/mfe/diary`). Asset prefix in dev can stay pointing at the diary dev server (e.g. 4280) for HMR.
  - **Deep links:** Diary internal links can stay relative to its base (e.g. `/mfe/diary/entries/123`). When user clicks a link inside the iframe, the iframe navigates; the shell can optionally sync the address bar to e.g. `/app/diary/entries/123` via `postMessage` or by not changing the top URL (keep `/app/diary` and only the iframe has the deep path). Either approach is valid; syncing is nicer for “one app” feel and bookmarks.
  - **Session expiry:** Today diary does `window.location.href = "/login"`. In an iframe, that would only change the iframe. Options: (1) Use `window.parent.location.href = "/login"` when running inside iframe (detect via `window.self !== window.top`), or (2) postMessage to shell and let shell redirect top frame, or (3) shell periodically checks session and redirects. Plan should include one of these.

- **Todo / Health (future)**
  - Same pattern: each has its own app, own repo, served by gateway under `/mfe/todo/*`, `/mfe/health/*`. Shell adds routes `/app/todo/[[...path]]`, `/app/health/[[...path]]` and nav entries; iframe `src` points at `/mfe/todo/...`, `/mfe/health/...`.

---

## 5. Work breakdown (by area)

### 5.1 Gateway

- **Stop serving diary (and future MFEs) as top-level document for `/app/*`.**  
  Remove or repurpose the current rule that sends `GET /app/diary` and `GET /app/diary/*` to the diary app. All `GET /app` and `GET /app/*` should go to the **shell** so the shell is the only app rendering the main document for “logged-in” routes.

- **Add MFE iframe-content routes.**  
  New prefix(es) used only for iframe content:
  - `/mfe/diary`, `/mfe/diary/`, `/mfe/diary/*` → proxy to diary app (same upstream as current diary app).
  - Later: `/mfe/todo/*` → todo app, `/mfe/health/*` → health app.

- **Config.**  
  - Either reuse `DIARY_APP_UPSTREAM_URL` for `/mfe/diary/*` or introduce something like `DIARY_MFE_UPSTREAM_URL` (same value in practice).  
  - Ensure no other route serves the main document for `/app/*` (only shell).

- **Order of routes.**  
  Register `/mfe/diary/*` (and later `/mfe/todo/*`, `/mfe/health/*`) before the shell catch-all; keep `/app/*` as part of the shell catch-all so shell handles all `/app` HTML.

### 5.2 Shell

- **Auth and root behavior.**  
  - Keep `/`, `/login`, `/register` as today.  
  - After successful login/register, redirect to **`/app`** or **`/app/diary`** (shell route), not to a URL that is served by the diary app.  
  - If user is already authenticated and hits `/` or `/login`, redirect to `/app` (or `/app/diary`).

- **App layout and chrome.**  
  - New layout for `/app` and `/app/*`:  
    - Header/sidebar: branding, nav links (Diary, Todo, Health), account (e.g. user id or email), logout.  
    - Main content: single “slot” where the active MFE is shown (iframe or, later, Module Federation mount).  
  - Logout: call gateway logout (e.g. POST `/auth/v1/auth/logout`), then redirect top window to `/login`.

- **Routing and iframe.**  
  - **`/app`** → redirect to `/app/diary` (or show diary by default).  
  - **`/app/diary`** and **`/app/diary/[[...path]]`** → same layout; iframe `src` = `/mfe/diary` or `/mfe/diary/${path}` so deep links work.  
  - **`/app/todo`**, **`/app/health`** (later): same idea with `/mfe/todo`, `/mfe/health`.  
  - Use client-side navigation (e.g. Next `<Link>`) for nav items so switching MFE doesn’t reload the whole document.

- **Auth guard for `/app/*`.**  
  - In the app layout (or a middleware), ensure only authenticated users see the chrome + MFE; otherwise redirect to `/login`. Use existing cookie (e.g. `getSessionUserId()`) or `/auth/v1/auth/me`.

- **Remove / replace `redirectToDiary()`.**  
  - Replace with navigation to `/app/diary` (shell route), e.g. `router.push('/app/diary')` or `window.location.href = '/app/diary'` (latter still keeps user in shell document).

- **Optional: address bar sync.**  
  - When the iframe navigates (e.g. diary internal link), shell can listen to iframe `postMessage` or use iframe’s path and update the browser URL (e.g. Next `router.replace`) so `/app/diary/entries/123` is bookmarkable and “feels” like one app. Requires diary to post path changes to parent (or use `window.parent.postMessage` on route change).

### 5.3 Diary app

- **Base path.**  
  - Change from `/app/diary` to `/mfe/diary` (e.g. env `NEXT_PUBLIC_DIARY_BASE_PATH=/mfe/diary` and in next.config use it for `basePath`). All diary routes and links are then under `/mfe/diary`.

- **Run in iframe.**  
  - Ensure nothing assumes it’s the top window (e.g. modals, redirects).  
  - **Session expiry redirect:** When refresh fails and diary would redirect to login, either:  
    - `window.top.location.href = '/login'` (or gateway login path), or  
    - `window.parent.postMessage({ type: 'SESSION_EXPIRED' }, origin)` and let shell redirect.  
  - Document this in diary README or ADR.

- **Links and navigation.**  
  - Internal links stay under `/mfe/diary/...` (relative or basePath-relative). No change if already relative.  
  - If you later want address bar sync, diary could send path updates to parent (e.g. on route change in Next app router).

- **Dev and asset prefix.**  
  - In dev, asset prefix can still point to diary’s dev server (e.g. 4280). Gateway only proxies HTML (and optionally static) for `/mfe/diary/*` to the diary app; JS/CSS can still load from 4280 if desired.

### 5.4 Todo app (future)

- New Next (or other) app; built and run independently.  
- Gateway: add upstream for todo app; register `/mfe/todo`, `/mfe/todo/`, `/mfe/todo/*` → todo app.  
- Shell: add route `/app/todo/[[...path]]`, iframe `src` = `/mfe/todo` or `/mfe/todo/${path}`; add “Todo” to chrome nav.  
- Same pattern as diary: basePath `/mfe/todo`, session expiry redirect to top or postMessage to shell.

### 5.5 Health app (future)

- Same as Todo but for `/mfe/health` and `/app/health`.

### 5.6 Auth and cookies

- No change to gateway auth cookie logic (login, register, refresh, logout, cookies).  
- All MFE iframe requests are same-origin (gateway), so cookies are sent; diary (and future MFEs) keep using relative `/auth/*` and `/diary/*` (or `/tasks/*`, etc.) as today.

---

## 6. URL and routing summary (iframe approach)

| User sees (address bar) | Served by | Content area |
|------------------------|-----------|--------------|
| `/`, `/login`, `/register` | Shell | Login or register form |
| `/app`, `/app/diary`, `/app/diary/entries/123` | Shell | Chrome + iframe pointing at `/mfe/diary` or `/mfe/diary/entries/123` |
| `/app/todo`, `/app/todo/...` (future) | Shell | Chrome + iframe at `/mfe/todo/...` |
| `/app/health`, `/app/health/...` (future) | Shell | Chrome + iframe at `/mfe/health/...` |

| Iframe loads (same origin) | Proxied by gateway to |
|----------------------------|----------------------|
| `/mfe/diary`, `/mfe/diary/*` | Diary app |
| `/mfe/todo/*` (future) | Todo app |
| `/mfe/health/*` (future) | Health app |

---

## 7. Implementation order (suggested)

1. **Gateway:** Add `/mfe/diary/*` proxy to diary; remove (or stop using) `/app/diary` and `/app/diary/*` for serving the main document (so `/app/*` is only shell).  
2. **Diary:** Switch basePath to `/mfe/diary`; adjust session-expiry redirect to top frame or postMessage.  
3. **Shell:** Add `/app` layout with chrome (placeholder nav: Diary only), auth guard, and iframe for `/app/diary` and `/app/diary/[[...path]]`; post-login redirect to `/app/diary`; logout in chrome.  
4. **Polish:** Nav highlighting from URL; optional address bar sync with iframe path.  
5. **Later:** Todo and Health MFEs and their gateway + shell routes.

---

## 8. Risks and open points

- **CSP / iframe:** If you use strict Content-Security-Policy, ensure `frame-src` allows same origin (or the gateway origin) so the shell can embed the MFE iframes.  
- **Deep link and back/forward:** If the address bar is `/app/diary/entries/123`, the shell must set iframe `src` to `/mfe/diary/entries/123` on load and on back/forward; Next.js client-side routing in the shell should handle that.  
- **Module Federation (optional later):** If you later move from iframe to Module Federation, the gateway no longer needs to serve MFE HTML for iframes; the shell would load remote entry and mount components. Auth and API routing stay the same.

This plan keeps the “one app” experience (shell + chrome + routing) while keeping MFEs independent and leaves room to add Todo and Health the same way.
