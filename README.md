# Telegram File Sharing Bot

Telegram bot for sharing files with channel membership verification, pack downloads, and archive → links channel mirroring.

## Features

- Membership check on two public channels before file/pack delivery
- Unique file keys and direct `t.me` links
- File packs with cancellable batch send
- Archive channel upload → copy to private links channel (no forward label)
- Toggle archive mirroring via `/mirroring` (admin) or `ARCHIVE_MIRROR_ENABLED` in `.env`
- Premium custom emoji support (optional)
- Docker + GHCR deploy with Watchtower

## Project structure

```
├── config.js                      # Shared env config
├── Dockerfile
├── deploy/
│   ├── docker-compose.yml
│   └── .env.example
├── .github/workflows/docker-ghcr.yml
└── src/
    ├── index.js                   # Entry point
    ├── config/
    │   └── premiumEmojiDefaults.js
    ├── handlers/
    │   └── botHandlers.js         # All bot commands & events
    ├── services/
    │   ├── channelIntake.js       # Route channel/supergroup file posts
    │   ├── channelSetup.js        # Startup channel checks
    │   ├── channelDiagnostics.js
    │   ├── databaseService.js     # Postgres (files + packs)
    │   ├── postgresClient.js      # DATABASE_URL pool
    │   ├── scheduleDatabaseService.js  # Supabase (schedule only)
    │   ├── fileHandlerService.js  # Files, packs, captions, archive copy
    │   ├── membershipService.js
    │   └── supabaseClient.js      # Schedule DB (optional)
    ├── scripts/                   # One-off migrations (Mongo → Supabase)
    └── utils/
        ├── botReply.js
        ├── channelIds.js
        ├── fileUtils.js
        └── premiumEmoji.js
```

## Setup

1. `npm install`
2. Copy `deploy/.env.example` → `deploy/.env` and fill values
3. Apply `scripts/sql/bot_files_columns.sql` on main Postgres (if not done during merge)
4. Apply `supabase/bot_settings_schema.sql` on main Postgres (runtime toggles for `/mirroring`)
5. For schedule: run SQL in Supabase (`supabase/schedule_schema.sql`, …)
6. `npm install && npm start`

### Main env vars

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | **Main Postgres** — files, packs (same DB as shiori-api) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | **Optional** — schedule features only |
| `PRIVATE_CHANNEL_ID` | Links channel (keys/captions, file storage ref) |
| `LINKS_CHANNEL_ID` | Archive upload channel (copied into private) |
| `ARCHIVE_MIRROR_ENABLED` | Default archive → private copy on boot (`true`/`false`; override with `/mirroring`) |
| `PUBLIC_*` / `ADDITIONAL_*` | Membership channels |
| `PACK_FILE_DELETE_MS` | Pack file auto-delete delay (default `120000`) |

### Migrating from Supabase file storage

1. Merge historical data into main Postgres (one-off SQL or `npm run merge:supabase-to-main`)
2. Set `DATABASE_URL` in `deploy/.env` (reachable from tel-bot container — not `localhost` if Postgres is in another container)
3. Redeploy tel-bot
4. Optional: run `merge:supabase-to-main` once more to catch stragglers written during cutover

Example `DATABASE_URL` when Postgres runs in Docker on the same host as tel-bot:

```env
DATABASE_URL=postgresql://shiori:PASSWORD@172.17.0.1:5432/shiori
```

Or join both containers to the same Docker network and use hostname `shiori-postgres`.

### Premium custom emoji

See `.env.example`. Defaults in `src/config/premiumEmojiDefaults.js`.

## Docker

```bash
cd deploy
cp .env.example .env
docker compose up -d
```

## Schedule posts (TheShioriSub)

1. Run `supabase/schedule_schema.sql` in Supabase SQL editor
2. `npm run schedule:import-chiramune` — seed Chiramune E01–E13
3. Set `ADMIN_USER_ID` and `PUBLIC_POSTS_CHANNEL_ID` in `.env`
4. Upload mkv + zip to archive → admin gets preview → approve to publish new post
5. **New anime** (no template post yet): after preview, send cover photo to the bot in private chat, then approve
6. Migrations: `schedule_schema_v3_cover_photo.sql`, `v4_pack_info.sql`, `v5_idempotency.sql` if the DB predates those features

## Bot commands (private chat)

- `/start` — welcome / file or pack from deep link
- `/cancel` — stop active pack send
- `/checkchannels` — verify bot access to configured channels
- `/chatid` — reply to a forwarded channel post to see its chat id

## License

MIT
