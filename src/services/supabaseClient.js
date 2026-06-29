const { createClient } = require('@supabase/supabase-js');

let client = null;

const isScheduleDbConfigured = () =>
    Boolean(
        String(process.env.SUPABASE_URL ?? '').trim() &&
            String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
    );

const getSupabase = () => {
    if (client) return client;

    if (!isScheduleDbConfigured()) {
        throw new Error(
            'Schedule DB requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
                'File storage uses DATABASE_URL (Postgres).'
        );
    }

    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    return client;
};

/** Proxy so scheduleDatabaseService keeps `supabase.from(...)` syntax. */
const supabase = new Proxy(
    {},
    {
        get(_target, prop) {
            if (prop === 'getSupabase') return getSupabase;
            if (prop === 'isScheduleDbConfigured') return isScheduleDbConfigured;

            const value = getSupabase()[prop];
            return typeof value === 'function' ? value.bind(getSupabase()) : value;
        },
    }
);

module.exports = supabase;
module.exports.getSupabase = getSupabase;
module.exports.isScheduleDbConfigured = isScheduleDbConfigured;
