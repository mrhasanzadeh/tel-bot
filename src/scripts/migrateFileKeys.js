require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const File = require('../models/File');

async function migrateFileKeys() {
    try {
        console.log('Migration Started: file_keys.json -> MongoDB');
        
        // اتصال به دیتابیس
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/telegrambot';
        console.log('Connecting to MongoDB...');
        
        await mongoose.connect(uri, {
            useNewUrlParser: true, 
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');
        
        // مسیر فایل ذخیره‌سازی کلیدها
        const STORAGE_FILE = path.join(__dirname, '../../file_keys.json');
        
        // بررسی وجود فایل
        if (!fs.existsSync(STORAGE_FILE)) {
            console.log('❌ file_keys.json not found, nothing to migrate');
            process.exit(0);
        }
        
        // خواندن اطلاعات از فایل
        const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        const fileCount = Object.keys(data).length;
        console.log(`📝 Found ${fileCount} files in file_keys.json`);
        
        // انتقال هر فایل به دیتابیس
        let migratedCount = 0;
        let failedCount = 0;
        
        for (const [key, info] of Object.entries(data)) {
            try {
                // بررسی وجود فایل در دیتابیس
                const exists = await File.findOne({ key });
                
                if (exists) {
                    console.log(`⚠️ File with key ${key} already exists in database, skipping`);
                    continue;
                }
                
                const fileData = {
                    key,
                    messageId: info.messageId,
                    type: info.type || 'document',
                    fileId: info.fileId,
                    fileName: info.fileName || 'unknown',
                    fileSize: info.fileSize || 0,
                    date: info.date || Date.now(),
                    isActive: true,
                    downloads: 0
                };
                
                const file = new File(fileData);
                await file.save();
                
                console.log(`✅ Migrated file: ${fileData.fileName} (Key: ${key})`);
                migratedCount++;
            } catch (error) {
                console.error(`❌ Error migrating file with key ${key}:`, error.message);
                failedCount++;
            }
        }
        
        console.log('\n✅ Migration Complete');
        console.log(`📊 Results:`);
        console.log(`- Total Files: ${fileCount}`);
        console.log(`- Migrated: ${migratedCount}`);
        console.log(`- Failed: ${failedCount}`);
        
        // نمایش اطلاعات دیتابیس
        const files = await File.find().sort({ date: -1 }).limit(5);
        console.log('\n📂 Latest Files in Database:');
        files.forEach(file => {
            console.log(`- ${file.fileName} (Key: ${file.key}, Date: ${new Date(file.date).toLocaleString()})`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrateFileKeys(); 