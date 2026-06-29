const { Pool } = require('pg');

let pool = null;

const getConnectionString = () => String(process.env.DATABASE_URL ?? '').trim();

const getPool = () => {
    if (pool) return pool;

    const connectionString = getConnectionString();
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    const useSsl = process.env.DATABASE_SSL === '1' || process.env.DATABASE_SSL === 'true';

    pool = new Pool({
        connectionString,
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 15_000),
        ssl: useSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined,
    });

    pool.on('error', (err) => {
        console.error('❌ Postgres pool error:', err);
    });

    return pool;
};

const query = (text, params) => getPool().query(text, params);

module.exports = {
    getPool,
    query,
};
