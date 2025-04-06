const { Telegraf } = require('telegraf');
const { setupHandlers } = require('../src/handlers/botHandlers');
const membershipService = require('../src/services/membershipService');
const databaseService = require('../src/services/databaseService');
const config = require('../config');
const https = require('https');

// Validate required environment variables
const requiredEnvVars = [
    'BOT_TOKEN',
    'MONGODB_URI',
    'PRIVATE_CHANNEL_ID',
    'PUBLIC_CHANNEL_ID',
    'PUBLIC_CHANNEL_USERNAME'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Initialize bot with token from config
const bot = new Telegraf(process.env.BOT_TOKEN, {
    telegram: {
        apiRoot: 'https://api.telegram.org'
    }
});

// Set up membership service with bot instance
membershipService.setTelegram(bot);

// Connect to MongoDB
databaseService.connect()
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch(error => {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    });

// Set up bot handlers
setupHandlers(bot);

// Handle errors
bot.catch((error, ctx) => {
    console.error('❌ Bot error:', error);
    console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        description: error.description
    });
    
    if (error.response) {
        console.error('Telegram API Response:', error.response.data);
    }
    
    if (ctx) {
        ctx.reply('متأسفانه خطایی رخ داد. لطفاً دوباره تلاش کنید.')
            .catch(replyError => {
                console.error('❌ Error sending error message:', replyError);
            });
    }
});

// Create HTTPS agent with SSL verification disabled
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    timeout: 60000
});

// Initialize database connection
let isConnecting = false;
let connectionPromise = null;

const ensureDatabaseConnection = async () => {
    if (isConnecting) {
        return connectionPromise;
    }
    
    isConnecting = true;
    connectionPromise = databaseService.connect()
        .catch(error => {
            console.error('❌ Database connection error:', error);
            throw error;
        })
        .finally(() => {
            isConnecting = false;
        });
    
    return connectionPromise;
};

// Initialize webhook
const initializeWebhook = async () => {
    try {
        // Log token presence (not the actual token)
        console.log('🔑 Bot token status:', {
            exists: !!process.env.BOT_TOKEN,
            length: process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0
        });

        // Ensure we have a valid VERCEL_URL
        if (!process.env.VERCEL_URL) {
            throw new Error('VERCEL_URL environment variable is not set');
        }

        const webhookUrl = `https://${process.env.VERCEL_URL}/api/webhook`;
        console.log('🌐 Setting up webhook URL:', webhookUrl);
        
        // First, try to get current webhook info
        console.log('ℹ️ Getting current webhook info...');
        try {
            const currentWebhook = await bot.telegram.getWebhookInfo();
            console.log('Current webhook info:', currentWebhook);
        } catch (infoError) {
            console.error('⚠️ Error getting webhook info:', {
                message: infoError.message,
                description: infoError.description,
                code: infoError.code
            });
        }
        
        // Delete existing webhook
        console.log('🗑️ Deleting existing webhook...');
        try {
            await bot.telegram.deleteWebhook();
            console.log('✅ Successfully deleted existing webhook');
        } catch (deleteError) {
            console.error('⚠️ Error deleting webhook:', {
                message: deleteError.message,
                description: deleteError.description,
                code: deleteError.code
            });
        }
        
        // Set up the new webhook
        console.log('🔄 Setting up new webhook...');
        try {
            const result = await bot.telegram.setWebhook(webhookUrl, {
                agent: httpsAgent,
                max_connections: 40
            });
            console.log('✅ Webhook setup result:', result);
        } catch (setError) {
            console.error('❌ Error setting webhook:', {
                message: setError.message,
                description: setError.description,
                code: setError.code,
                response: setError.response?.data
            });
            throw setError;
        }
        
        // Verify webhook info
        console.log('🔍 Verifying webhook setup...');
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log('ℹ️ Final webhook info:', webhookInfo);
        
        if (!webhookInfo.url || webhookInfo.url !== webhookUrl) {
            throw new Error('Webhook URL verification failed');
        }
        
        console.log('✅ Webhook setup completed successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to setup webhook:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            description: error.description,
            response: error.response?.data
        });
        return false;
    }
};

// Initialize webhook on first request
let webhookInitialized = false;

// Export the webhook handler
module.exports = async (req, res) => {
    try {
        // Log request details for all requests
        console.log('📥 Received request:', {
            method: req.method,
            path: req.url,
            headers: req.headers,
            query: req.query,
            body: req.body,
            rawBody: req.rawBody
        });

        // Handle GET requests (health check)
        if (req.method === 'GET') {
            // Try to initialize webhook if not already initialized
            if (!webhookInitialized) {
                console.log('🔄 Initializing webhook for the first time...');
                const success = await initializeWebhook();
                webhookInitialized = success;
                console.log('✅ Webhook initialization completed:', success);
            }

            return res.status(200).json({
                ok: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                webhook: webhookInitialized ? 'active' : 'inactive',
                path: req.url,
                webhookInitialized
            });
        }

        // Parse body if it's a string
        let update = req.body;
        if (typeof req.body === 'string') {
            try {
                update = JSON.parse(req.body);
            } catch (e) {
                console.error('❌ Failed to parse request body:', e);
                return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
            }
        }

        // Validate request method
        if (req.method !== 'POST') {
            return res.status(405).json({ ok: false, error: 'Method not allowed' });
        }

        // Ensure database connection
        await ensureDatabaseConnection();

        // Process the update
        console.log('🔄 Processing update:', update);
        await bot.handleUpdate(update);

        // Send immediate response
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('❌ Webhook error:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            description: error.description
        });
        
        if (error.response) {
            console.error('Telegram API Response:', error.response.data);
        }
        
        // Send error response
        res.status(500).json({ 
            ok: false, 
            error: 'Internal server error',
            details: error.message
        });
    }
}; 