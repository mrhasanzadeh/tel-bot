const express = require('express');
const { Telegraf } = require('telegraf');
const { setupHandlers } = require('../src/handlers/botHandlers');
const membershipService = require('../src/services/membershipService');
const databaseService = require('../src/services/databaseService');
const config = require('../config');
const https = require('https');

// Create Express app
const app = express();
app.use(express.json());

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

// Initialize webhook
const initializeWebhook = async () => {
    try {
        // Get the webhook URL from Render
        const webhookUrl = process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL}/webhook`
            : `https://${process.env.RENDER_SERVICE_NAME}.onrender.com/webhook`;
            
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

// Webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        // Log request details
        console.log('📥 Received webhook request:', {
            method: req.method,
            path: req.url,
            headers: req.headers,
            body: req.body
        });

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

        // Handle the update
        await bot.handleUpdate(update);
        res.json({ ok: true });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Health check endpoint
app.get('/webhook', async (req, res) => {
    try {
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
    } catch (error) {
        console.error('❌ Health check error:', error);
        res.status(500).json({
            ok: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Root endpoint for health check
app.get('/', (req, res) => {
    res.json({
        ok: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log('🌐 Webhook URL:', process.env.RENDER_EXTERNAL_URL 
        ? `${process.env.RENDER_EXTERNAL_URL}/webhook`
        : `https://${process.env.RENDER_SERVICE_NAME}.onrender.com/webhook`);
}); 