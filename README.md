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
├── scripts/sql/                   # Postgres schema (files, schedule, bot_settings)
├── .github/workflows/docker-ghcr.yml
└── src/
    ├── index.js                   # Entry point
    ├── handlers/botHandlers.js
    └── services/
        ├── databaseService.js     # Shiori API client (files + packs)
        ├── shioriApiClient.js     # HTTP to api.shiori.cloud
        ├── scheduleDatabaseService.js  # Postgres (schedule scripts only)
        └── ...
```

## Setup

1. `npm install`
2. Copy `deploy/.env.example` → `deploy/.env` and fill values
3. Set `BOT_API_TOKEN` on **api.shiori.cloud** (same value as tel-bot)
4. `npm start`

### Main env vars

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token |
| `SHIORI_API_URL` | Shiori API base URL (e.g. `https://api.shiori.cloud`) |
| `BOT_API_TOKEN` | Shared secret for `x-bot-token` header |
| `PRIVATE_CHANNEL_ID` | Links channel (keys/captions, file storage ref) |
| `LINKS_CHANNEL_ID` | Archive upload channel (copied into private) |
| `ARCHIVE_MIRROR_ENABLED` | Default archive → private copy on boot (`true`/`false`; override with `/mirroring`) |
| `PUBLIC_*` / `ADDITIONAL_*` | Membership channels |
| `PACK_FILE_DELETE_MS` | Pack file auto-delete delay (default `120000`) |

Schedule module is **disabled** when `SHIORI_API_URL` is set (requires direct Postgres). Local schedule import scripts may still use `DATABASE_URL` via devDependency `pg`.

### Premium custom emoji

See `.env.example`. Defaults in `src/config/premiumEmojiDefaults.js`.

## Docker

```bash
cd deploy
cp .env.example .env
docker compose up -d
```

## Schedule posts (TheShioriSub)

1. Run `scripts/sql/schedule_schema.sql` on Postgres
2. `npm run schedule:import-chiramune` — seed Chiramune E01–E13
3. Set `ADMIN_USER_ID` and `PUBLIC_POSTS_CHANNEL_ID` in `.env`
4. Upload mkv + zip to archive → admin gets preview → approve to publish new post
5. **New anime** (no template post yet): after preview, send cover photo to the bot in private chat, then approve
6. Migrations: `schedule_schema_v3_cover_photo.sql`, `v4_pack_info.sql`, etc. if the DB predates those features

## Bot commands (private chat)

- `/start` — welcome / file or pack from deep link
- `/cancel` — stop active pack send
- `/checkchannels` — verify bot access to configured channels
- `/chatid` — reply to a forwarded channel post to see its chat id

## License

MIT
