import { Buffer } from 'buffer';
import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import GameManager, { ConnectedClient } from './gameManager';
import { isAllowedOrigin, WS_PATH } from './config';
import { ClientToServerMessage } from '../../shared/types';
import { HttpError } from './errors';

function toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data);
    }
    if (typeof data === 'string') {
        return Buffer.from(data, 'utf-8');
    }
    return Buffer.from(data);
}

function parseMessage(data: RawData): ClientToServerMessage | null {
    try {
        const text = toBuffer(data).toString('utf-8');
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
            return null;
        }
        return payload as ClientToServerMessage;
    } catch (error) {
        return null;
    }
}

export function setupWebsocket(server: HttpServer, manager: GameManager): WebSocketServer {
    const wss = new WebSocketServer({
        server,
        path: WS_PATH,
        maxPayload: 16 * 1024,
        verifyClient: ({ origin }: { origin: string }) => isAllowedOrigin(origin),
    });

    wss.on('connection', (socket: WebSocket) => {
        let client: ConnectedClient | null = null;
        let authenticating = false;
        let alive = true;
        const authTimeout = setTimeout(() => socket.close(1008, 'Authentication timed out'), 10_000);
        const heartbeat = setInterval(() => {
            if (!alive) {
                socket.terminate();
                return;
            }
            alive = false;
            socket.ping();
        }, 30_000);
        socket.on('pong', () => { alive = true; });

        socket.on('message', async (raw: RawData) => {
            const message = parseMessage(raw);
            if (!message) {
                socket.send(JSON.stringify({ type: 'error', message: 'Invalid message payload' }));
                return;
            }

            if (message.type === 'hello') {
                if (client || authenticating) {
                    socket.close(1008, 'Already authenticated');
                    return;
                }
                authenticating = true;
                try {
                    if (!message.payload || typeof message.payload.gameCode !== 'string' ||
                        !['team', 'gamemaster', 'scoreboard'].includes(message.payload.role)) {
                        throw new HttpError(400, 'Invalid hello payload');
                    }
                    client = await manager.registerClient(socket, message.payload.role, message.payload.gameCode, {
                        teamId: message.payload.teamId,
                        teamToken: message.payload.teamToken,
                        adminSecret: message.payload.adminSecret,
                    });
                    clearTimeout(authTimeout);
                    if (socket.readyState !== WebSocket.OPEN) {
                        manager.unregisterClient(client);
                        client = null;
                    }
                } catch (error) {
                    const err = error as Error;
                    const messageText = err instanceof HttpError ? err.message : 'Unable to authenticate WebSocket connection';
                    if (!(error instanceof HttpError)) console.error('[ws] authentication failed', error);
                    socket.send(JSON.stringify({ type: 'error', message: messageText }));
                    socket.close(1008, 'Unauthorized');
                }
                return;
            }

            if (!client) {
                socket.send(JSON.stringify({ type: 'error', message: 'Please authenticate first' }));
                return;
            }

            if (message.type === 'ping') {
                socket.send(JSON.stringify({ type: 'pong' }));
            }
        });

        socket.on('close', () => {
            clearTimeout(authTimeout);
            clearInterval(heartbeat);
            if (client) {
                manager.unregisterClient(client);
                client = null;
            }
        });

        socket.on('error', (error: Error) => {
            console.error('[ws]', error);
            if (client) {
                manager.unregisterClient(client);
                client = null;
            }
        });
    });
    return wss;
}
