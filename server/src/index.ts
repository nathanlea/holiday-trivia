import http from 'http';
import { sequelize, initializeDatabase } from './db';
import GameManager from './gameManager';
import { createApp } from './app';
import { setupWebsocket } from './ws';
import { PORT, validateConfig } from './config';

async function bootstrap(): Promise<void> {
    validateConfig();
    await initializeDatabase();
    const manager = new GameManager();
    const server = http.createServer(createApp(manager));
    const wss = setupWebsocket(server, manager);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Trivia server listening on http://localhost:${PORT}`);
    });
    server.on('error', (error) => {
        console.error('[server]', error);
        process.exit(1);
    });

    let stopping = false;
    const shutdown = () => {
        if (stopping) return;
        stopping = true;
        const timeout = setTimeout(() => {
            console.error('[server] shutdown timed out');
            process.exit(1);
        }, 10_000);
        timeout.unref();
        for (const socket of wss.clients) socket.close(1012, 'Server restarting');
        wss.close();
        server.close(() => {
            sequelize.close().then(() => {
                clearTimeout(timeout);
                process.exit(0);
            }).catch((error: unknown) => {
                console.error('[server] database shutdown failed', error);
                process.exit(1);
            });
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

bootstrap().catch((error: unknown) => {
    console.error('[server] failed to start', error);
    process.exit(1);
});
