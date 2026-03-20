# Investigation: Why could `data.entries` be undefined? (no-auth → auth)

**Context:** After switching to auth, the diary home page sometimes crashes with `TypeError: Cannot read properties of undefined (reading 'length')` in `EntriesPageContent` because `checkins` (derived from `entries` state) is undefined. That state comes from `initialEntries` passed from the parent, which does `setEntries(data.entries)` after `fetchEntries()` resolves.

**Question:** When would the list-entries API return something where `data.entries` is undefined?

---

## 1. Current API contract

- **Client:** `fetchEntries({ limit: 20 })` → `GET /diary/entries?limit=20` (through gateway).
- **Gateway:** Proxies `/diary/*` to diary-api; requires valid JWT cookie; sets `x-user-id` and `x-service-token`.
- **Diary-api:** `GET /entries` → `EntriesController.listEntries` → `EntriesService.listEntries` → always returns `{ entries: EntryResponse[], nextCursor: string | null }` (see `ListEntriesResponseSchema` in shared and `entries.service.ts` line 225–228).
- **Client:** `request<T>()` returns `res.json()` on 2xx; on 401 it refreshes or redirects and **throws**; on other non-ok it **throws**. So the only way the `.then(data => setEntries(data.entries))` runs is when the response is **2xx** and the body is whatever the server sent.

**Conclusion:** With the **current** diary-api and gateway code, a successful response for list-entries **always** has an `entries` array. The backend is not returning a shape without `entries` in the normal auth flow.

---

## 2. Why undefined could still appear (no-auth → auth)

- **Legacy or alternate response shape:** Before auth, there may have been a different endpoint or contract (e.g. `{ data: [...] }` or a different service). If any code path (e.g. old proxy, cached response, or different env) still returns 200 with a body that has no `entries` key, then `data.entries` would be `undefined`.
- **Wrong or cached response:** A proxy, CDN, or bug could return 200 with a different JSON (e.g. `{}` or `{ nextCursor: null }`). Then `data.entries` is `undefined`.
- **Auth edge case:** If in some edge case the gateway or another layer returned 200 with a non–list-entries body (e.g. a generic “ok” or auth payload) for the same URL, that would also lead to `data.entries === undefined`.

So the crash is **not** explained by the current diary-api implementation itself, but by the possibility of **an unexpected 200 response body** (legacy, misconfiguration, or auth transition) that doesn’t match `ListEntriesResponse`.

---

## 3. Recommendations

1. **Harden the client (done):** Treat list-entries as “must have `entries`” and defensively default so the UI never sees `undefined`:
   - In the diary home page: `setEntries(data.entries ?? [])` and `setCursor(data.nextCursor ?? null)`.
   - In `EntriesPageContent`: `useState(initialEntries ?? [])` (and treat `initialCursor` as optional/defaulted).
2. **Keep the API contract:** Diary-api should continue to return only `ListEntriesResponse` for `GET /entries`. No change needed there.
3. **Optional:** If the issue reappears, add a one-off log when `data.entries` is falsy after a 2xx list-entries response (e.g. `console.warn('List entries response missing .entries', data)`) to capture the actual response shape in production or staging.

---

## 4. Summary

| Layer        | Returns `entries`? | Notes |
|-------------|--------------------|--------|
| Diary-api   | Yes, always        | `listEntries()` returns `{ entries, nextCursor }`. |
| Gateway     | Forwards as-is     | No body rewrite; 401 if no/ invalid JWT. |
| Client      | Assumes yes        | No defensive default before this fix → crash if body has no `entries`. |

The API itself does not return `undefined` for `entries` in the current auth flow; the crash is avoided by defending against any 200 response that doesn’t match the expected contract (e.g. from no-auth → auth transition or misconfiguration).
