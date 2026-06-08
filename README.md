# Loan Doc Hub

A React frontend for managing loan deals, document generation, and participant collaboration. Communicates exclusively with a NestJS backend API.

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS** + **shadcn/ui** components
- **TanStack Query** for server state
- **React Router v6** for routing
- **Vitest** for unit tests

## Prerequisites

- Node.js 18+
- npm
- NestJS backend running at `http://localhost:3000` (separate repo)

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Set VITE_NODE_API_URL=http://localhost:3000/api

# Start dev server → http://localhost:8080
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server on port 8080 |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests (single run) |
| `npm run test:watch` | Vitest watch mode |

## Project Structure

```
src/
  services/
    client.ts          # HTTP client — apiClient, cookie auth, auto token refresh
    realtime.ts        # SSE subscription wrapper
    auth-service/      # login, register, logout, getMe
    contacts/          # Contacts API
    deals/             # Deals, participants, field values, loan history
    documents/         # Templates, packets, generation
    admin/             # Field dictionary, users, permissions
    system/            # Settings, activity log, messages
    storage/           # File upload/download proxy
  components/          # Shared UI components (shadcn-based)
  pages/               # Route-level pages
  contexts/            # AuthContext, ThemeContext
  hooks/               # Custom React hooks
  lib/                 # Pure utilities (calculationEngine, cn)
```

## Authentication

Sessions are managed via httpOnly cookies issued by the NestJS backend. The frontend never handles tokens directly — `apiClient` in `src/services/client.ts` attaches cookies automatically and handles 401 → token refresh → retry transparently.

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_NODE_API_URL` | NestJS API base URL (e.g. `http://localhost:3000/api`) |
