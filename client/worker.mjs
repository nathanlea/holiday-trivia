export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== '/api' && !url.pathname.startsWith('/api/') && url.pathname !== '/ws') {
            return env.ASSETS.fetch(request);
        }
        let backend;
        try {
            backend = new URL(env.BACKEND_ORIGIN);
            if (!['https:', 'http:'].includes(backend.protocol) || backend.username || backend.password ||
                backend.pathname !== '/' || backend.search || backend.hash) {
                throw new Error('BACKEND_ORIGIN must be an HTTP(S) origin without a path or credentials');
            }
        } catch (error) {
            console.error('[worker] Invalid backend configuration', error);
            return Response.json({ error: 'Backend is not configured' }, {
                status: 503, headers: { 'Cache-Control': 'no-store' },
            });
        }
        backend.pathname = url.pathname;
        backend.search = url.search;
        try {
            return await fetch(new Request(backend, request), { redirect: 'manual' });
        } catch (error) {
            console.error('[worker] Backend request failed', error);
            return Response.json({ error: 'The game server is temporarily unavailable. Please reconnect.' }, {
                status: 502,
                headers: { 'Cache-Control': 'no-store' },
            });
        }
    },
};
