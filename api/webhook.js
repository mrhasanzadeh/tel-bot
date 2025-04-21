const { Telegraf } = require('telegraf');
const config = require('../src/config');
const { connectToDatabase } = require('../src/database');
const { setupHandlers } = require('../src/handlers/botHandlers');
const { membershipService } = require('../src/services/membershipService');

const bot = new Telegraf(config.BOT_TOKEN, {
  telegram: {
    apiRoot: 'https://api.telegram.org'
  }
});

let webhookInitialized = false;

async function initializeWebhook() {
  try {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error('WEBHOOK_URL environment variable is not set');
    }

    // Delete existing webhook
    try {
      await bot.telegram.deleteWebhook();
      console.log('Existing webhook deleted successfully');
    } catch (error) {
      console.log('No existing webhook to delete or error:', error.message);
    }

    // Set up new webhook
    const webhookInfo = await bot.telegram.setWebhook(webhookUrl, {
      max_connections: 100,
      allowed_updates: ['message', 'channel_post', 'callback_query']
    });

    console.log('Webhook set successfully:', webhookInfo);
    return true;
  } catch (error) {
    console.error('Error setting webhook:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      description: error.description,
      response: error.response
    });
    return false;
  }
}

// Initialize database connection
connectToDatabase()
  .then(() => {
    console.log('Database connected successfully');
  })
  .catch((error) => {
    console.error('Database connection error:', error);
  });

// Set up bot handlers
setupHandlers(bot);
membershipService.setTelegram(bot.telegram);

// Webhook handler
module.exports = async (req, res) => {
  try {
    // Log request details
    console.log('Incoming request:', {
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: req.body
    });

    // Initialize webhook on first request if not already done
    if (!webhookInitialized) {
      webhookInitialized = await initializeWebhook();
      if (!webhookInitialized) {
        return res.status(500).json({ error: 'Failed to initialize webhook' });
      }
    }

    // Handle GET request for webhook verification
    if (req.method === 'GET') {
      return res.status(200).json({
        status: webhookInitialized ? 'active' : 'inactive',
        message: 'Telegram bot webhook endpoint'
      });
    }

    // Handle POST request (Telegram updates)
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
      return;
    }

    // Handle other methods
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 