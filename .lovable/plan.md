## Root-cause analysis of UI flicker

After tracing the auth + routing shell, three real flicker sources remain. Everything else (theme FOUC, scroll, keep-alive panes) is already handled.

### 1. AppLayout unmounts the entire shell on every gating decision
`src/components/layout/AppLayout.tsx` returns `null` while `loading || !user || !role`. Because `AppLayout` is the parent route element wrapping **every** protected route, any moment its gate flips back to "not ready" tears down the sidebar, header, tab bar, workspace panes, and `WorkspaceFileRenderer` — then rebuilds them. This is the main flash users see on:
- **Login** — `AuthPage` navigates to `/`, `Index` redirects to `/dashboard`. Between those two route changes `AppLayout` mounts with `role===null` (still being fetched) → renders `null` → role arrives → full shell mounts. Visible blank frame.
- **Refresh (F5)** — on initial load `loading=true`, shell renders `null`. Once session+role resolve, the entire shell paints from scratch.
- **Token refresh / brief session blips** — `AuthProvider.applySessionState` flips `role` to `null` for a few ms during re-fetch, unmounting the shell.

### 2. Double redirect on successful login
`AuthPage.handleSubmit` calls `navigate('/')` after `signIn`. `Index.tsx` then renders `null` until `loading` is false, then `<Navigate to="/dashboard">`. That's two route transitions and one null render between login click and dashboard paint → visible flash. Should navigate straight to `/dashboard`.

### 3. RoleGuard returns `null` on every gated navigation
`RoleGuard` renders `null` while `loading || role===null`. On any in-app navigation into a guarded route, if React re-runs the guard before context value is memoised, the `<Outlet />` blanks for a frame. With the AppLayout fix this becomes harmless (parent stays mounted), but RoleGuard should still preserve the previous Outlet rather than blank.

### Not actually broken (verified)
- Theme FOUC is already prevented by the inline script in `index.html`.
- `ScrollToTop` already defers to `requestAnimationFrame` — no jump.
- Workspace tabs use `app-keepalive-pane` (instant swap, no cross-fade).
- React Query is configured with `refetchOnWindowFocus: false`.
- React Strict Mode is not enabled in `main.tsx`.

---

## Fix plan

### A. Stop unmounting the shell — `src/components/layout/AppLayout.tsx`
Replace the `if (loading) return null;` / `if (!role) return null;` gates with a persistent shell:
- Always render `AppSidebar`, `AppHeader`, and the tab bar.
- Show a lightweight **content-area** placeholder (matching shell background) only inside `<main>` while `loading || !role` is true, instead of blanking the entire page.
- Keep the `Navigate to="/auth"` only for the resolved `!user` case (after `loading` settles).
- Net effect: sidebar/header/tab bar never disappear during auth re-validation, token refresh, or navigation between guarded routes.

### B. Skip the `/` bounce after login — `src/components/auth/AuthPage.tsx`
- On successful `signIn`, call `navigate('/dashboard', { replace: true })` instead of `navigate('/')`.
- Keeps `Index.tsx` untouched (still useful for cold loads on `/`).

### C. Make RoleGuard non-blanking — `src/components/layout/RoleGuard.tsx`
- While `loading || role===null`, render `<Outlet />` anyway (the previous content stays painted) instead of `null`. The role decision will redirect a frame later if needed — no visual blank.
- Keep the `Navigate` redirects for resolved mismatches.

### D. Suppress redundant role re-fetch — `src/contexts/AuthContext.tsx`
- The auth logs show 4 `GET /user` within ~2s after each login. `applySessionState` runs once from `recoverSession` and again from `onAuthStateChange('SIGNED_IN')` for the same userId. The current `currentUserId` guard already exists for `onAuthStateChange`, but the very first `getSession`/`onAuthStateChange` race still double-applies because `currentUserId` is set inside an async closure.
- Move `currentUserId` and the initial-application guard into a single `useRef` so a second apply for the same userId is a no-op (no second role fetch, no extra state churn).

### E. Optional smoothing
- Add a tiny `transition: opacity 80ms` on `<main>` so the content area's loading→ready swap is imperceptible instead of a hard frame.

---

## Files touched

- `src/components/layout/AppLayout.tsx` (persistent shell, scoped loading placeholder)
- `src/components/auth/AuthPage.tsx` (direct navigate to `/dashboard`)
- `src/components/layout/RoleGuard.tsx` (render Outlet during transient unknown state)
- `src/contexts/AuthContext.tsx` (de-dupe initial role fetch)
- `src/index.css` (one-line opacity transition on `main`)

## Verification

- **Login** — submit credentials → no blank frame, sidebar/header already on screen as dashboard content fades in.
- **F5 refresh** on any guarded route — shell paints immediately with placeholder in content area; content fills in without remounting sidebar/header.
- **Route navigation** between `/dashboard`, `/deals`, `/contacts/*`, `/admin/*` — shell stays mounted, only `<main>` swaps.
- **Token refresh** (wait for silent refresh or trigger via devtools) — no flash; role re-fetch is suppressed when userId unchanged.
- **Logout** — clean transition to `/auth` (no intermediate blank shell).
- Cross-browser smoke check in Chrome, Edge, Firefox at slow-3G throttling.

No backend, schema, or data-layer changes. All edits are presentation/lifecycle only and respect the project's minimal-change policy.