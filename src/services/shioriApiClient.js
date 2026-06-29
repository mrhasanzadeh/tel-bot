const getBaseUrl = () => String(process.env.SHIORI_API_URL ?? '').trim().replace(/\/$/, '');
const getToken = () => String(process.env.BOT_API_TOKEN ?? '').trim();

/**
 * HTTP client for api.shiori.cloud bot endpoints.
 * Returns parsed JSON, or null on 404.
 */
async function request(method, path, body) {
    const base = getBaseUrl();
    const token = getToken();
    if (!base) {
        throw new Error('SHIORI_API_URL is not set');
    }
    if (!token) {
        throw new Error('BOT_API_TOKEN is not set');
    }

    const url = `${base}/api/v1${path}`;
    const options = {
        method,
        headers: {
            'x-bot-token': token
        }
    };

    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    if (res.status === 404) {
        return null;
    }

    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Shiori API ${res.status}: ${text.slice(0, 500)}`);
    }

    if (!text) {
        return null;
    }

    return JSON.parse(text);
}

module.exports = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    ping: () => request('GET', '/bot/health')
};
