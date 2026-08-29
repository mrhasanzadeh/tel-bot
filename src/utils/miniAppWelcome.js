const config = require('../../config');
const { getMiniAppBotUsername } = require('./miniAppLinks');

function buildMiniAppWelcomeText() {
    return (
        '❤️ <b>به مینی‌شیوری خوش آمدید!</b>\n\n' +
        'مینی‌اپ رسمی <b>شیوری</b> برای مرور آرشیو انیمه، برنامهٔ پخش هفتگی، لیست شخصی و اعلان قسمت جدید.\n\n' +
        'ℹ️ هنوز در حال توسعه‌ایم — فیچرهای جدید به‌مرور اضافه می‌شوند.\n' +
        'اگر باگی دیدید، از بخش <b>تیکت پشتیبانی</b> داخل مینی‌اپ خبر بدید.\n\n' +
        '⬇️ برای شروع روی دکمهٔ زیر بزنید:'
    );
}

function buildMiniAppWelcomeKeyboard() {
    const miniAppUrl = String(config.MINI_APP_URL ?? '').trim().replace(/\/$/, '');
    const bot = getMiniAppBotUsername();

    if (miniAppUrl) {
        return {
            inline_keyboard: [[{ text: '📥 ورود به مینی‌شیوری', web_app: { url: miniAppUrl } }]]
        };
    }

    return {
        inline_keyboard: [[{ text: '📥 ورود به مینی‌شیوری', url: `https://t.me/${bot}?startapp` }]]
    };
}

module.exports = {
    buildMiniAppWelcomeText,
    buildMiniAppWelcomeKeyboard
};
