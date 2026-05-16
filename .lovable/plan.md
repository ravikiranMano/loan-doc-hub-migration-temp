
# Fix: Eliminate UI Flicker During Navigation, Refresh & Loading

## Root Causes Identified

After auditing routing, auth, layout, and data-loading patterns, the flicker is driven by **5 concrete issues** — not a global rendering problem.

### 1. `RoleGuard` redirect race (biggest visible flicker)
`src/components/layout/RoleGuard.tsx` reads `role` from `useAuth()` but **does not check `loading`**. On any hard refresh of a guarded route (`/deals`, `/admin/*`, `/contacts/*`), `role` is `null` for ~50–300 ms while `applySessionState` fetches it. During that window the guard does `<Navigate to="/dashboard" replace />`, the dashboard mounts and starts fetching, then `role` resolves and React Router pushes the user back to the original route. Visible as a dashboard flash → snap to target page.

### 2. `Index.tsx` redirect flash
`/` always mounts a spinner and then `navigate('/dashboard' | '/auth')`. Any link/refresh that lands on `/` produces a white spinner flash before navigation. Should redirect declaratively with `<Navigate>` so React Router replaces synchronously.

### 3. `AppLayout` full-screen loading state replaces the whole shell
`AppLayout` returns a full-screen `<Loader2/>` while `loading || !role`. The shell (sidebar + header + tab bar) unmounts on every auth event that flips loading (token refresh, focus). Even on initial load the entire chrome paints once empty, then re-paints with content.

### 4. `useFormPermissions` re-fetches on every consumer mount
13 files call `useFormPermissions()`; each one issues its own Supabase query on mount. Navigating between a contact list and a contact detail re-runs the query, the detail layout flips between `permissionsLoading=true` (disabled fields) and `false` (enabled fields) — visible as inputs flickering from greyed to active.

### 5. Page-level "replace everything with a spinner" pattern
`Dashboard`, all 6 contact list pages, and several CSR pages render `<Loader2 .../> Loading…` that fills the content area, then swap to the grid. Causes layout jump + white flash on every navigation.

Secondary contributors (smaller impact, fixed by same patterns):
- No scroll reset between routes → perceived "jump" on long pages.
- `AppLayout` unmounts/remounts because `AuthProvider` re-runs `applySessionState` on every `onAuthStateChange` event (including TOKEN_REFRESHED), briefly toggling `loading`.

## Fixes

### A. Guard waits for auth to resolve
`RoleGuard.tsx`:
```tsx
const { role, loading, isExternalUser } = useAuth();
if (loading || role === null) {
  return <Outlet context={{ authPending: true }} />; // or render a stable skeleton wrapper
}
```
Render the matched route's skeleton instead of redirecting while `loading` is true. Only redirect once auth has settled.

### B. Declarative root redirect
Replace `Index.tsx` body with:
```tsx
if (loading) return null; // shell already painted by parent
return <Navigate to={user ? '/dashboard' : '/auth'} replace />;
```
Remove the spinner page entirely.

### C. Stable layout shell
In `AppLayout`:
- Keep sidebar + header + tab bar mounted always.
- Replace the full-screen spinner with an inline skeleton **inside `<main>`** when `loading`.
- Treat `TOKEN_REFRESHED` in `AuthContext` as a no-op for `loading` (don't flip to true on silent refreshes).

`AuthContext.tsx`:
- Set `loading=false` only on the **first** resolution; subsequent `onAuthStateChange` events should update session/role without re-toggling `loading`.
- Skip `applySessionState` and role re-fetch when the incoming `authSession.user.id` matches the current user.

### D. Hoist permissions into a provider
Add `FormPermissionsProvider` (single fetch per session) at `AppLayout` level. Replace the existing `useFormPermissions` hook body to read from context. Sub-layouts (lender/broker/borrower/deal) consume cached values — no per-mount query. This removes the disabled→enabled input flicker on every contact open.

### E. Skeleton loaders instead of full-screen spinners
For each list/detail page (Dashboard, ContactLendersPage, ContactBorrowersPage, ContactBrokersPage, ContactCoBorrowersPage, ContactAuthorizedPartiesPage, ContactAdditionalGuarantorsPage, DealOverviewPage):
- Keep the page chrome (title, toolbar, table header) rendered immediately.
- Render a `<Skeleton>` grid (e.g. 8 grey rows) inside the table body while `loading` is true.
- Never replace the entire screen with `<Loader2/>`.

### F. Scroll restoration
Add a small `ScrollToTop` component (resets `window.scrollTo(0,0)` on `pathname` change) mounted inside `<BrowserRouter>` in `App.tsx`. Eliminates "jump from middle of page to top" perception on cross-page navigation.

### G. Minor stabilizations
- In `WorkspaceFileRenderer`, keys are already stable — no change.
- Ensure `QueryClient` `staleTime` is set (e.g. 30 s) so revisits within a session don't refetch and re-paint.

## Out of Scope (deliberate)
- No refactor of `deal_section_values` schema, RLS, or business logic.
- No changes to grid libraries / virtualization.
- No new design tokens.
- No removal of realtime channels (covered in a separate audit).

## Files Touched
- `src/components/layout/RoleGuard.tsx` — wait for auth.
- `src/pages/Index.tsx` — declarative redirect.
- `src/components/layout/AppLayout.tsx` — inline skeleton, stable shell.
- `src/contexts/AuthContext.tsx` — idempotent session updates; one-shot `loading`.
- `src/contexts/FormPermissionsContext.tsx` — **new**, provider + cached hook.
- `src/hooks/useFormPermissions.ts` — re-export hook backed by context.
- `src/components/ScrollToTop.tsx` — **new**.
- `src/App.tsx` — mount `ScrollToTop`, configure `QueryClient` `staleTime`.
- Each affected page (Dashboard + 6 contact lists + DealOverviewPage) — swap full-screen spinner for skeleton-in-place.

## Validation Checklist (manual QA)
1. Hard-refresh `/admin/field-maps` while signed-in → no dashboard flash.
2. Hard-refresh `/contacts/lenders/<id>` → form fields don't flicker disabled→enabled.
3. Navigate `Lenders → Borrowers → Deals → back` repeatedly → sidebar/header never blank.
4. Open/close a contact detail tab → no white flash in workspace area.
5. Refresh on a long scrolled page → returns to top, no mid-page paint.
6. Slow-network (DevTools throttle "Slow 3G") → skeleton rows visible; no empty screens.

## Expected Outcome
- No dashboard-bounce on guarded routes.
- Sidebar/header persist across all navigations.
- Permissions-driven fields stay stable on contact opens.
- List/detail screens show skeletons instead of full-screen spinners.
- Smooth, enterprise-grade transitions on both fresh loads and in-session navigation.
