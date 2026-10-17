# AGENTS.md

Recistep is a Next.js 16 App Router PWA (React 19, TypeScript strict, Zod 3, Vitest) that imports recipes from public YouTube/TikTok/Instagram links. Docs and user-facing strings are Portuguese (pt-BR); keep that when editing.

## Commands

Node 22.x is required (`engines`). There is **no lint or formatter config** in this repo.

```bash
npm install
npm run dev         # next dev
npm test            # vitest run (all *.test.ts)
npm run typecheck   # tsc --noEmit
npm run build       # next build
```

Single test file / single test:

```bash
npx vitest run lib/recipe/scale-portions.test.ts
npx vitest run -t "nome do teste"
```

CI (`.github/workflows/ci.yml`) runs, in order: `npm test` -> `npm run typecheck` -> `npm run build`. Run those before considering a change done.

## Testing quirks

- Tests are colocated next to source as `*.test.ts`; env is `node` (no DOM). `clearMocks`/`restoreMocks` are on.
- Any module that imports `"server-only"` must be mocked in tests: `vi.mock("server-only", () => ({}))`. Inngest functions are unit-tested by mocking `@/lib/inngest/client` so `createFunction` returns the raw handler (see `lib/inngest/functions.test.ts`).
- `@/*` resolves to the repo root (configured in both `tsconfig.json` and `vitest.config.ts`; the vitest alias is required and not inherited).

## Architecture

- Server-only modules start with `import "server-only";`. Do not import them into client components.
- Supabase is accessed via raw REST (`lib/server/supabase-rest.ts`) using the service-role key, not `supabase-js`, on the server. The browser only uses `supabase-js` for auth (`lib/supabase/`).
- Every `/api/v1/*` route requires `Authorization: Bearer <Supabase access token>`; auth is verified against `/auth/v1/user`. Malformed import IDs fail the `/^[0-9a-f-]{36}$/i` check.
- Import pipeline is a durable Inngest workflow (`lib/inngest/functions.ts`, registered at `app/api/inngest/route.ts`). State machine in `ImportStatus` (`lib/server/supabase-rest.ts`): `queued -> processing -> source_content_required | review_required -> completed | failed`. Import never auto-confirms; Gemini output always lands in `review_required`.
- `lib/providers/sources/registry.ts` maps platforms to connectors. Recognizing a URL never implies the media is downloadable; when content is unavailable the flow requests a user-supplied transcript instead.
- `lib/schemas/recipe.ts` is the single strict source of truth (`.strict()` everywhere). Adding a field to drafts requires updating the Zod schema, the Gemini JSON response schema in `lib/providers/ai/gemini-recipe-extractor.ts`, and the DB/RLS as needed.
- Measurement/time parsing (`lib/recipe/measurement.ts`) and portion scaling (`lib/recipe/scale-portions.ts`) are deterministic: never invent quantities, preserve unknown/descriptive amounts, never convert incompatible units.
- Extraction streams partial drafts to the client over SSE (`app/api/v1/imports/[id]/stream`). The raw transcript must never be persisted into Inngest step history or returned to clients.
- Caching (`lib/server/recipe-cache.ts`): in-memory LRU (5 min, 500 keys) -> Next.js `unstable_cache` (1 h, tag `recistep-recipe-cache`) -> Supabase. Cache is an optimization only; never let a cache error fail a valid import.
- Voice agent uses Gemini Live: server issues a single-use ephemeral token (`app/api/v1/voice/token`), client hook in `lib/voice/live-session.ts`. `GEMINI_API_KEY` must stay server-side.

## Environment and services

- Copy `.env.example` to `.env.local`. Keep `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and Inngest keys server-only; only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public.
- Local Inngest: run the Dev Server and set `INNGEST_DEV=1`.
- Supabase migrations in `supabase/migrations/` are **manual and version-ordered**; the project is not provisioned here. New migrations need a `YYYYMMDDHHMMSS_name.sql` filename. Several features return 503 until services/env are configured, so do not claim the app runs end-to-end.
- New rate-limited routes should use `checkUserRateLimit` (`lib/server/rate-limit.ts`), backed by the `consume_api_rate_limit` RPC.

## Docs

- `README.md` summarizes implemented state and the API surface.
- `plano.md` is the 14-criteria technical spec plus execution log; treat it as the design reference.
