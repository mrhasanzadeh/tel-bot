# Telegram File Sharing Bot

A modular and robust Telegram bot for sharing files with access control through channel membership verification.

## Features

- **Access Control**: Files are only accessible to users who have joined a specified channel
- **File Tracking**: Each file gets a unique key and direct link for tracking
- **Statistics**: Track download counts and usage patterns
- **Support for Various Media**: Handles documents, photos, videos, audio files
- **Error Handling**: Robust error handling and rate limiting management

## Project Structure

```
├── config.js                 # Configuration variables
├── index.js                  # Main entry point
├── .env                      # Environment variables (private)
└── src
    ├── exports.js            # Module exports
    ├── handlers
    │   └── botHandlers.js    # Bot command and event handlers
    ├── models
    │   └── File.js           # Mongoose model for files
    ├── services
    │   ├── databaseService.js    # Database operations
    │   ├── fileHandlerService.js # File processing operations
    │   └── membershipService.js  # User membership verification
    └── utils
        ├── fileUtils.js      # File-related utility functions
        └── uiUtils.js        # UI-related utility functions
```

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file based on the example below:
   ```
   BOT_TOKEN=your_bot_token
   PRIVATE_CHANNEL_ID=your_private_channel_id
   PUBLIC_CHANNEL_ID=your_public_channel_id
   PUBLIC_CHANNEL_USERNAME=your_public_channel_username
   MONGODB_URI=your_mongodb_connection_string
   ```
4. Start the bot:
   ```
   npm start
   ```

## How It Works

1. Files are posted in a private channel
2. The bot generates a unique key for each file
3. Users must join the public channel to access files
4. File access is tracked for statistics

## Technologies Used

- Node.js
- Telegraf (Telegram Bot Framework)
- MongoDB with Mongoose
- ES6+ JavaScript features

## License

MIT
