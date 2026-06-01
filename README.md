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
3. `npm start`

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

## Bot commands (private chat)

- `/start` — welcome / file or pack from deep link
- `/cancel` — stop active pack send
- `/checkchannels` — verify bot access to configured channels
- `/chatid` — reply to a forwarded channel post to see its chat id

## License

MIT
