import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('serves frontend routes through the SPA asset binding', async () => {
    const response = await worker.fetch(new Request('https://trivia.example/gamemaster/submissions'), {
        ASSETS: { fetch: async () => new Response('SPA') },
    });
    assert.equal(await response.text(), 'SPA');
});

test('proxies API path, query, method, body and host header without redirects', async () => {
    globalThis.fetch = async (request, init) => {
        assert.equal(request.url, 'https://backend.example/api/games?test=1');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('x-trivia-admin'), 'test-host-secret');
        assert.equal(request.headers.get('origin'), 'https://trivia.example');
        assert.equal(await request.text(), '{"title":"Lunch"}');
        assert.equal(init.redirect, 'manual');
        return Response.json({ created: true }, { status: 201 });
    };
    const response = await worker.fetch(new Request('https://trivia.example/api/games?test=1', {
        method: 'POST', headers: { 'x-trivia-admin': 'test-host-secret', Origin: 'https://trivia.example' }, body: '{"title":"Lunch"}',
    }), { BACKEND_ORIGIN: 'https://backend.example' });
    assert.equal(response.status, 201);
});

test('passes WebSocket upgrade request and response through unchanged', async () => {
    const upgradeResponse = { status: 101, webSocket: {} };
    globalThis.fetch = async (request) => {
        assert.equal(request.url, 'https://backend.example/ws');
        assert.equal(request.headers.get('upgrade'), 'websocket');
        return upgradeResponse;
    };
    assert.equal(await worker.fetch(new Request('https://trivia.example/ws', {
        headers: { Upgrade: 'websocket' },
    }), { BACKEND_ORIGIN: 'https://backend.example' }), upgradeResponse);
});

test('does not treat API failures as successful SPA HTML', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    const response = await worker.fetch(new Request('https://trivia.example/api/health'), {
        BACKEND_ORIGIN: 'https://backend.example',
    });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match((await response.json()).error, /unavailable/);
});

test('rejects invalid backend configuration', async () => {
    const response = await worker.fetch(new Request('https://trivia.example/api/health'), {
        BACKEND_ORIGIN: 'https://backend.example/some/path',
    });
    assert.equal(response.status, 503);
});
