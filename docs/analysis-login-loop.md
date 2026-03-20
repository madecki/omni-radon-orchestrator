# Analysis: Infinite loop displaying login form

**Symptom:** App appears stuck in a loop showing the login form (no implementation in this doc).

---

## 1. Loop mechanics

The redirect chain that can produce the loop:

| Step | Where | What happens |
|------|--------|---------------|
| 1 | `/login` | Login page `useEffect`: `if (getSessionUserId()) redirectToDiary()`. If `user_id` cookie is set → full navigation to `/app/diary`. |
| 2 | `/app/diary` | Shell shows chrome + iframe. Iframe loads diary at `/mfe/diary`. |
| 3 | Diary (iframe) | Diary calls e.g. `fetch("/diary/entries")`. If response is **401**, diary calls `tryRefresh()` then, if refresh fails, `redirectToLogin()` → **top frame** navigates to `/login`. |
| 4 | Back to `/login` | If `user_id` cookie is **still set**, step 1 runs again → redirect to `/app/diary` → loop. |

So the loop exists when:

- **A)** Diary gets 401 (on entries or after refresh), so it sends the top frame to `/login`, and  
- **B)** When we land on `/login`, `user_id` is still present, so the login page immediately redirects back to `/app/diary`.

The crucial point: **when the diary “session expired” flow sends the user to `/login`, the auth cookies (at least `user_id`) must be cleared**. If they are not, the login page keeps redirecting to `/app/diary` and the loop is inevitable.

---

## 2. When are cookies cleared?

**Gateway auth-cookie handler (refresh):**

- When the **auth service** returns a non-OK response (invalid/expired refresh token): gateway calls `clearAuthCookies(reply)` and then returns 401. So in that case cookies are cleared.
- When the **refresh token is missing** from the request (`!refreshToken`): gateway returns 401 **without** calling `clearAuthCookies(reply)`.

So:

- **If** the diary’s refresh request reaches the gateway **without** the `refresh_token` cookie, the gateway responds with 401 but **does not clear** `access_token` or `user_id`.
- Then the diary does `redirectToLogin()` → top frame goes to `/login`.
- `user_id` is still set → login page redirects to `/app/diary` → diary loads again → 401 again → refresh (again without cookie?) → 401 without clear → `/login` again → loop.

So one **sufficient** cause of the loop is: **refresh returns 401 without clearing cookies** (the “no refresh token” branch in the gateway).

---

## 3. Why might the refresh request lack the refresh token?

- **Cookie path:** `refresh_token` is set with `path: '/auth'`, so the browser sends it only when the request URL path is under `/auth`. The diary calls `fetch("/auth/v1/auth/refresh")`, so from a document at e.g. `https://localhost:3000/mfe/diary` the request goes to `/auth/v1/auth/refresh`. That path is under `/auth`, so in normal same-origin behaviour the cookie should be sent.
- **Edge cases:** Some browsers or strict SameSite/cookie behaviour could in theory not send the cookie in an iframe-originated request; or the cookie might have been dropped/expired earlier while `user_id` (path `/`) remained. Regardless of the reason, if the gateway ever returns 401 for the refresh flow, it should clear cookies so the client does not loop.

So the **primary** fix is: **on any 401 from the refresh flow (including “no refresh token”), the gateway should clear auth cookies before responding.** That breaks the loop by ensuring that when the user is sent to `/login` after “session expired”, `user_id` is no longer set.

---

## 4. Other possible contributors (optional to fix)

- **Diary gets 401 on first request:** If the iframe’s `fetch("/diary/entries")` sometimes does not send the `access_token` cookie (e.g. SameSite/partitioning in some browsers), the diary would see 401, try refresh, and then either refresh also fails (leading to the same “clear vs not clear” behaviour above) or refresh succeeds and the retry works. Ensuring “401 from refresh → always clear cookies” still prevents the loop when refresh fails.
- **Timing:** If the browser sometimes applies `Clear-Session` from the refresh response after the client has already done `top.location = "/login"`, the next load of `/login` might still see the old `user_id`. That’s a lesser concern if we always clear on 401 from refresh; the important part is that the gateway does send the clear and that we don’t have a path where we return 401 without clearing (e.g. “no refresh token”).

---

## 5. Summary

| Cause | Mechanism |
|-------|-----------|
| **Main** | Gateway refresh handler returns 401 when `refresh_token` is **missing** and does **not** call `clearAuthCookies(reply)`. So `user_id` (and optionally `access_token`) remain. Diary redirects top to `/login`; login sees `user_id` and redirects to `/app/diary` again → loop. |
| **Fix (recommended)** | In the gateway, whenever the refresh flow returns 401 (including the “no refresh token” branch), call `clearAuthCookies(reply)` before sending the response so that landing on `/login` after “session expired” always sees a cleared session and does not redirect back to `/app/diary`. |

No code changes were made in this analysis; this is diagnosis only.
