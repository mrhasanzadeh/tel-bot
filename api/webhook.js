const bot = require('./index');

module.exports = async (req, res) => {
    try {
        // Handle Telegram webhook
        await bot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error in webhook handler:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
}; 