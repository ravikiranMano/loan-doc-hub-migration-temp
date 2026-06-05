# Code Review & Migration Analysis — Report 2

**Project:** Loan Doc Hub
**Branch:** migration_v1_851ae
**Date:** 2026-06-06
**Reviewer:** Claude Code (Second Independent Multi-Agent Review)
**Note:** This is an independent second-pass review with deeper file reads. Cross-reference with report.md for full picture.

---

## Executive Summary

The Loan Doc Hub codebase is mid-migration from Supabase-hosted auth/realtime to a custom NestJS JWT stack. The Supabase frontend client (`src/services/supabase/`) has been removed and replaced with a NestJS API layer. Backend auth (JWT issuance, refresh token rotation, guards) is fully implemented. However, the migration is incomplete in several consequential ways: the Supabase service role key is still consumed in the backend for storage proxying and docxtemplater downloads, a legacy Supabase token fallback path remains active with no kill switch, the edge function `generate-document` still exists alongside the NestJS `documents` module, and the `RolesGuard` file is entirely absent despite the `@Roles()` decorator being defined and used.

The most severe security findings center on authorization gaps rather than authentication. `JwtAuthGuard` is not registered globally, meaning every controller must opt in — and the `AdminModule`, `SystemModule`, `StorageModule`, `DealsModule`, `ContactsModule`, `DocumentsModule`, and `GenerationModule` rely on manually applied guards. Three SSE endpoints are decorated `@Public` with no authentication, no connection cap, and DB polling every 3 seconds per open connection. `RolesGuard` does not exist as a file, making all `@Roles()` decorators silently non-functional. The `NotesTableView` component renders unsanitized HTML from the database via `dangerouslySetInnerHTML` with no DOMPurify, and the magic link session token is stored in `localStorage` as plaintext.

On the positive side, the httpOnly cookie-based access token architecture is correctly implemented with refresh token rotation and SHA-256 hashing at rest. The frontend has eliminated all Supabase JS client imports. The NestJS pipeline applies `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true` globally, and Helmet with HSTS is enabled. The refresh token coalescing pattern on the frontend (`isRefreshing` flag) is correctly implemented to prevent token storm on concurrent 401s.

---

### Readiness Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Overall | 4/10 | Critical auth/authz gaps block production use |
| Frontend | 5/10 | Supabase client removed; XSS and RoleGuard logic bugs remain |
| Backend | 4/10 | JWT infrastructure sound; no global auth guard; RolesGuard missing |
| Migration Completeness | 6/10 | Frontend fully migrated; backend still uses Supabase for storage/edge |
| Security | 3/10 | Multiple high/critical issues across auth, authorization, and XSS |

---

## Critical Issues

> These must be resolved before any production traffic.

### C1: RolesGuard file does not exist — all @Roles() decorators are silently ignored
- **File:** `backend/src/common/guards/roles.guard.ts` (missing)
- **Severity:** Critical
- **Evidence:** Agent analysis: "RolesGuard file does not exist at the declared path. The Roles decorator is defined but the enforcing guard is absent — role-based access control is entirely non-functional. Any route decorated with @Roles() will silently pass without enforcement."
- **Description:** The `@Roles()` decorator is defined and applied to routes across the application. The guard that reads this metadata and enforces it has never been created. Every protected route that relies on role checking passes unconditionally for any authenticated user.
- **Risk:** Any authenticated user (any role) can access routes intended only for admins or specific roles. Role escalation requires only a valid JWT.
- **Fix:** Create `backend/src/common/guards/roles.guard.ts` implementing `CanActivate`, reading `ROLES_KEY` metadata via `Reflector`, and checking `request.user.role` against the allowed roles. Register it as `APP_GUARD` in `AppModule` alongside `JwtAuthGuard`.

---

### C2: JwtAuthGuard is not a global guard — unauthenticated routes exist by omission
- **File:** `backend/src/app.module.ts:44`
- **Severity:** Critical
- **Evidence:** `providers: [ AppService, { provide: APP_GUARD, useClass: ThrottlerGuard } ]` — only `ThrottlerGuard` is global. Agent analysis: "A single forgotten @UseGuards on any route in these modules creates an unauthenticated endpoint."
- **Description:** Every controller in `AdminModule`, `ContactsModule`, `DocumentsModule`, `DealsModule`, `StorageModule`, `GenerationModule`, and `SystemModule` must manually apply `@UseGuards(JwtAuthGuard)`. No compile-time or runtime enforcement ensures this is done.
- **Risk:** Any route where a developer forgot `@UseGuards` is publicly accessible with no authentication required.
- **Fix:** Add `{ provide: APP_GUARD, useClass: JwtAuthGuard }` to the global providers array in `AppModule`. Add `@Public()` decorator to routes that intentionally bypass auth (`/auth/login`, `/auth/register`, `/auth/refresh`, SSE endpoints after they are secured).

---

### C3: RoleGuard renders protected content when role is null — null-role users bypass all role checks
- **File:** `src/components/layout/RoleGuard.tsx:16`
- **Severity:** Critical
- **Evidence:** Agent analysis: "The condition `if (loading || role === null)` conflates two distinct states: (a) auth is genuinely loading and (b) auth has resolved but the user has no role. A newly registered user whose role field is null will never be redirected — they pass every RoleGuard indefinitely because the guard treats `role === null` as 'still loading'."
- **Description:** The guard returns `<Outlet />` for both the loading state and the resolved-but-null-role state. A user who successfully authenticates but has no assigned role sees all protected routes.
- **Risk:** Privilege escalation for any user whose role is null or has been cleared. Newly registered users before role assignment can access admin routes.
- **Fix:** Split the states. During loading, show a spinner. If loading is complete and role is null, redirect to `/auth` or an `/unauthorized` page. Only render `<Outlet />` when loading is false AND role is non-null AND role is in the allowed set.

---

### C4: validateMagicLink — participant status update is fire-and-forget (not awaited)
- **File:** `backend/src/modules/deals/deals.service.ts:476`
- **Severity:** Critical
- **Evidence:** Agent analysis: "`this.prisma.deal_participants.update({...})` is called without await — the status transition to 'in_progress' may not be persisted before the response is returned, creating a race condition."
- **Description:** The deal participant status update (`status: 'in_progress'`) inside `validateMagicLink` is not awaited. The function returns a response before the DB write completes. A second call to `validateMagicLink` for the same participant can see the old status.
- **Risk:** Race condition in magic link validation. Status transitions are unreliable. Business logic dependent on participant status (gating completion, sending notifications) may execute incorrectly.
- **Fix:** Add `await` to `this.prisma.deal_participants.update({...})`. Review the same function for the fire-and-forget `activity_log.create` call at line 481 (lower severity but same pattern).

---

### C5: validateMagicLink — sessionToken is never stored and provides no security
- **File:** `backend/src/modules/deals/deals.service.ts:500`
- **Severity:** Critical
- **Evidence:** Agent analysis: "sessionToken is a random UUID generated by the server but never stored — it is returned to the client but cannot be verified on subsequent requests; it provides no real session security."
- **Description:** `validateMagicLink` generates a `sessionToken` (random UUID), returns it to the client, and stores it nowhere. The client stores this in `localStorage` and presumably sends it on future requests, but the server has no record to verify it against.
- **Risk:** The magic link session is entirely unauthenticated after the initial token validation. Any value can be sent as `sessionToken` and will be accepted by any endpoint that trusts it. The session provides no real authorization boundary.
- **Fix:** Store the `sessionToken` hash in the `magic_links` or a new `magic_link_sessions` table on creation. On subsequent requests, look up and validate the hash. Expire the session server-side at the link's `expires_at` time.

---

### C6: POST /api/deals/:id/participants/:pid/complete is @Public — unauthenticated completion
- **File:** `backend/src/modules/deals/deals.controller.ts` (completeParticipantSection route)
- **Severity:** Critical
- **Evidence:** Agent analysis: "Unauthenticated endpoint; any caller who guesses a participantId+dealId pair can mark the participant 'completed' and trigger notification emails. No rate limiting — can be used to flood the notification email to the CSR."
- **Description:** The participant completion endpoint has `@Public()` and no rate limiting. A participant ID and deal ID are both UUIDs, but they are stored in invite emails and magic links, making them guessable in practice.
- **Risk:** An attacker who obtains a participant ID can mark sections complete, trigger CSR notification emails in bulk, and corrupt deal workflow state without any authentication.
- **Fix:** Require authentication via magic link session token at minimum. Add `@Throttle({ default: { limit: 5, ttl: 60_000 } })`. Validate that the magic link session matches the participant being completed.

---

### C7: NotesTableView — unsanitized dangerouslySetInnerHTML from database content
- **File:** `src/components/deal/NotesTableView.tsx:424`
- **Severity:** Critical
- **Evidence:** `dangerouslySetInnerHTML={{ __html: viewingNote.content }}` — agent analysis: "Note content is user-supplied rich text (likely from a WYSIWYG editor). A stored XSS payload (e.g. `<img src=x onerror=alert(1)>` or `<script>`) inserted by any user with note-write access will execute in every CSR's browser when they view that note."
- **Description:** Raw HTML from the `notes` database column is injected directly into the DOM. Any user who can write a note can execute arbitrary JavaScript in the CSR's browser context.
- **Risk:** Stored XSS. An attacker with note-write access can steal session cookies (though httpOnly mitigates cookie theft), exfiltrate deal data visible to the CSR, or perform actions as the CSR. All CSR users who view the note are affected.
- **Fix:** Install `dompurify` and `@types/dompurify`. Replace the render with: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewingNote.content) }}`.

---

## High-Priority Issues

### H1: Supabase legacy JWT fallback is always active with no kill switch
- **File:** `backend/src/common/helpers/access-token.verify.ts:97`
- **Severity:** High
- **Evidence:** The catch block swallows all NestJS verification errors and falls through to Supabase HS256 verification unconditionally. There is no feature flag to disable this path in production and no log when the fallback fires.
- **Description:** A token that fails NestJS verification for any reason (wrong secret, wrong algorithm, expired, malformed) is silently retried against the Supabase HS256 secret.
- **Risk:** A crafted token that fails Nest verification but passes Supabase verification with elevated claims gains full access.
- **Fix:** Add a config flag `auth.legacyFallbackEnabled` defaulting to `false` in production. Gate the fallback block on this flag. Add a structured log line whenever the fallback is used. Set a removal deadline.

---

### H2: Supabase legacy HS256 fallback has no issuer or audience validation
- **File:** `backend/src/common/helpers/access-token.verify.ts:84`
- **Severity:** High
- **Evidence:** `const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;` — no `issuer` or `audience` options passed.
- **Description:** The JWKS path validates `issuer` and `audience` (lines 72-74), but the legacy HS256 fallback path does not. Any HS256 token signed with the Supabase JWT secret passes regardless of its claims.
- **Fix:** `jwt.verify(token, jwtSecret, { algorithms: ['HS256'], issuer: '${base}/auth/v1', audience: 'authenticated' })`

---

### H3: Refresh token family revocation is incomplete
- **File:** `backend/src/modules/auth/auth.service.ts:72`
- **Severity:** High
- **Evidence:** When a revoked token is presented, the code throws `UnauthorizedException` but does not revoke the entire token family (the `replaced_by` chain). The attacker's replacement token derived from the stolen token remains valid.
- **Description:** Token theft is not detected and remediated automatically. A stolen refresh token gives an attacker persistent access even after the legitimate user triggers a refresh.
- **Fix:** When `record.revoked_at` is set, call `revokeAllUserRefreshTokens(record.user_id)` to invalidate the entire session family. Log a security alert with the user ID and IP.

---

### H4: Refresh token rotation is not atomic
- **File:** `backend/src/modules/auth/auth.service.ts:113`
- **Severity:** High
- **Evidence:** `const tokens = await this.issueTokens(user, meta); await this.repo.revokeRefreshToken(record.id, tokens.refreshTokenId);` — new token created before old token revoked; no transaction wrapping.
- **Description:** If the DB write for `revokeRefreshToken` fails after `issueTokens` succeeds, two valid refresh token families exist simultaneously for the same user.
- **Fix:** Wrap both operations in a Prisma transaction: `await this.prisma.$transaction([createRefreshToken(...), revokeRefreshToken(...)])`.

---

### H5: All three SSE endpoints are @Public with no connection cap and DB polling
- **File:** `backend/src/modules/deals/deals.controller.ts` (SSE route decorators)
- **Severity:** High
- **Evidence:** All three SSE endpoints are decorated `@Public` — no authentication or authorization required to open a stream. No connection cap: every browser tab or automated client opens a permanent HTTP connection and an independent `setInterval` that fires a DB query every 3 seconds. Under 100 concurrent connections this is 100 DB COUNT queries every 3 seconds per endpoint — potentially 300 queries/s across all three endpoints.
- **Routes affected:** `GET /api/deals/events`, `GET /api/deals/:id/participants/events`, `GET /api/deals/:id/documents/events`
- **Risk:** DoS via connection exhaustion. Any unauthenticated client can open unlimited connections, saturate DB connection pool, and bring down the application.
- **Fix:** (1) Require authentication (remove `@Public()`, require valid JWT or magic link session). (2) Add a server-side connection cap using a shared counter. (3) Replace polling with Postgres `LISTEN/NOTIFY`. (4) Add `@Throttle` on SSE connection establishment.

---

### H6: POST /api/deals/participants/:pid/magic-links — mass assignment via body spread
- **File:** `backend/src/modules/deals/deals.service.ts` (createMagicLink)
- **Severity:** High
- **Evidence:** Agent analysis: "body is typed as `Record<string,unknown>` — no validation; caller can inject arbitrary columns including token, expires_at, max_uses. createMagicLink passes body spread directly into repository: `{ deal_participant_id, created_by, ...body }` — mass-assignment on magic_links table."
- **Description:** The request body is spread directly into the DB insert for `magic_links`. A caller can override `token`, `expires_at`, `max_uses`, `revoked_at`, and any other column.
- **Fix:** Create a `CreateMagicLinkDto` with only the allowed fields. Compute `token`, `expires_at`, and `max_uses` server-side from system settings.

---

### H7: createDeal — created_by can be forged by the caller
- **File:** `backend/src/modules/deals/deals.service.ts:64`
- **Severity:** High
- **Evidence:** Agent analysis: "`dto.created_by || user?.sub` — A caller can forge any created_by UUID by providing it in the body."
- **Description:** The `created_by` field is accepted from the client DTO and only falls back to `user?.sub` if the field is falsy. An authenticated caller can attribute any deal to any user ID.
- **Fix:** Always use `user.sub` for `created_by`. Remove `created_by` from `CreateDealDto` entirely.

---

### H8: inviteParticipant — HTML injection in email body (stored XSS in email)
- **File:** `backend/src/modules/deals/deals.service.ts:329`
- **Severity:** High
- **Evidence:** Agent analysis: "`recipientName` and `roleDisplay` are interpolated directly into HTML without escaping — if name or role contains HTML characters it will be injected into the email body."
- **Description:** Participant name and role are read from the DB and interpolated into a raw HTML email template string without HTML-encoding.
- **Fix:** HTML-encode all user-supplied values before interpolation using a simple `escapeHtml` utility or a templating library.

---

### H9: DealDocumentsPage — DOCX-to-HTML print path injects unsanitized mammoth output
- **File:** `src/pages/csr/DealDocumentsPage.tsx:733`
- **Severity:** High
- **Evidence:** Agent analysis: "`result.value` from mammoth is injected raw into the popup via `document.write`. Mammoth converts Word content faithfully, which can include arbitrary HTML from the DOCX."
- **Description:** Mammoth's HTML output is written directly into a print popup window via `document.write` with no sanitization. A DOCX with embedded HTML/script in its content will execute in the popup.
- **Fix:** Pass `result.value` through `DOMPurify.sanitize(result.value)` before the `document.write` call.

---

### H10: DealDocumentsPage — handlePrintDocument embeds unsanitized fileName in HTML
- **File:** `src/pages/csr/DealDocumentsPage.tsx:659`
- **Severity:** High
- **Evidence:** Agent analysis: "`html` contains `${fileName}`, which is derived from `doc.template_name` after regex sanitisation. If sanitisation is incomplete, a crafted template name could inject script into the print window."
- **Description:** `fileName` sourced from `doc.template_name` is embedded into a raw HTML string written to a popup.
- **Fix:** Use `encodeURIComponent(fileName)` for URL contexts, or assign the filename via `document.createTextNode` / `textContent` instead of raw HTML interpolation.

---

### H11: docxtemplater angular-expression parser evaluates arbitrary JS expressions
- **File:** `backend/src/modules/documents/docxtemplater.service.ts:116`
- **Severity:** High
- **Evidence:** Agent analysis: "renderDocx() passes the data object from TemplateFieldData.data directly to `doc.render()` with the angular-expression parser enabled. If any field value stored in the database contains a crafted expression, it will be evaluated during rendering."
- **Description:** Docxtemplater's angular-parse mode evaluates arbitrary JavaScript-like expressions inside `{{}}` tags at render time. A deal field value containing `{{ constructor.constructor('process.exit(1)')() }}` executes during DOCX rendering inside the NestJS process.
- **Risk:** Remote code execution via stored field values.
- **Fix:** Disable the angular-expression parser unless explicitly required. Use the default docxtemplater parser which does not evaluate expressions. If expressions are needed, run rendering in a sandboxed child process.

---

### H12: generateDocumentEdge — service role key sent to unconstrained fetch with no timeout
- **File:** `backend/src/modules/documents/documents.service.ts:304`
- **Severity:** High
- **Evidence:** Agent analysis: "`generateDocumentEdge()` and `previewDocumentPayload()` (line 443) make raw `fetch()` calls to `${supabaseUrl}/functions/v1/generate-document` with the service role key in the Authorization header. There is no timeout (AbortSignal)."
- **Description:** The Supabase service role key is sent as a Bearer token to an external HTTP endpoint constructed from an env var. If `SUPABASE_URL` is misconfigured or an SSRF is achieved, the key leaks.
- **Fix:** Add an `AbortSignal.timeout(30000)` to the fetch call. Validate that `supabaseUrl` starts with the expected domain before making the call.

---

### H13: Storage — signed URL expiry is fully caller-controlled with no server cap
- **File:** `backend/src/modules/storage/storage.controller.ts:85`
- **Severity:** High
- **Evidence:** Agent analysis: "Signed URL expiry is fully caller-controlled via the `?expires=` query param with no server-side cap; a caller can request expiry of millions of seconds."
- **Fix:** Cap the expiry at a server-defined maximum: `const expiry = Math.min(parseInt(req.query.expires) || 3600, MAX_SIGNED_URL_EXPIRY)`.

---

### H14: Storage — no file type or MIME validation on upload
- **File:** `backend/src/modules/storage/storage.controller.ts:32`
- **Severity:** High
- **Evidence:** Agent analysis: "No file MIME-type or extension allowlist — any content type is forwarded to Supabase Storage verbatim."
- **Fix:** Add a multer `fileFilter` that enforces an allowlist of MIME types. Reject anything not on the list with a 400.

---

### H15: Storage — upload path has no traversal sanitization
- **File:** `backend/src/modules/storage/storage.controller.ts:43`
- **Severity:** High
- **Evidence:** Agent analysis: "Upload path parameter is passed directly to Supabase with no path traversal check (e.g. `'../'`, absolute paths, or null bytes)."
- **Fix:** Sanitize the path parameter: remove leading slashes, reject `..` path components, and normalize the path before passing to Supabase Storage.

---

### H16: Admin and System routes lack role enforcement — any authenticated user has admin access
- **File:** `backend/src/modules/admin/admin.controller.ts`, `backend/src/modules/system/system.controller.ts`
- **Severity:** High
- **Evidence:** Agent analysis lists 26 admin routes all with `current_guard: "JwtAuthGuard only"`. System mutation routes `POST /api/system/settings`, `PATCH /api/system/settings/:key`, `DELETE /api/system/settings/:key` have no role check.
- **Description:** Without `RolesGuard` (which does not exist — see C1), any authenticated user can delete fields, assign roles to any user, modify system settings, and view all user data.
- **Fix:** Once `RolesGuard` is implemented (C1 fix), apply `@Roles('admin')` to the `AdminController` class decorator and to system mutation routes.

---

### H17: listSectionsForDeals and listLoanHistoryByDealIds crash on missing dealIds param
- **File:** `backend/src/modules/deals/deals.controller.ts:105,131`
- **Severity:** High
- **Evidence:** Agent analysis: "If dealIds query param is absent, `dealIds.split(',')` throws TypeError: Cannot read properties of undefined — unhandled crash."
- **Fix:** Add a guard: `if (!dealIds) throw new BadRequestException('dealIds query param is required');`. Add `@IsString()` validation on the query DTO.

---

### H18: Password has no MaxLength — bcrypt silently truncates at 72 bytes
- **File:** `backend/src/modules/auth/dto/auth.dto.ts:26`
- **Severity:** High
- **Evidence:** Agent analysis: "bcrypt silently truncates passwords longer than 72 bytes. Also opens a DoS vector: sending a 1MB password causes bcrypt to process 72 bytes but the server must still receive and parse the full body."
- **Fix:** Add `@MaxLength(72)` to `password` in both `RegisterDto` and `LoginDto`.

---

### H19: generateSecureToken uses crypto.randomUUID (not randomBytes)
- **File:** `backend/src/modules/auth/auth.service.ts:170`
- **Severity:** High
- **Evidence:** `const a = crypto.randomUUID().replace(/-/g, ''); const b = crypto.randomUUID().replace(/-/g, ''); return \`${a}${b}\`;` — agent analysis: "2x UUID produces only 244 bits of entropy total — not 64 bytes as the comment claims. Also relies on the global `crypto` without an explicit import."
- **Fix:** `import { randomBytes } from 'crypto';` and replace the function body with `return randomBytes(64).toString('hex');`.

---

### H20: refresh() does not guard against missing rawToken — crashes with TypeError instead of 401
- **File:** `backend/src/modules/auth/auth.service.ts:68`
- **Severity:** High
- **Evidence:** Agent analysis: "If rawToken is undefined (cookie absent), `hashToken(undefined)` will call `createHash('sha256').update(undefined)` which throws a TypeError in Node — unhandled, this will crash the request with a 500 instead of a clean 401."
- **Fix:** Add at the top of `refresh()`: `if (!rawToken) throw new UnauthorizedException('No refresh token provided');`

---

### H21: Magic link session stored in localStorage — XSS accessible bearer credential
- **File:** `src/lib/magicLink.ts:73`
- **Severity:** High
- **Evidence:** Agent analysis: "Magic link session stored in localStorage is accessible to any same-origin JavaScript (XSS vector). The sessionToken inside is effectively a bearer credential."
- **Fix:** Move the magic link session to `sessionStorage` as a minimum improvement. Ideally, issue a short-lived httpOnly cookie from the server upon magic link validation instead.

---

### H22: Magic link client-side session expiry hardcoded to 4 hours, independent of server expiry
- **File:** `src/pages/MagicLinkAccessPage.tsx:48`
- **Severity:** High
- **Evidence:** Agent analysis: "Session expiry is hardcoded client-side to exactly 4 hours (`Date.now() + 4 * 60 * 60 * 1000`) regardless of the server-issued token's actual expiry. The backend default expiry is 72 hours from system settings."
- **Fix:** Return the actual `expires_at` timestamp from the `validateMagicLink` response and use it to set `expiresAt` in the stored session.

---

### H23: Backend source maps emitted in production build
- **File:** `backend/tsconfig.json` (`sourceMap: true`)
- **Severity:** High
- **Evidence:** Agent analysis: "Backend tsconfig.json has `sourceMap: true` with no production override — `nest build` compiles with source maps enabled, exposing `.map` files in `dist/` which reveal original TypeScript source in production deployments."
- **Fix:** Add a `tsconfig.prod.json` with `"compilerOptions": { "sourceMap": false }` and use it in the production build script.

---

## Migration Gaps

### Remaining Supabase Dependencies

| File | Layer | Description | Status |
|------|-------|-------------|--------|
| `backend/src/modules/storage/storage.service.ts` | Backend | Uses `@supabase/supabase-js` with service role key to proxy file operations | Intentional (no NestJS storage replacement yet) |
| `backend/src/modules/documents/docxtemplater.service.ts:89` | Backend | `createClient(supabaseUrl, serviceRoleKey)` called on every `downloadTemplate()` invocation | Intentional but needs refactoring to singleton |
| `backend/src/modules/documents/documents.service.ts:304` | Backend | `fetch()` to Supabase edge function `generate-document` with service role key | Intentional (edge fallback route) |
| `backend/src/modules/documents/documents.service.ts:443` | Backend | `previewDocumentPayload()` also calls edge function with service role key | Intentional (edge fallback route) |
| `supabase/functions/generate-document/index.ts` | Supabase Edge | Full document generation edge function still exists | Superseded — NestJS `docxtemplater.service.ts` is the replacement |
| `supabase/functions/_shared/field-resolver.ts` | Supabase Edge | Field resolution logic | Superseded — `backend/src/modules/documents/deal-field-values.loader.ts` |
| `supabase/functions/_shared/docx-processor.ts` | Supabase Edge | DOCX processing | Superseded — `backend/src/modules/generation/utils/docx-processor.util.ts` |
| `supabase/functions/_shared/tag-parser.ts` | Supabase Edge | Tag parsing | Superseded — `backend/src/modules/generation/utils/tag-parser.util.ts` |
| `supabase/functions/_shared/formatting.ts` | Supabase Edge | Formatting utilities | Superseded — logic absorbed into backend |
| `supabase/functions/_shared/types.ts` | Supabase Edge | Type definitions | Superseded — types duplicated in backend DTOs |
| `backend/src/common/helpers/access-token.verify.ts:84` | Backend | Legacy Supabase HS256 JWT fallback path | Intentional (migration window) — needs kill switch |
| `backend/src/common/helpers/access-token.verify.ts:61` | Backend | `createRemoteJWKSet` pointing to Supabase JWKS endpoint | Intentional (legacy token verification) |
| `SUPABASE_SERVICE_ROLE_KEY` env var | Config | Required by storage, docxtemplater, and edge function calls | Intentional — Supabase storage still in use |
| `SUPABASE_URL` env var | Config | Required by storage, JWKS endpoint, edge function URL | Intentional |
| `@supabase/supabase-js` in `backend/package.json` | Backend | SDK as prod dependency | Intentional (storage + legacy auth) |

### Dead Supabase Files

| File | Status |
|------|--------|
| `src/services/supabase/` (entire directory) | Confirmed removed per `src/services/README.md` |
| `src/services/README.md:26` | Documents removal: "The `src/services/supabase/` folder has been removed. All data access goes through the NestJS backend." |

### Outstanding Migration Tasks

1. Replace Supabase Storage with a self-hosted or alternative storage backend, OR keep it intentionally and document it as a permanent dependency.
2. Delete the `supabase/functions/generate-document/` edge function and all `_shared/` utilities once the NestJS `generate-api` and `generate-v2` routes are verified equivalent.
3. Remove the Supabase JWT fallback path in `access-token.verify.ts` once all tokens in circulation are NestJS-issued. Add a hard deadline and a feature flag (see H1).
4. Refactor `docxtemplater.service.ts:89` to create the Supabase client once as a module-level singleton rather than per-request.
5. Move `createRemoteJWKSet` in `access-token.verify.ts` outside the function to a module-level singleton so the JWKS cache persists across requests.
6. Implement `RolesGuard` (C1) and register `JwtAuthGuard` globally (C2) before any production traffic.
7. Implement a cron job to call `authRepository.deleteExpiredRefreshTokens()` (see `backend/src/modules/auth/auth.repository.ts:94`).

---

## Technical Debt

| File | Function | Line | Issue | Fix |
|------|----------|------|-------|-----|
| `backend/src/modules/auth/auth.module.ts` | JwtModule config | 19 | `expiresIn` cast as `unknown as number` when the type is `string` | Remove the cast: `expiresIn: config.get<string>('jwt.expiresIn', '1h')` |
| `backend/src/modules/auth/auth.module.ts` | JwtModule config | 17 | No `issuer`, `audience`, or `algorithm` in `signOptions` | Add `algorithm: 'HS256'`, `issuer`, and `audience` to both `signOptions` and `verifyOptions` |
| `backend/src/modules/auth/strategies/jwt.strategy.ts` | JwtStrategy | 9 | `JwtStrategy` exists but `JwtAuthGuard` calls `resolveUserFromRequest()` directly — strategy is never invoked | Either remove `JwtStrategy` entirely or refactor `JwtAuthGuard` to extend `AuthGuard('jwt')` |
| `backend/src/modules/auth/dto/auth.dto.ts` | LoginDto | 27 | `@MinLength(8)` on `LoginDto.password` leaks policy and locks out legacy accounts | Remove `@MinLength` from `LoginDto.password`; keep only `@IsString()` and `@MaxLength(72)` |
| `backend/src/modules/auth/dto/auth.dto.ts` | RegisterDto | 19 | No `@MaxLength(254)` on email; no `@Transform` for normalization at DTO layer | Add `@MaxLength(254)` and `@Transform(({ value }) => value?.toLowerCase().trim())` |
| `backend/src/modules/auth/dto/auth.dto.ts` | UpdateMeDto | 52 | No `@MaxLength` on `full_name`, `phone`, `company`, `license_number` | Add `@MaxLength(255)` for `full_name`/`company`, `@MaxLength(50)` for `phone`, `@MaxLength(100)` for `license_number` |
| `backend/src/modules/auth/auth.repository.ts` | deleteExpiredRefreshTokens | 94 | Function defined but never called — `refresh_tokens` table grows without bound | Register a `@Cron('0 3 * * *')` job in a `CleanupService` |
| `backend/src/modules/auth/auth.service.ts` | formatUser | 180 | Returns `license_number`, `phone`, `company` on every auth response including login/register | Return minimal payload on auth endpoints; keep full profile for `GET /auth/me` only |
| `backend/src/modules/auth/auth.controller.ts` | login | 33 | `ThrottlerGuard` executes after `LocalAuthGuard` — bcrypt runs before throttle check | Add `ThrottlerGuard` before `LocalAuthGuard` in the guard chain |
| `backend/src/modules/auth/auth.controller.ts` | IP extraction | 88 | Manual `x-forwarded-for` parsing without trust proxy config — spoofable | Set `app.set('trust proxy', 1)` in `main.ts` and use `req.ip` directly |
| `backend/src/main.ts` | body limit | 26 | `10mb` body limit on all routes including auth endpoints | Apply auth route-specific limit of 1 KB using route-level middleware |
| `backend/src/main.ts` | CORS fallback | 59 | Falls back to `http://localhost:8080` if `CORS_ORIGIN` is unset | Use `configService.getOrThrow<string>('app.corsOrigin')` in production |
| `backend/src/modules/deals/deals.service.ts` | cloneDeal | 686 | `generateContactIdRpc` called in a `for...of` loop — O(n) sequential DB round-trips inside a transaction | Batch the sequence generation into a single RPC call or use `Promise.all` |
| `backend/src/modules/deals/deals.service.ts` | cloneDeal | 558 | `notes` field is copied despite JSDoc claiming notes are excluded | Remove `notes: src.notes` from the clone payload or update the JSDoc |
| `backend/src/modules/deals/deals.service.ts` | updateLoanHistory | 205 | Missing existence check — Prisma P2025 becomes a 500 | Check existence first and throw `NotFoundException` |
| `backend/src/modules/deals/deals.service.ts` | validateMagicLink | 483 | `actor_user_id` in `activity_log` is set to `participant_id` (a `deal_participants` UUID), not a `users` UUID | Correct attribution: use `participant.user_id` or null |
| `backend/src/modules/deals/deals.service.ts` | completeParticipantSection | 390 | `actorId` falls back to `participant.deals.created_by` when `user_id` is null — attributes participant action to deal creator | Use `null` or an explicit system actor ID for unauthenticated participant actions |
| `backend/src/modules/deals/deals.service.ts` | completeParticipantSection | 437 | Hardcoded `https://api.resend.com/emails` and sender `noreply@resend.dev` | Move to config; use `RESEND_API_KEY` env var and a configurable sender address |
| `backend/src/modules/deals/deals.controller.ts` | listDeals | 58 | `parseInt(page)` and `parseInt(limit)` produce `NaN` for non-numeric strings — passed to repo as `NaN` | Validate with `@IsInt()` / `@IsPositive()` in a query DTO; use `ParseIntPipe` |
| `backend/src/modules/documents/docxtemplater.service.ts` | downloadTemplate | 89 | `createClient()` called on every invocation — new Supabase client per request | Move client creation to constructor or module-level singleton |
| `backend/src/modules/generation/generation.service.ts` | generate | 126 | `field_dictionary.findMany()` with no `where` clause — full table materialized on every uncached call | Add a `select: { field_key: true }` projection and cache the Set at module level |
| `src/hooks/useDealFields.ts` | multiple | 46–1190 | 18 uses of `any` type — masks runtime errors and prevents type checking | Replace with proper interfaces derived from API response types |
| `src/hooks/useDealFields.ts` | saveDraft | 1107 | Sequential `for...of` loop issuing one HTTP PATCH per section row | Replace with `Promise.all(updates.map(({ id, payload }) => updateSectionValueById(id, payload)))` |
| `src/hooks/useDealFields.ts` | removeValuesByPrefix | 695 | Typed as returning `void` but implementation is `async` | Update interface to `(prefix: string) => Promise<void>` and await at call sites |
| `src/hooks/useDealFields.ts` | removeValuesByPrefix | 698 | Reads stale `values` closure — `values` not in `useCallback` deps | Add `values` to `useCallback` dependency array or read via `valuesRef.current` |
| `src/hooks/useDealFields.ts` | fetchData | 342 | Called in `useEffect` without AbortController — setState on unmounted component | Add `AbortController`; set `isMounted = false` in cleanup and guard all `setState` calls |
| `src/services/deals/section-values.service.ts` | fetch functions | 3, 7, 24 | Three functions with different names that call the identical endpoint | Remove duplicates; keep one canonical function |
| `src/services/deals/deals.service.ts` | fetchDealById/fetchDealMaybeSingle | 8, 12 | Two functions with identical implementations | Remove `fetchDealMaybeSingle`; use `fetchDealById` everywhere |
| `src/services/node-api/realtime.ts` | subscribeToChanges | 36 | `source.onerror = () => {}` — SSE errors silently suppressed, no reconnect logic | Implement exponential backoff reconnect; surface errors to caller via callback |
| `src/services/node-api/client.ts` | apiClient | 1 | Falls back to `http://localhost:3000/api` when `VITE_NODE_API_URL` is unset | Throw at startup if `VITE_NODE_API_URL` is missing in non-development mode |
| `src/components/deal/InviteParticipantsPanel.tsx` | handleResendInvite | 373 | Creates new magic link without revoking the previous active link | Revoke all existing valid links for the participant before creating a new one |
| `src/pages/csr/DealDocumentsPage.tsx` | dev buttons | 1160 | Production bundle contains hidden dev-only generation buttons in `className="hidden"` div | Wrap in `import.meta.env.DEV` conditional or remove from production bundle |
| `src/pages/csr/DealDataEntryPage.tsx` | tab reset | 1253 | Tab unconditionally resets to `loan_terms` on every `location.key` change | Only reset tab when `location.state.resetToLoanTerms` is explicitly set |

---

## Database Schema Analysis

### Schema Summary

- **Models:** 26
- **Enums:** 11
- **Migrations:** 2

### Critical Schema Issues

**SetNull on NOT NULL columns with NO ACTION in migration SQL**

Both `contacts.created_by` and `deals.created_by` are declared as non-nullable fields (`String @db.Uuid`, no `?`) in the Prisma schema, yet their relations specify `onDelete: SetNull`. This is a three-way mismatch:
1. Prisma schema says `SetNull` — Prisma-generated queries will attempt to null the column on user delete.
2. The column is `NOT NULL` — the DB will reject the `SET NULL` write.
3. The migration SQL (`20260522000000_migrate_auth_to_public_users`) creates both foreign keys with `ON DELETE NO ACTION` — the actual DB constraint blocks user deletion entirely if any deals or contacts reference them.

The practical result: deleting a user who created any deal or contact is blocked at the DB level (NO ACTION), which is likely safe behavior, but the mismatch with the Prisma schema means `prisma db push` or future migrations may attempt to reconcile by making columns nullable or changing the FK behavior in unexpected ways.

**Fix:** Either (a) make `created_by` nullable in the Prisma schema (`String? @db.Uuid`) and update the migration FK to `ON DELETE SET NULL`, or (b) keep `NOT NULL` and change the Prisma schema to `onDelete: Restrict` to match the actual DB behavior.

**Other relation issues:**
- `deal_field_values.updated_by` — no `onDelete` rule (defaults to Restrict/NoAction); nullable column should use `SetNull`.
- `deal_participants.user_id` — no `onDelete` rule; nullable column should use `SetNull`.
- `messages.deal_id` — `NoAction` leaves orphaned message rows when a deal is deleted.

### Missing Indexes

| Model | Field(s) | Query Pattern | Impact |
|-------|---------|---------------|--------|
| `messages` | `deal_id` | `WHERE deal_id = ?` | Full table scan fetching messages per deal |
| `messages` | `sender_id` | `WHERE sender_id = ?` | Full table scan for sent messages per user |
| `messages` | `status` | `WHERE status = 'sent'` | No index for delivery status filtering |
| `deal_assignments` | `user_id` | `WHERE user_id = ?` | "Get all deals for user" queries use composite index in wrong column order |
| `template_field_maps` | `template_id` | `WHERE template_id = ?` | Full scan for all fields of a template |
| `packet_templates` | `template_id` | `WHERE template_id = ?` | Composite unique covers `packet_id` as leading column; `template_id`-only queries unindexed |
| `activity_log` | `actor_user_id` | `WHERE actor_user_id = ?` | Full scan for user audit trail |
| `event_journal` | `actor_user_id` | `WHERE actor_user_id = ?` | Full scan for actor-based journal queries |
| `generation_jobs` | `created_at` | `ORDER BY created_at DESC` | Time-ordered job polling scans all rows |
| `refresh_tokens` | `revoked_at` | `WHERE revoked_at IS NULL` | Active token validation and cleanup jobs scan all token rows |
| `deals` | `updated_at` | `ORDER BY updated_at DESC` | Recently modified deals list requires full scan |
| `loan_history` | `date_received` | `WHERE date_received BETWEEN ? AND ?` | Date-range reports on loan history scan all rows |

### Cascade Delete Analysis

**When a deal is deleted:**
- Cascades to: `activity_log`, `deal_assignments`, `deal_field_values`, `deal_participants` (which cascades to `magic_links`), `deal_section_values`, `event_journal`, `generated_documents`, `generation_jobs`, `loan_history` (which cascades to `loan_history_lenders`)
- Orphaned: `messages.deal_id` is `NoAction` — message rows remain with a stale `deal_id`

**When a user is deleted:**
- Cascades to: `refresh_tokens` (Cascade — tokens correctly deleted)
- Blocked by: `contacts.created_by` (NO ACTION in actual DB — delete blocked if user created any contact), `deals.created_by` (NO ACTION — delete blocked if user created any deal), `deal_field_values.updated_by` (NoAction — delete blocked if any field value was last edited by this user), `deal_participants.user_id` (NoAction — delete blocked if user is a participant), `packets.created_by` (NoAction), `templates.created_by` (NoAction)

### Enum DB/UI Coupling Concerns

`field_data_type` contains UI widget types: `action`, `navigation`, `sort_control`, `search_input`, `label`, `section`, `template`, `entity_reference`, `object_reference`. These are frontend rendering concerns encoded as a Postgres enum — adding a new widget type requires a DB migration.

`field_section` has over 24 of 68 values representing UI screen sections, toolbars, pagination controls, and navigation areas (e.g., `customize_grid_actions`, `eds_notepro_toolbar`, `trust_ledger_pagination`). Every new screen layout change requires a DB migration.

### Migration SQL Risks

1. `DROP TABLE IF EXISTS public.user_roles CASCADE` and `DROP TABLE IF EXISTS public.profiles CASCADE` in `20260522000000_migrate_auth_to_public_users` are irreversible. If run on a DB that has not yet migrated profile data, all user profile and role data is permanently lost. **Severity: High.**
2. The same migration uses a `DO $$` block that drops ALL RLS policies on ALL tables in the `public` schema dynamically. Any RLS policy added by a subsequent migration or directly in the DB will be wiped if this migration is replayed. **Severity: Medium.**
3. `contacts_created_by_fkey` and `deals_created_by_fkey` are created with `ON DELETE NO ACTION` in SQL but `onDelete: SetNull` in Prisma schema — schema/migration mismatch. **Severity: High.**

---

## Security Analysis

### Authentication Security

| Issue | File | Line | Severity |
|-------|------|------|----------|
| No issuer or audience claim on NestJS-issued JWTs | `auth.module.ts` | 17 | High |
| Algorithm not pinned in `JwtModule.signOptions` (only in strategy) | `auth.module.ts` | 17 | Medium |
| `expiresIn` cast as `unknown as number` — type lie | `auth.module.ts` | 19 | Low |
| Legacy Supabase fallback always active, no kill switch | `access-token.verify.ts` | 97 | High |
| Legacy HS256 path has no `iss`/`aud` validation | `access-token.verify.ts` | 84 | High |
| `createRemoteJWKSet` not a module-level singleton — JWKS fetched per request | `access-token.verify.ts` | 61 | Medium |
| `refresh()` crashes with TypeError (not 401) when refresh cookie absent | `auth.service.ts` | 68 | High |
| Refresh token rotation not atomic — race window for duplicate sessions | `auth.service.ts` | 113 | High |
| Token family revocation not implemented | `auth.service.ts` | 72 | High |
| `generateSecureToken()` uses `crypto.randomUUID` (128-bit entropy, not 64 bytes) | `auth.service.ts` | 170 | High |
| Access token cookie path is `'/'` — sent on all routes | `auth.service.ts` | 141 | High |
| `SameSite: 'lax'` — no CSRF token mechanism | `auth.service.ts` | 143 | High |
| `secure: isProd` — tokens sent over plain HTTP in dev with real credentials | `auth.service.ts` | 145 | High |
| `ThrottlerGuard` fires after `LocalAuthGuard` on login — bcrypt before throttle | `auth.controller.ts` | 33 | Medium |
| IP parsed from `x-forwarded-for` without trust proxy — spoofable | `auth.controller.ts` | 88 | Medium |
| `deleteExpiredRefreshTokens()` never called — table grows unbounded | `auth.repository.ts` | 94 | Low |
| `JwtStrategy` defined but never invoked (dead code) | `jwt.strategy.ts` | 9 | Low |

### API Authorization Coverage

**Routes with confirmed authorization gaps:**

| Route | Auth Guard | Role Check | Ownership Check | Risk |
|-------|-----------|------------|-----------------|------|
| `GET /api/deals/events` (SSE) | None (@Public) | None | None | Critical — unauthenticated DB polling |
| `GET /api/deals/:id/participants/events` (SSE) | None (@Public) | None | None | Critical — unauthenticated DB polling |
| `GET /api/deals/:id/documents/events` (SSE) | None (@Public) | None | None | Critical — unauthenticated DB polling |
| `POST /api/deals/:id/participants/:pid/complete` | None (@Public) | None | None | Critical — unauthenticated completion |
| `POST /api/deals/magic-links/validate` | None (@Public) | None | None | High — no rate limit on token validation |
| `DELETE /api/deals` (any deal) | JWT only | None | None | High — any user can delete any deal |
| `POST /api/admin/users/:userId/role` | JWT only | None (RolesGuard missing) | N/A | High — any user can assign roles |
| `POST /api/system/settings` | JWT only | None | N/A | High — any user can modify system settings |
| `PATCH /api/deals/participants/by-contact` (bulk delete) | JWT only | None | None | High — bulk delete across all deals |
| `GET /api/deals/assignments/by-user/:userId` | JWT only | None | None | Medium — enumerate any user's assignments |
| `POST /api/deals/:id/participants/:pid/magic-links` | JWT only | None | None | High — mass assignment (see H6) |
| All 26 admin routes | JWT only | None (RolesGuard missing) | N/A | High — no role enforcement |

**Note:** Every route in the system that has `JwtAuthGuard` also has no ownership check. Any authenticated user can read or modify any deal, participant, document, assignment, or loan history record belonging to any other user. There is no multi-tenancy or data scoping at the application layer.

### Frontend Security

| Issue | File | Line | Severity |
|-------|------|------|----------|
| `dangerouslySetInnerHTML` with unsanitized note content | `NotesTableView.tsx` | 424 | Critical |
| DOCX mammoth output injected raw via `document.write` | `DealDocumentsPage.tsx` | 733 | High |
| `fileName` from DB embedded in raw HTML in print window | `DealDocumentsPage.tsx` | 659 | High |
| Magic link session token in `localStorage` | `magicLink.ts` | 73 | High |
| `RoleGuard` treats `role === null` as loading — bypasses all role checks | `RoleGuard.tsx` | 16 | Critical |
| Client-side session expiry hardcoded at 4h, independent of server | `MagicLinkAccessPage.tsx` | 48 | High |
| SSE `onerror` silenced — dead connections accumulate silently | `realtime.ts` | 36 | Medium |
| API client falls back to `http://localhost:3000/api` if env var missing | `client.ts` | 1 | Medium |
| Dev-only generation buttons in production bundle (`className="hidden"`) | `DealDocumentsPage.tsx` | 1160 | High |

### Storage Security

| Issue | File | Line | Severity |
|-------|------|------|----------|
| No MIME type or extension allowlist | `storage.controller.ts` | 32 | High |
| No path traversal sanitization on upload path | `storage.controller.ts` | 43 | High |
| Signed URL expiry fully caller-controlled | `storage.controller.ts` | 85 | High |
| Bulk delete accepts unbounded array of paths | `storage.controller.ts` | 96 | Medium |
| 50 MB multer in-memory storage — single upload holds 50 MB heap | `storage.controller.ts` | 33 | Medium |

---

## Missing Features & Production Gaps

1. **No test coverage:** No test files found across the entire codebase. No unit tests, integration tests, or e2e tests exist for auth, deals, documents, or storage modules.
2. **No correlation/request IDs:** No `X-Request-Id` header or request tracing is added by the NestJS middleware. Debugging production errors requires log-line correlation by timestamp, which is unreliable under concurrent traffic.
3. **No structured logging:** NestJS default logger and `morgan` write to stdout with no JSON formatting, no log levels per environment, and no `LOG_LEVEL` env var documented.
4. **Email observability is zero:** `completeParticipantSection` at line 437 sends email via a fire-and-forget `fetch` with `.catch(() => {})`. `inviteParticipant` at line 358 uses Resend's shared sandbox domain (`onboarding@resend.dev`) which is blocked by most production email providers.
5. **No compression middleware:** `main.ts` does not apply `compression()`. DOCX files and large JSON responses are sent uncompressed.
6. **No trust proxy configuration:** `app.set('trust proxy', ...)` is absent from `main.ts`. All IP-based rate limiting uses manually parsed `x-forwarded-for` headers (spoofable).
7. **No error boundary coverage:** None of the four analyzed page/panel components are wrapped in React error boundaries. A render error in any child component unmounts the entire page.
8. **No max concurrent sessions limit:** A single user can accumulate unlimited `refresh_tokens` rows. No per-user session count cap exists.
9. **`@prisma/client` in frontend prod dependencies:** Prisma Client is a server-side ORM. Its presence in `package.json` dependencies either bloats the frontend bundle or indicates accidental inclusion.
10. **`react-day-picker` v8 with `date-fns` v3:** Known breaking incompatibility — `react-day-picker@^8.10.1` requires `date-fns` v2. The project uses `date-fns` v3. This may cause runtime errors in date picker components.
11. **No heartbeat on SSE connections:** SSE connections have no ping/keep-alive. Load balancers with 60-second idle timeouts will silently drop connections.
12. **No account-level lockout:** Rate limiting is IP-only. Distributed brute force from many IPs bypasses all throttle limits. No per-account failed attempt tracking exists.
13. **TypeScript strict mode is off across all tsconfigs:** `strict: false`, `noImplicitAny: false`, `noUnusedLocals: false`, and `noUnusedParameters: false` in both `tsconfig.app.json` and backend `tsconfig.json`. Type errors and dead code accumulate silently.

---

## Action Plan

### Phase 1: Critical (Block on these before production)

1. **Implement `RolesGuard`** at `backend/src/common/guards/roles.guard.ts` using `Reflector` to read `ROLES_KEY` metadata. Register as `APP_GUARD` in `AppModule`. Apply `@Roles('admin')` to `AdminController` and system mutation routes. (C1, H16)
2. **Register `JwtAuthGuard` as global `APP_GUARD`** in `AppModule`. Add `@Public()` to all intentionally public routes. Audit every controller for missing guards. (C2)
3. **Fix `RoleGuard.tsx`** to distinguish loading state from resolved-null-role state. Redirect null-role users to `/unauthorized`, not `/auth`. (C3)
4. **Sanitize `NotesTableView.tsx`** with DOMPurify. Replace `dangerouslySetInnerHTML={{ __html: viewingNote.content }}` with `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewingNote.content) }}`. (C7)
5. **Sanitize print paths** in `DealDocumentsPage.tsx` — pass mammoth output through `DOMPurify.sanitize()` at line 733; HTML-encode `fileName` at line 659. (H9, H10)
6. **Await the participant status update** in `validateMagicLink` at `deals.service.ts:476`. Store the returned `sessionToken` hash in the database for server-side verification. (C4, C5)
7. **Remove `@Public()` from the `/complete` endpoint** and require magic link session authentication. Add `@Throttle({ default: { limit: 5, ttl: 60_000 } })`. (C6)
8. **Add authentication to all three SSE endpoints.** Require a valid JWT cookie. Add a server-side connection cap. Replace 3-second DB polling with `LISTEN/NOTIFY`. (H5)
9. **Fix `created_by` forgery** in `createDeal`: always use `user.sub`, remove `created_by` from `CreateDealDto`. (H7)
10. **Create a `CreateMagicLinkDto`** with only safe fields. Remove the `...body` spread in `createMagicLink`. (H6)

### Phase 2: Migration Completion

11. Add a `auth.legacyFallbackEnabled` config flag defaulting to `false` in production. Gate the Supabase HS256 fallback path in `access-token.verify.ts`. Add `iss`/`aud` validation to the legacy path. Set a removal date. (H1, H2)
12. Delete `supabase/functions/generate-document/` and all `_shared/` utilities once NestJS generation routes are confirmed equivalent in production.
13. Move `createRemoteJWKSet` to module level in `access-token.verify.ts` so the JWKS cache persists across requests.
14. Refactor `docxtemplater.service.ts:89` to create the Supabase client once in the constructor or module initialization.
15. Implement `@nestjs/schedule` cron job calling `authRepository.deleteExpiredRefreshTokens()` nightly.
16. Add the `SUPABASE_JWT_SECRET` as required (not optional) if any legacy tokens remain in circulation, or explicitly document that no legacy tokens remain and the var can be removed.

### Phase 3: Architecture & Scalability

17. Implement token family revocation: when a revoked refresh token is presented, call `revokeAllUserRefreshTokens(userId)` and log a security alert. (H3)
18. Wrap refresh token rotation (`issueTokens` + `revokeRefreshToken`) in a Prisma `$transaction`. (H4)
19. Add ownership checks to all deal routes — verify that `request.user.sub` matches `deal.created_by` or `deal_assignments.user_id`.
20. Add missing database indexes (see Missing Indexes table). Priority order: `messages.deal_id`, `deal_assignments.user_id`, `template_field_maps.template_id`, `refresh_tokens.revoked_at`, `activity_log.actor_user_id`.
21. Fix `contacts.created_by` and `deals.created_by` schema/migration mismatch — decide on `NOT NULL + Restrict` vs `nullable + SetNull` and align Prisma schema with migration SQL.
22. Add `issuer`, `audience`, and `algorithm: 'HS256'` to `JwtModule.signOptions` and `verifyOptions`. Remove the `unknown as number` cast from `expiresIn`. (`auth.module.ts:17-19`)
23. Disable the docxtemplater angular-expression parser unless explicitly required. If expressions are needed, run rendering in a sandboxed child process. (H11)

### Phase 4: Code Quality & Performance

24. Enable TypeScript strict mode: set `strict: true`, `noImplicitAny: true`, `noUnusedLocals: true` in all `tsconfig*.json` files. Fix resulting type errors.
25. Replace all 18 `any` uses in `src/hooks/useDealFields.ts` with proper interfaces. Fix the `removeValuesByPrefix` return type mismatch (void vs async void).
26. Replace sequential `for...of` HTTP loops in `useDealFields.ts:1107` (saveDraft), `useDealFields.ts:765` (removeValuesByPrefix), and `deals.service.ts:686` (cloneDeal) with `Promise.all` patterns.
27. Deduplicate `fetchSectionValuesByDeal`, `fetchSectionValuesByDealWithUpdatedAt`, `fetchSectionValuesWithVersion` (identical implementations). Deduplicate `fetchDealById` and `fetchDealMaybeSingle`.
28. Add AbortController to `fetchData` in `useDealFields.ts:345` to prevent setState on unmounted components.
29. Replace `parseInt(page)` / `parseInt(limit)` in `deals.controller.ts:58` with `ParseIntPipe` and add `@IsInt() @IsPositive() @Max(100)` validation on query DTOs.
30. Move the dev-only generation buttons in `DealDocumentsPage.tsx:1160` behind `import.meta.env.DEV`.
31. Fix `source.onerror = () => {}` in `realtime.ts:36` — implement exponential backoff reconnect and surface errors to the caller.
32. Wrap all four major page/panel components in React `<ErrorBoundary>` components.
33. Add `maxAge` and `cooldownDuration` configuration to JWKS fetching. Move to module-level singleton.
34. Remove `@prisma/client` from frontend `package.json` if it is tree-shaken; or explicitly move it to `devDependencies`.

### Phase 5: Future

35. Design and implement multi-tenancy (organization/tenant isolation) at the data layer — add `organization_id` discriminator to `deals`, `contacts`, `users`, and related tables, with row-level enforcement in the query layer.
36. Evaluate replacing the 3-second SSE polling with Postgres `LISTEN/NOTIFY` channels or a message broker (Redis Pub/Sub) to eliminate per-connection DB load.
37. Evaluate replacing `jsonwebtoken` with `jose` for the HS256 path to consolidate on a single JWT library.
38. Evaluate decoupling `field_data_type` and `field_section` enum values from UI rendering concerns — move widget/section configuration to a JSON config table to avoid DB migrations for UI changes.
39. Implement soft-delete (`deleted_at` timestamp) on `deals`, `contacts`, `templates`, and `packets` to support audit trails and recovery.
40. Add structured logging with correlation IDs, JSON output, and configurable `LOG_LEVEL`.

---

*Report 2 generated by Claude Code — 9 deep-read agents, independent second pass*
