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
pnpm bench:places             # test/places.live-spec.ts: builds one region's list with real Tavily/Gemini/Google (costs money; PLACES_LIVE_REGION=<source_key>)
RECOMMENDATIONS_ENABLED=false pnpm start:dev   # skip the recommendations BullMQ queue/cron when Redis isn't running
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
  - Open today: `auth/*`, `health`, `invites/:token` (preview) and `public/itineraries/:token`. Outside the `api` prefix (`src/global-prefix.ts`): `invite/:token` (HTML invite page) and `.well-known/assetlinks.json`.
- **Login design:** email + password with argon2id, then a 6-digit email verification code stored HMAC'd in `one_time_tokens`. Google (ID token verified with `jose`) and Zalo (Graph API with `appsecret_proof`) sign in through `POST /auth/google` and `/auth/zalo` (`modules/auth/external/`, `AuthService.loginExternal`); a verified Google email merges into the existing account with that email, Zalo never merges. Missing provider env → 503 `PROVIDER_NOT_CONFIGURED`.
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
| `modules/open-data/OpenDataService` | Nominatim | Per-host throttling, a User-Agent from `OPEN_DATA_CONTACT_EMAIL`. The app no longer calls Overpass or Wikidata at runtime. |
| `modules/google/` | Google Places (New) | PRD §7.4: store nothing but `place_id`, cache Google coordinates for at most 30 days, never cache Google content, never rank or sort on Google data. Ratings, reviews and photos are fetched live, only on `GET /places/:id`. |
| `modules/share-import/LinkMetadataService` | oEmbed, Open Graph of user-shared links | Blocks non-public IPs on every redirect, at most 5 redirects / 5 s / 1 MB. |
| `src/langchain/` | Gemini | `LangchainService` (the `/langchain` route, `planItinerary`). `PlaceSearchService` plus `web-search.ts` (Tavily) find a region's places in web articles. Gemini models are created in `src/chat-models/`. |

### Places: one list per region, from web articles
- **Regions.** The region search (`modules/regions`) folds diacritics (`searchKey`) and uses pg_trgm; with `online=1` it also queries Nominatim and imports the results. Provinces before and after the July 2025 merger are seeded on boot by `RegionSeeder` from `regions/seed/vietnam-admin.ts`, with their **bounding boxes** from `regions/seed/province-bboxes.ts` (generated once by `scripts/generate-province-bboxes.ts` from OSM, committed; merged provinces get the union of their parts). A region's area is a bbox, not a polygon (`RegionAreaService.ensure` fills in the rest without Overpass).
- **`GET /regions/:id/places`** (`places/web-places.service.ts`) reads the region's stored list (`region_place_lists` + `region_places`, ordered by `rank`, no paging). A region with no list runs the pipeline and waits at most `WEB_PLACES_WAIT_MS` (25 s), then returns `status: 'building'` while it keeps going (the client polls); concurrent requests share one run. A list older than `WEB_PLACES_REFRESH_DAYS` (30) is served and refreshed in the background, keeping the old one if the refresh fails. Nothing and a failed pipeline → 503 `PLACES_UNAVAILABLE` (also without `TAVILY_API_KEY`).
- **Pipeline:** `PlaceSearchService` runs four fixed Tavily queries in parallel and one Gemini structured-output call (`thinkingLevel: 'LOW'`); fewer than 3 articles → a LangChain agent (`createAgent` + `search_web`, max 3 searches). A place is kept only if an article mentions it (`web-grounding.ts`). Each is matched with `GooglePlacesService.findPlace` inside the region bbox (`web-place-match.ts`: name similarity ≥ `MATCH_MIN_SIMILARITY`, no category conflict); unmatched places keep the AI's coordinates if they fall inside the region. Matching runs only when `WEB_PLACES_GOOGLE_MATCH=true`. It is off by default: Vietnam is a Google Maps Platform Prohibited Territory and Places returns 403, so new places get AI coordinates. `RegionPlaceStore` saves them as `places.source = 'web'` rows with `location_source` `google` (30-day coordinates) or `ai` (shown as "Vị trí gần đúng").

- **Place search** (`GET /regions/:id/places/search`, `GET /places/google/:googlePlaceId`, `POST /places/google`): matches against `web` rows while typing, Google Text Search only on submit (per-user daily limit, `PLACE_SEARCH_DAILY_LIMIT`), Google results previewed live (Google calls for preview/save have their own per-user limit, `PLACE_DETAILS_DAILY_LIMIT`) and saved as `source = 'google'` rows named by the user (`addToSaved: false` returns the id without adding it to "Muốn đi", for adding a place while planning).

`src/modules/README.md` is the module map and documents these flows and the deliberate PRD deviations. Update it when module responsibilities change.

### Itineraries (F6, F8, F9)
`modules/itineraries` creates a plan in four steps:

1. Candidates: the user's selected places plus extras from the region's list (`region_places`).
2. k-means clusters the candidates into days (`planning/clustering.ts`).
3. Gemini orders the stops (`ai-planner.ts`), and the result is fully re-validated. The AI may only use IDs it was sent, because every itinerary place must exist in the database (FR-6.3).
4. Code sets the times (`planning/scheduler.ts`): meals, rest breaks, opening hours and estimated travel (`travel.ts`; no Google Routes yet).

Other behavior:
- If Gemini fails, a heuristic planner takes over (`planner: 'heuristic'`). `planningMode: 'manual'` leaves the days empty.
- Edits (`PUT /itineraries/:id`) are re-timed by `planning/retime.ts`. That produces advisory warnings such as a long leg, a long day, a missing meal or a closed place. They never block the save.
- `GET /itineraries/:id/alternatives` suggests similar places.
- Party rules, meal windows and typical hours per category are in `planning/rules.ts`.
- Share links (`share-links.*`) expose a read-only public view at `public/itineraries/:token`, rendered by `apps/web` at `/t/:token`. `GET itineraries/:id/share-link` returns the active link to anyone who can view the itinerary (the token is derived from the link id by HMAC, so only its hash is stored); `PUT` gets or creates it without revoking (the app's share path), `POST` rotates it.

### Groups (S8)
`modules/groups`: groups, invite links, roles (owner, editor, viewer), a shared place list and an activity log. An itinerary can be moved into a group with `PATCH /itineraries/:id/group`.

**All permission rules live in `groups/access.ts`** as pure functions; `AccessService` loads the roles and calls into it. Use it for any itinerary or group authorization; don't write ad-hoc ownership checks. A caller who can't view the resource gets 404, not 403, so its existence isn't leaked.

`modules/saved-places` is the per-user "Muốn đi" list. `ranking/` and `realtime/` are placeholders for later PRD features.

### Share-to-app (F4)
`modules/share-import`: `POST /share-imports` takes a shared link or text and returns 202; a background job fetches metadata (`LinkMetadataService`), extracts places with Gemini, and matches each one to a `web` place or Google. The client polls `GET /share-imports/:id` and saves the user's picks with `POST /share-imports/:id/save`. Jobs cap at 30 s; interrupted ones are marked `INTERRUPTED`.

`places` also holds rows with `source = 'google'` (a `google_place_id` plus coordinates that expire after 30 days). The legacy `source = 'osm'` rows and their columns are gone (migration `DropUnusedPlaceColumns`, which refuses to run while any OSM row remains). Google rows are never ranked: anything that lists or suggests places reads the region's `region_places`, never `places` by bbox. Call `PlaceLocationService.ensure` before using Google coordinates (`location_source = 'google'`).

### Home recommendations
`modules/recommendations` (spec `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`) builds `GET /api/recommendations`'s home feed: 3 draft itineraries per (user, 6:00/15:00 window, theme), drawn from a shared `itinerary_drafts` pool built heuristically and upgraded to Gemini only once a draft is viewed or saved enough.
- Only regions with a `ready` place list (`region_place_lists.status`) are eligible; only the scheduled `warm-featured-regions` job is allowed to build a list on demand.
- Jobs run on two BullMQ queues, `recommendations` and `recommendations-ai` (Gemini work, rate-limited separately). `RECOMMENDATIONS_ENABLED=false`, or `NODE_ENV=test` in e2e, runs jobs inline in-process instead, with no cron schedule.
- Region card images come from Unsplash, falling back to an attributed article photo (`region_images.blocked` to unpublish one).
- PRD deviation (FR-6.5): building a draft does not spend the user's AI-generation quota, since the draft pool is shared across users.

Redis is required in dev for the recommendations queue (`pnpm infra:up`); set `RECOMMENDATIONS_ENABLED=false` (see Commands) to run without it.

## Deploy
- `apps/backend/Dockerfile` builds from the repo root.
- `infra/prod/` holds the EC2 + Caddy + Docker Compose setup; see its README.
- Set `SHARE_LINK_SECRET` on the backend host. Without it share-link tokens derive from `JWT_SECRET`, and rotating that makes every existing share link unrecoverable (the next share replaces it).
- The GitHub Actions workflow `.github/workflows/deploy-backend.yml` is currently commented out.
- Home recommendations need Redis: `infra/prod/docker-compose.yml` has no Redis service yet — add one before deploying.

## Other apps
- `apps/web` is Next.js 16 and has breaking changes compared with older versions. Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before editing it.
- `apps/mobile`: follow `apps/mobile/CLAUDE.md`, which says to wrap screens in `<Screen>` and to use `<KeyboardAvoider>` rather than raw `KeyboardAvoidingView`. Its Google Maps keys come from `apps/mobile/.env` at config time.
