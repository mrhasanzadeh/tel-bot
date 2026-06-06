# Telegram File Sharing Bot

Telegram bot for sharing files with channel membership verification, pack downloads, and archive → links channel mirroring.

## Features

- Membership check on two public channels before file/pack delivery
- Unique file keys and direct `t.me` links
- File packs with cancellable batch send
- Archive channel upload → copy to private links channel (no forward label)
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
    │   ├── databaseService.js     # Supabase
    │   ├── fileHandlerService.js  # Files, packs, captions, archive copy
    │   ├── membershipService.js
    │   └── supabaseClient.js
    ├── scripts/                   # One-off migrations (Mongo → Supabase)
    └── utils/
        ├── botReply.js
        ├── channelIds.js
        ├── fileUtils.js
        └── premiumEmoji.js
```

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill values (see `deploy/.env.example` for production)
3. Run SQL in Supabase: `supabase/files_schema.sql`, then `supabase/schedule_schema.sql` (+ v3–v5 migrations if upgrading)
4. `npm start`

### Main env vars

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token |
| `PRIVATE_CHANNEL_ID` | Links channel (keys/captions, file storage ref) |
| `LINKS_CHANNEL_ID` | Archive upload channel (copied into private) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Database |
| `PUBLIC_*` / `ADDITIONAL_*` | Membership channels |
| `PACK_FILE_DELETE_MS` | Pack file auto-delete delay (default `120000`) |

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
