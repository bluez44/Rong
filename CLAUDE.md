# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Rong is a Vietnam travel app: search a destination, browse places in it, build an itinerary, share it with a group. It is a pnpm + Turborepo monorepo (`nodeLinker: hoisted`):

| Path | What it is |
| --- | --- |
| `apps/backend` | NestJS 12, TypeORM, Postgres + PostGIS. The only entry point for clients. |
| `apps/mobile` | Expo / React Native with expo-router. Has its own `CLAUDE.md` with screen and keyboard rules. |
| `apps/web` | Next.js 16. |
| `packages/shared-types` | The API contract used by all three apps. |

The product spec is `docs/PRD-Rong.md`, written in Vietnamese. Feature IDs such as F1, FR-6.3 and §7.4 refer to it. Larger backend slices have a design spec and plan in `docs/superpowers/`. Code comments, log messages and error text are in Vietnamese; match that.

## Commands

From the repo root:

```bash
pnpm install
pnpm infra:up                 # PostGIS on host port 5433 (not 5432), Redis on 6379
pnpm build | lint | typecheck | test   # all workspaces via turbo
```

Backend (`cd apps/backend`, or `pnpm --filter @rong/backend <script>`):

```bash
cp .env.example .env          # JWT_SECRET must be ≥ 32 chars
pnpm migration:run            # builds first, then runs dist/database/migrations
pnpm start:dev                # http://localhost:3001/api, try GET /api/health
pnpm test                     # unit tests (*.spec.ts under src/, vitest)
pnpm test:e2e                 # test/*.e2e-spec.ts against a real, migrated database
pnpm test:speed               # places-speed.e2e-spec.ts: v1/v2 latency with fixed-delay fakes (also part of test:e2e)
pnpm bench:places             # test/*.live-spec.ts: real Overpass/Tavily/Gemini/Google timings (costs money; PLACES_LIVE_REGION=<source_key>)
pnpm lint                     # oxlint --type-aware
pnpm typecheck
pnpm format                   # prettier

npx vitest run src/modules/itineraries/planning/planning.spec.ts   # one file
npx vitest run -t 'searchKey'                                        # by test name
npx vitest run --config vitest.config.e2e.ts test/groups.e2e-spec.ts # one e2e file
```

- **Build shared types first.** `@rong/shared-types` is consumed from its `dist/`. The backend's `test`, `start`, `build` and `typecheck` scripts run `pnpm build:deps` for you. If you call `vitest` or `tsc` directly after changing `packages/shared-types`, run `pnpm build:deps` first, or you'll get stale or missing types.
- **e2e tests** boot the full `AppModule` and swap AI services with `overrideProvider`. They must recreate the `api` prefix and the `ValidationPipe` by hand. Copy an existing spec's `beforeAll`.

Mobile: run `pnpm --filter @rong/mobile start` for Metro, or `android` / `ios` for native builds. EAS profiles are in `apps/mobile/eas.json`.

## Backend architecture

### Conventions
- **ESM project:** relative imports must end in `.js` (`'./foo.service.js'`).
- **Global prefix and pipes:** `main.ts` sets the `api` prefix and a global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform`.
- **Auth is on by default.** `AuthModule` registers `JwtAuthGuard` as a global `APP_GUARD`. Mark open routes with `@Public()` and read the caller with `@CurrentUser()`. The JWT payload is `{ sub: userId }`.
  - Open today: `auth/*`, `health`, `invites/:token` (preview) and `public/itineraries/:token`.
- **Login design:** email + password with argon2id, then a 6-digit email verification code stored HMAC'd in `one_time_tokens`. The `auth_identities` table leaves room for OAuth providers.
- **Sessions:** a 15-minute JWT access token plus a 60-day refresh token (`REFRESH_TOKEN_TTL_DAYS`), stored SHA-256'd in `refresh_tokens` by `RefreshTokenService`. `POST /auth/refresh` rotates it (one use, new token in the same family, expiry restarts); presenting an already-used token revokes the whole family. `POST /auth/logout` revokes the family. The mobile `authFetch` refreshes once on expiry or 401, shared across concurrent requests, and signs out only when the refresh token is rejected.
- **Config:** everything goes through `src/config/configuration.ts` (`loadConfig` validates env). Add new env vars there and in `.env.example`.
- **Errors:** throw Nest exceptions with a `{ code: 'SOME_CODE', message }` body. Clients and tests match on `code`.

### Database
- `synchronize` is always off, so **the schema changes only through migrations** in `src/database/migrations/`.
  - Migrations are timestamp-named and mostly hand-written SQL, because of the PostGIS columns.
  - In Docker, `docker-entrypoint.sh` runs them on start.
- Services often use raw SQL through `DataSource.query` rather than repositories. Cast untyped parameters explicitly (`$3::float8`).
- Itinerary days and items are stored as JSONB on `itineraries`.

### External-service gateways
Keep each external service behind its single gateway:

| Gateway | Covers | Rules |
| --- | --- | --- |
| `modules/open-data/OpenDataService` | Nominatim, Overpass, Wikidata | Per-host throttling, a User-Agent from `OPEN_DATA_CONTACT_EMAIL`, failover across the comma-separated `OVERPASS_URL` mirrors. |
| `modules/google/` | Google Places (New), Geocoding | PRD §7.4: store nothing but `place_id`, cache Google coordinates for at most 30 days (Geocoding results are cached in memory only), never cache Google content, never rank or sort on Google data. Ratings, reviews and photos are fetched live, only on `GET /places/:id`. |
| `src/langchain/` | Gemini | `LangchainService` (the `/langchain` route, the `findPlaces` fallback, `planItinerary`). `PlaceSearchService` plus `web-search.ts` (Tavily) power the v2 places API. Gemini models are created in `src/chat-models/`. |

### Places: two pipelines
- **v1, `GET /regions/:id/places`, OSM-based, no AI.**
  1. The region search (`modules/regions`) folds diacritics (`searchKey`) and uses pg_trgm. With `online=1` it also queries Nominatim and imports the results.
  2. Provinces before and after the July 2025 merger are seeded on boot by `RegionSeeder` from `regions/seed/vietnam-admin.ts`.
  3. Each region's area is a **bounding box** (`RegionAreaService.ensure`), not a polygon.
  4. Places are fetched from Overpass by that bbox, classified by OSM tags (`osm-place-mapping.ts`), scored deterministically (`place-scoring.ts`), stored in `places`, and paginated with a cursor.
  5. If OSM fails and nothing is cached, it falls back to Gemini + Google Maps (`source: 'ai_google_maps'`, `id: null`, not stored).
  6. Only a region that has never been fetched blocks the request, and for at most 15 s (then it falls back and keeps loading in the background); a stale one is served from `places` and refreshed in the background. When every Overpass mirror fails, `OpenDataService` fails fast for 3 minutes instead of retrying the whole mirror list on each request. With `PLACES_WARMUP=true`, `PlacesWarmer` pre-builds the catalog for seeded destinations and provinces (30 s after boot, then every 6 h). Keep it off for e2e.
- **v2, `GET /v2/regions/:id/places`, web search + Gemini.** `places-v2.service.ts` asks `PlaceSearchService` for places named in web articles: three fixed Tavily queries run in parallel, then one Gemini structured-output call with `thinkingLevel: 'LOW'`. Only when they return fewer than 3 articles does it fall back to a LangChain agent (`createAgent` + the `search_web` tool, max 3 searches) that gets the articles found so far and searches with its own queries.
  1. Every place is kept only if a source article actually mentions it (`web-grounding.ts`).
  2. Each place is matched to the catalog by name similarity, or geocoded with Google (coordinates cached in memory for up to 30 days).
  3. Results are cached in memory for 6 hours. Publication dates (≤ 1.5 s) and a missing region bbox (≤ 3 s) are not waited on past their budget; they finish in the background and fill the cached result.
  4. Without a `TAVILY_API_KEY` it returns 503.

`src/modules/README.md` is the module map and documents these flows and the deliberate PRD deviations. Update it when module responsibilities change.

### Itineraries (F6, F8, F9)
`modules/itineraries` creates a plan in four steps:

1. Candidates: the user's selected places plus extras from the catalog.
2. k-means clusters the candidates into days (`planning/clustering.ts`).
3. Gemini orders the stops (`ai-planner.ts`), and the result is fully re-validated. The AI may only use IDs it was sent, because every itinerary place must exist in the database (FR-6.3).
4. Code sets the times (`planning/scheduler.ts`): meals, rest breaks, opening hours and estimated travel (`travel.ts`; no Google Routes yet).

Other behavior:
- If Gemini fails, a heuristic planner takes over (`planner: 'heuristic'`). `planningMode: 'manual'` leaves the days empty.
- Edits (`PUT /itineraries/:id`) are re-timed by `planning/retime.ts`. That produces advisory warnings such as a long leg, a long day, a missing meal or a closed place. They never block the save.
- `GET /itineraries/:id/alternatives` suggests similar places.
- Party rules, meal windows and typical hours per category are in `planning/rules.ts`.
- Share links (`share-links.*`) expose a read-only public view at `public/itineraries/:token`.

### Groups (S8)
`modules/groups`: groups, invite links, roles (owner, editor, viewer), a shared place list and an activity log. An itinerary can be moved into a group with `PATCH /itineraries/:id/group`.

**All permission rules live in `groups/access.ts`** as pure functions; `AccessService` loads the roles and calls into it. Use it for any itinerary or group authorization; don't write ad-hoc ownership checks. A caller who can't view the resource gets 404, not 403, so its existence isn't leaked.

`modules/saved-places` is the per-user "Muốn đi" list. `ranking/`, `realtime/` and `share-import/` are placeholders for later PRD features.

## Deploy
- `apps/backend/Dockerfile` builds from the repo root.
- `infra/prod/` holds the EC2 + Caddy + Docker Compose setup; see its README.
- The GitHub Actions workflow `.github/workflows/deploy-backend.yml` is currently commented out.

## Other apps
- `apps/web` is Next.js 16 and has breaking changes compared with older versions. Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before editing it.
- `apps/mobile`: follow `apps/mobile/CLAUDE.md`, which says to wrap screens in `<Screen>` and to use `<KeyboardAvoider>` rather than raw `KeyboardAvoidingView`. Its Google Maps keys come from `apps/mobile/.env` at config time.
