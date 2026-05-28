# Fix Navigation Flicker

## Root causes identified

1. **`RoleGuard` loader flashes on every guarded navigation.** `src/components/layout/RoleGuard.tsx` returns a centered `Loader2` whenever `role === null || loading`. Even when auth is already resolved, React Router re-evaluates the guard on each route change and the guard component re-mounts, briefly showing the spinner before `Outlet` renders.

2. **`AppLayout` shows a full-screen "Loading..." overlay** on auth/role transitions, which can flash on tab focus or token refresh.

3. **Keep-alive pane fade transition causes a visible cross-fade flicker.** `src/index.css` `.app-keepalive-pane { transition: opacity 150ms ease-in-out, visibility 150ms ease-in-out }` cross-fades workspace ↔ outlet panes on every navigation. With both panes positioned, the inactive one briefly remains visible at low opacity.

4. **`Outlet` route content is wrapped in a div that toggles `app-route-hidden` (absolute, opacity 0).** During the toggle between workspace and non-workspace routes, both wrappers exist simultaneously and the absolute one paints under the other for a frame.

5. **`ScrollToTop` runs `window.scrollTo` synchronously on every `pathname` change**, causing a perceptible jump when the next page is still mounting.

6. **`QueryClient` `staleTime: 30_000` is fine, but no `placeholderData`/`keepPreviousData` on list queries** — pages re-show their own skeletons on revisits. (Not changed here; out of minimal scope unless requested.)

## Changes (frontend / presentation only)

### A. `src/components/layout/RoleGuard.tsx`
- Remove the inline `Loader2` fallback. Instead, return `null` while `loading || role === null` so the previously-rendered route stays painted until the new route is ready. This prevents the spinner flash between routes (AuthProvider already gates the entire app initially in `AppLayout`).

### B. `src/components/layout/AppLayout.tsx`
- Replace the two intermediate "Loading..." full-screen blocks (when `loading` or `!role`) with `null`. The initial unauth path still redirects via `<Navigate to="/auth" />`. This eliminates the brief spinner that appears on session refresh.

### C. `src/index.css`
- Remove the `transition: opacity 150ms ease-in-out, visibility 150ms ease-in-out` from `.app-keepalive-pane`. Swap panes instantly — no cross-fade, no flicker.
- Keep `.app-route-hidden` rule but add `display: none` fallback (still keyed by class so React state is preserved via the keep-alive pane mechanism for the workspace; outlet routes were already remounting). Use `content-visibility: hidden` so the hidden subtree is not painted at all.

### D. `src/components/ScrollToTop.tsx`
- Defer `window.scrollTo` to the next paint via `requestAnimationFrame` so the scroll happens after the new route has rendered, eliminating the visible jump during transition.

### E. (Optional, low risk) `src/App.tsx`
- Wrap `<Routes>` in a `<Suspense fallback={null}>` boundary (currently no lazy imports — defensive only; skip if not needed).

## Out of scope (per minimal-change policy)
- No changes to data fetching, React Query config, page-level skeletons, or any business components.
- No changes to routing structure, AuthContext logic, or schema.
- No new dependencies.

## Verification
- Navigate between `/dashboard`, `/deals`, `/contacts/*`, and `/deals/:id/edit` — confirm no spinner flash, no white flash, no cross-fade between panes, and no scroll jump.
- Hard-refresh on guarded routes — confirm previously-rendered content is replaced cleanly once auth resolves.
- Sidebar/header remain mounted (already the case via single `AppLayout`).
