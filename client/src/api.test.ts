import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, fetchOpenGame, openRound } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API requests', () => {
    it('sends the host secret as a header rather than in the body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ game: { code: 'LUNCH' } }));
        vi.stubGlobal('fetch', fetchMock);
        await createGame({ title: 'Lunch trivia', adminSecret: 'host-only' });
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/games');
        expect(options.headers['x-trivia-admin']).toBe('host-only');
        expect(JSON.parse(options.body)).toEqual({ title: 'Lunch trivia' });
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('shows server error messages without JSON wrapping', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Invalid host secret' }, { status: 401 })));
        await expect(createGame({ title: 'Lunch', adminSecret: 'wrong' })).rejects.toThrow(/^Invalid host secret$/);
    });

    it('preserves host headers and handles empty successful responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(openRound('LUNCH', 'host-only', 'round-1')).resolves.toBeUndefined();
        expect(fetchMock.mock.calls[0][1].headers).toEqual({
            'Content-Type': 'application/json',
            'x-trivia-admin': 'host-only',
        });
    });

    it('reports an unavailable backend and network failures explicitly', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Server restarting', { status: 502 })));
        await expect(fetchOpenGame()).rejects.toThrow('Server restarting');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disconnected')));
        await expect(fetchOpenGame()).rejects.toThrow('Network disconnected');
    });
});
