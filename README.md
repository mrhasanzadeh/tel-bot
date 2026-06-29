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
        ├── databaseService.js     # Postgres (files + packs)
        ├── postgresClient.js      # DATABASE_URL pool
        ├── scheduleDatabaseService.js  # Postgres (schedule)
        └── ...
```

## Setup

1. `npm install`
2. Copy `deploy/.env.example` → `deploy/.env` and fill values
3. Apply `scripts/sql/files_schema.sql` and `scripts/sql/bot_settings_schema.sql` on Postgres
4. For schedule: run `scripts/sql/schedule_schema.sql` and versioned migrations (`schedule_schema_v*.sql`) as needed
5. `npm start`

### Main env vars

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | Postgres — files, packs, schedule (same DB as shiori-api or dedicated) |
| `PRIVATE_CHANNEL_ID` | Links channel (keys/captions, file storage ref) |
| `LINKS_CHANNEL_ID` | Archive upload channel (copied into private) |
| `ARCHIVE_MIRROR_ENABLED` | Default archive → private copy on boot (`true`/`false`; override with `/mirroring`) |
| `PUBLIC_*` / `ADDITIONAL_*` | Membership channels |
| `PACK_FILE_DELETE_MS` | Pack file auto-delete delay (default `120000`) |

Example `DATABASE_URL` when Postgres runs in Docker on the same host as tel-bot:

```env
DATABASE_URL=postgresql://shiori:PASSWORD@172.17.0.1:5432/shiori
```

Or join both containers to the same Docker network and use the Postgres service hostname.

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
