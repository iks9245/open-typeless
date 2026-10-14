# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

| Concern | Choice |
|---|---|
| Engine | SQLite via `better-sqlite3` (v13, N-API prebuilds; loads under both Node and Electron without rebuild) |
| ORM / migrations | `drizzle-orm` + `drizzle-kit` |
| Validation | `zod` at every boundary (IPC input, stored settings values) |
| Location | `app.getPath('userData')/open-typeless.db`; audio files under `userData/audio/` |
| Access | **Main process only.** Renderers go through IPC (`history:*`, `settings:*`) |

Code layout:

```
src/main/db/
  client.ts     # openDatabase, singleton, closeDatabase
  schema.ts     # all tables
  migrate.ts    # runMigrations, resolveMigrationsFolder (dev vs packaged)
  init.ts       # initDatabase: open + migrate, degrade on failure
drizzle/        # generated SQL migrations (committed, shipped as extraResource)
```

Startup (`src/main.ts`): `initDatabase()` → `historyService.recover()` → `historyService.prune()` on `app.ready`, before windows are created. `closeDatabase()` runs in `cleanup()`.

---

## Query Patterns

- **Procedures are pure functions that take `db: AppDatabase` first**, plus explicit dependencies (`now`, `audioDir`, settings). Facades in `services/<domain>/index.ts` bind `getDb()`, `Date.now` and Electron paths. This keeps procedures testable against `:memory:` without Electron.
- **Never call `app.getPath()` at module load.** Resolve Electron paths lazily inside the facade.
- **Multi-row writes go in `db.transaction(...)`**; helpers inside a transaction throw on failure (see `error-handling.md`).
- **Guard state transitions in the `WHERE` clause**, not with a read-then-write. Example: completing a session only updates rows whose status is still `recording`/`processing`.
- **Paginate with keyset cursors** on `(created_at, id)`, never `OFFSET`. The `id` tie-breaker is required: several rows can share a millisecond.
- **Escape `LIKE` input** (`\`, `%`, `_`) and use `ESCAPE '\'`.
- **Renderer DTOs are explicit projections.** Never return a raw row: internal fields such as `audio_path` and `meta` must not reach the renderer.

### Recording calls must not affect dictation

`historyService.begin / markProcessing / complete / fail / markInserted` are best effort: they never throw, never block text insertion, and are no-ops when the database is unavailable or `history.enabled` is false. Write history **after** inserting text.

Maintenance (`recover`, `prune`) runs whenever the database is available, **even if history is disabled**, so interrupted rows terminate and retention is honored.

---

## Migrations

1. Edit `src/main/db/schema.ts`.
2. Run `pnpm db:generate` (drizzle-kit writes `drizzle/NNNN_*.sql` and `drizzle/meta/`).
3. Review the generated SQL, then commit it together with the schema change.
4. Migrations run automatically at startup; already-applied migrations are skipped.

Rules:

- Never edit a migration that has been released. Add a new one.
- Never edit `drizzle/meta/` by hand.
- Features drizzle cannot model (e.g. FTS5 virtual tables, triggers) go in a hand-written migration created with `drizzle-kit generate --custom`.
- Packaged builds read migrations from `process.resourcesPath/drizzle` (`forge.config.ts` → `packagerConfig.extraResource`). Verify with `pnpm package`, not only `pnpm start`.

---

## Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Table | plural snake_case | `transcriptions`, `settings` |
| Column | snake_case in SQL, camelCase in TS | `created_at` ↔ `createdAt` |
| Index | `idx_<table>_<columns>` | `idx_transcriptions_status_created_at` |
| Primary key | `id text`, uuid v7 (time-ordered) | |
| Timestamps | `integer`, Unix epoch **milliseconds** | `created_at`, `updated_at` |
| Enumerated text | values defined once in `src/shared/constants/*` and used by schema and zod | `TRANSCRIPTION_STATUSES` |
| Volatile metadata | one JSON `text` column (`{ mode: 'json' }`) instead of many nullable columns | `meta` |
| Settings | one row per dotted key, only user overrides stored | `history.saveAudio` |
| File paths | store paths **relative** to their base directory | `audio_path = 2026/10/<id>.wav` |

---

## Common Mistakes

| Mistake | Consequence | Do instead |
|---|---|---|
| Leaving the connection open after a failed migration | `isDatabaseAvailable()` reports true while tables are missing | `initDatabase()` closes the connection on any failure |
| Relying on drizzle `enum` for integrity | It is TypeScript-only; SQLite stores any text | Write only through services that validate with zod |
| Storing audio or large blobs in SQLite | Database growth and slow backups | Write files under `userData/audio`, store the relative path |
| Assuming a native module that works in `pnpm start` works when packaged | App crashes at launch (see `shared/native-module-packaging.md`) | Keep `better-sqlite3` in Vite `external` and Forge `nativeModules`; test `pnpm package` |
| Gating maintenance on `history.enabled` | Retention stops and interrupted rows never terminate | Run `recover`/`prune` whenever storage is available |
| Exposing internal columns to the renderer | Leaks filesystem paths and metadata | Map rows to DTOs (`toTranscriptionItem`) |

### Testing

`better-sqlite3` v13 loads in plain Node, so procedures can be tested with `openDatabase(':memory:')` + `runMigrations(db, '<repo>/drizzle')`. Code that needs Electron APIs (`app.getVersion()`, `app.getPath()`) must run in a real Electron main process with `app.setPath('userData', <temp dir>)` so tests never touch real user data.
