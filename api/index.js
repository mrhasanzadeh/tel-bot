// Root API handler for Vercel
const { Telegraf } = require('telegraf');
const https = require('https');
const config = require('../config');
const databaseService = require('../src/services/databaseService');

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
        console.log('🔄 Connecting to database from root handler...');
        await databaseService.connect();
        dbConnected = true;
        console.log('✅ Database connected from root handler');
    } catch (error) {
        console.error('❌ Failed to connect to database from root handler:', error);
        // Don't throw error, just log it and continue
        // The database service will handle retries
    }
};

// Export the handler
module.exports = async (req, res) => {
    try {
        // Try to connect to database if not already connected
        if (!dbConnected) {
            await connectToDatabase();
        }

        // Get bot info
        const botInfo = await bot.telegram.getMe();
        
        // Get webhook info
        const webhookInfo = await bot.telegram.getWebhookInfo();
        
        // Return status information
        return res.status(200).json({
            ok: true,
            status: 'active',
            timestamp: new Date().toISOString(),
            bot: {
                id: botInfo.id,
                username: botInfo.username,
                first_name: botInfo.first_name,
                can_join_groups: botInfo.can_join_groups,
                can_read_all_group_messages: botInfo.can_read_all_group_messages,
                supports_inline_queries: botInfo.supports_inline_queries
            },
            webhook: webhookInfo,
            database: {
                connected: dbConnected
            },
            endpoints: {
                webhook: '/api/webhook',
                setup: '/api/setup-webhook'
            }
        });
    } catch (error) {
        console.error('Error in root handler:', error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}; 