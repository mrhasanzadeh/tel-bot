const { createClient } = require('@supabase/supabase-js');

let client = null;

const getSupabase = () => {
    if (client) return client;

    const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim();
    const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            'Schedule DB requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
                'File storage uses DATABASE_URL (Postgres).'
        );
    }

    client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
    });

    return client;
};

/** Proxy so scheduleDatabaseService keeps `supabase.from(...)` syntax. */
module.exports = new Proxy(
    {},
    {
        get(_target, prop) {
            const value = getSupabase()[prop];
            return typeof value === 'function' ? value.bind(getSupabase()) : value;
        },
    }
);

module.exports.getSupabase = getSupabase;
module.exports.isScheduleDbConfigured = () =>
    Boolean(String(process.env.SUPABASE_URL ?? '').trim() &&
        String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim());
