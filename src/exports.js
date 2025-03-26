/**
 * Main module exports for the Telegram bot
 */

const databaseService = require('./services/databaseService');
const fileHandlerService = require('./services/fileHandlerService');
const membershipService = require('./services/membershipService');
const { setupHandlers } = require('./handlers/botHandlers');
const fileUtils = require('./utils/fileUtils');
const uiUtils = require('./utils/uiUtils');

module.exports = {
    services: {
        databaseService,
        fileHandlerService,
        membershipService
    },
    handlers: {
        setupHandlers
    },
    utils: {
        fileUtils,
        uiUtils
    }
}; 