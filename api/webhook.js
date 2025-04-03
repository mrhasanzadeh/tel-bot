const bot = require('./server');
const databaseService = require('../src/services/databaseService');
const config = require('../config');
const https = require('https');

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
    } catch (error) {
        console.error('❌ Failed to setup webhook:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        throw error;
    }
};

// Initialize webhook on first request
let webhookInitialized = false;

module.exports = async (req, res) => {
    try {
        // Initialize webhook on first request
        if (!webhookInitialized) {
            console.log('🔄 Initializing webhook for the first time...');
            await initializeWebhook();
            webhookInitialized = true;
            console.log('✅ Webhook initialization completed');
        }

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
            return res.status(200).json({
                ok: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                webhook: 'active',
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
            console.warn('⚠️ Invalid request method:', req.method);
            return res.status(405).json({ ok: false, error: 'Method not allowed' });
        }

        // Validate request body
        if (!update) {
            console.warn('⚠️ No request body received');
            return res.status(400).json({ ok: false, error: 'No request body' });
        }

        // Log the update type
        const updateType = Object.keys(update).find(key => key !== 'update_id');
        console.log('📝 Processing update type:', updateType, 'Update:', JSON.stringify(update, null, 2));

        // Ensure database connection before processing update
        await ensureDatabaseConnection();

        // Handle Telegram webhook
        console.log('🔄 Processing Telegram update...');
        await bot.handleUpdate(update);
        console.log('✅ Successfully processed update');
        
        res.status(200).json({ ok: true });
    } catch (error) {
        // Log detailed error information
        console.error('❌ Error in webhook handler:', {
            message: error.message,
            stack: error.stack,
            update: req.body,
            error: error,
            type: error.name,
            code: error.code
        });
        
        // Send a more detailed error response
        res.status(500).json({ 
            ok: false, 
            error: error.message,
            type: error.name,
            code: error.code,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}; 