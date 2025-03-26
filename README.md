# ربات تلگرام شیوری

این ربات تلگرام برای اشتراک‌گذاری فایل‌ها با تأیید عضویت در کانال طراحی شده است.

## ویژگی‌ها

- اشتراک‌گذاری فایل‌ها در کانال خصوصی
- تأیید عضویت کاربران در کانال عمومی
- ایجاد کلید و لینک مستقیم برای هر فایل
- حذف خودکار فایل‌ها پس از یک دقیقه
- پشتیبانی از انواع مختلف فایل (مستندات، عکس، ویدیو، صدا)

## نصب و راه‌اندازی

1. نصب وابستگی‌ها:

```bash
npm install
```

2. تنظیم متغیرهای محیطی در فایل `wrangler.toml`:

```toml
[vars]
BOT_TOKEN = "توکن بات تلگرام"
PRIVATE_CHANNEL_ID = "شناسه کانال خصوصی"
PUBLIC_CHANNEL_ID = "شناسه کانال عمومی"
PUBLIC_CHANNEL_USERNAME = "نام کاربری کانال عمومی"
```

3. ورود به حساب Cloudflare:

```bash
npx wrangler login
```

4. استقرار روی Cloudflare Workers:

```bash
npm run deploy
```

5. تنظیم وب‌هوک تلگرام:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<YOUR-WORKER-URL>/webhook
```

## توسعه محلی

برای اجرای ربات در محیط محلی:

```bash
npm run dev
```

## نحوه استفاده

1. ارسال فایل به کانال خصوصی
2. ربات به صورت خودکار یک کلید و لینک مستقیم به کپشن فایل اضافه می‌کند
3. کاربران با کلیک روی لینک مستقیم و عضویت در کانال می‌توانند فایل را دریافت کنند
4. فایل‌های ارسال شده پس از یک دقیقه به صورت خودکار حذف می‌شوند

## نکات مهم

- اطمینان حاصل کنید که بات ادمین کانال خصوصی است
- اطمینان حاصل کنید که بات دسترسی لازم برای ویرایش پیام‌ها را دارد
- در صورت خطا در ویرایش کپشن، ربات یک پیام جدید با لینک ارسال می‌کند

## Requirements

- Node.js v12 or higher
- npm
- Telegram Bot Token
- Private and Public Telegram channels

## Security

- The bot verifies channel membership before allowing file downloads
- File keys are randomly generated and case-insensitive
- HTTPS is enforced for API communication

## Error Handling

The bot includes comprehensive error handling for:

- Network issues
- Invalid file keys
- Channel membership verification
- File sending/receiving
- Bot startup/shutdown

## Logging

The bot logs:

- New messages received
- Channel posts
- File information
- Error messages
- Bot startup status
