require('dotenv').config();
const mongoose = require('mongoose');
const File = require('../models/File');

async function setupDatabase() {
    try {
        // اتصال به دیتابیس
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }
        
        console.log('Connecting to MongoDB...');
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');

        // ایجاد ایندکس‌های مورد نیاز
        await File.collection.createIndex({ key: 1 }, { unique: true });
        await File.collection.createIndex({ date: 1 });
        await File.collection.createIndex({ isActive: 1 });

        console.log('✅ Database indexes created successfully');

        // نمایش اطلاعات دیتابیس
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log('\n📊 Database Collections:');
        collections.forEach(collection => {
            console.log(`- ${collection.name}`);
        });

        console.log('\n✅ Database setup completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database setup failed:', error);
        process.exit(1);
    }
}

setupDatabase(); 