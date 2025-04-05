// Webhook handler for Vercel
const { Telegraf } = require('telegraf');
const https = require('https');
const config = require('../config');
const databaseService = require('../src/services/databaseService');
const fileHandlerService = require('../src/services/fileHandlerService');
const { setupHandlers } = require('../src/handlers/botHandlers');
const { markMessageDeleted } = require('../src/utils/fileUtils');

// Initialize the bot with the token from config
const bot = new Telegraf(config.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: new https.Agent({
            rejectUnauthorized: false
        })
    }
});

// Connect to database with retry logic
let dbConnected = false;
const connectToDatabase = async () => {
    if (dbConnected) return;
    
    try {
        console.log('🔄 Connecting to database from webhook handler...');
        await databaseService.connect();
        dbConnected = true;
        console.log('✅ Database connected from webhook handler');
    } catch (error) {
        console.error('❌ Failed to connect to database from webhook handler:', error);
        // Don't throw error, just log it and continue
        // The database service will handle retries
    }
};

// Setup all bot handlers
setupHandlers(bot);

// Handle errors
bot.catch((err, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// Export the webhook handler
module.exports = async (req, res) => {
    try {
        // Handle GET requests (health check)
        if (req.method === 'GET') {
            return res.status(200).json({
                ok: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                webhook: 'active',
                path: req.url
            });
        }

        // Only allow POST requests for webhook updates
        if (req.method !== 'POST') {
            return res.status(405).send('Method not allowed');
        }

        // Try to connect to database if not already connected
        if (!dbConnected) {
            await connectToDatabase();
        }

        // Handle webhook request
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error handling webhook update:', error);
        res.status(500).send('Error handling update');
    }
}; 