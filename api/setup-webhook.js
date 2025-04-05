// Setup webhook for Telegram bot
const { Telegraf } = require('telegraf');
const https = require('https');
const config = require('../config');
const databaseService = require('../src/services/databaseService');

// Create HTTPS agent with SSL verification disabled
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: 60000
});

// Initialize bot
const bot = new Telegraf(config.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        agent: httpsAgent
    }
});

// Connect to database with retry logic
let dbConnected = false;
const connectToDatabase = async () => {
    if (dbConnected) return;
    
    try {
        console.log('🔄 Connecting to database from setup-webhook handler...');
        await databaseService.connect();
        dbConnected = true;
        console.log('✅ Database connected from setup-webhook handler');
    } catch (error) {
        console.error('❌ Failed to connect to database from setup-webhook handler:', error);
        // Don't throw error, just log it and continue
        // The database service will handle retries
    }
};

// Initialize webhook
const initializeWebhook = async () => {
    try {
        // Ensure we have a valid VERCEL_URL
        if (!process.env.VERCEL_URL) {
            throw new Error('VERCEL_URL environment variable is not set');
        }

        const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhook`;
        console.log('🌐 Setting up webhook URL:', webhookUrl);
        
        // First, delete any existing webhook
        console.log('🗑️ Deleting existing webhook...');
        await bot.telegram.deleteWebhook();
        
        // Then set up the new webhook
        console.log('🔄 Setting up new webhook...');
        const result = await bot.telegram.setWebhook(webhookUrl, {
            agent: httpsAgent
        });
        
        console.log('✅ Webhook setup result:', result);

        // Verify webhook info
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log('ℹ️ Webhook info:', webhookInfo);
        
        if (!webhookInfo.url || webhookInfo.url !== webhookUrl) {
            throw new Error('Webhook URL verification failed');
        }
        
        console.log('✅ Webhook setup completed successfully');
        return { success: true, webhookUrl };
    } catch (error) {
        console.error('❌ Failed to setup webhook:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        return { success: false, error: error.message };
    }
};

// Export the handler
module.exports = async (req, res) => {
    try {
        // Handle GET requests (status check)
        if (req.method === 'GET') {
            try {
                // Get webhook info
                const webhookInfo = await bot.telegram.getWebhookInfo();
                
                return res.status(200).json({
                    ok: true,
                    status: 'active',
                    timestamp: new Date().toISOString(),
                    webhook: webhookInfo,
                    path: req.url
                });
            } catch (error) {
                console.error('Error getting webhook info:', error);
                return res.status(200).json({
                    ok: true,
                    status: 'active',
                    timestamp: new Date().toISOString(),
                    webhook: 'error',
                    error: error.message,
                    path: req.url
                });
            }
        }

        // Only allow POST requests for webhook setup
        if (req.method !== 'POST') {
            return res.status(405).send('Method not allowed');
        }

        // Try to connect to database if not already connected
        if (!dbConnected) {
            await connectToDatabase();
        }

        // Initialize webhook
        const result = await initializeWebhook();
        
        if (result.success) {
            res.status(200).json({
                ok: true,
                message: 'Webhook setup successful',
                webhookUrl: result.webhookUrl
            });
        } else {
            res.status(500).json({
                ok: false,
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error in setup-webhook handler:', error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}; 