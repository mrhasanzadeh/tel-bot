require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    PRIVATE_CHANNEL_ID: process.env.PRIVATE_CHANNEL_ID,
    PUBLIC_CHANNEL_ID: process.env.PUBLIC_CHANNEL_ID,
    PUBLIC_CHANNEL_USERNAME: process.env.PUBLIC_CHANNEL_USERNAME
};
