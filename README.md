# Telegram File Sharing Bot

A Telegram bot that allows users to share files through a private channel and retrieve them using unique keys.

## Features

- File sharing through private channel
- File retrieval using unique 6-digit keys
- Channel membership verification
- File size formatting
- Comprehensive logging
- Error handling

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd tel-bot
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with the following variables:

```
BOT_TOKEN=your_bot_token
PRIVATE_CHANNEL_ID=your_private_channel_id
PUBLIC_CHANNEL_ID=your_public_channel_id
PUBLIC_CHANNEL_USERNAME=your_public_channel_username
```

## Usage

1. Start the bot:

```bash
node index.js
```

2. Add the bot to your private channel as an administrator
3. Send files to the private channel
4. The bot will generate a unique 6-digit key for each file
5. Users can retrieve files by:
   - Using the /start command with the file key
   - Sending the file key directly to the bot

## Requirements

- Node.js v12 or higher
- npm
- Telegram Bot Token
- Private and Public Telegram channels

## Security

- The bot verifies channel membership before allowing file downloads
- File keys are randomly generated and case-insensitive
- HTTPS is enforced for API communication

## Error Handling

The bot includes comprehensive error handling for:

- Network issues
- Invalid file keys
- Channel membership verification
- File sending/receiving
- Bot startup/shutdown

## Logging

The bot logs:

- New messages received
- Channel posts
- File information
- Error messages
- Bot startup status
