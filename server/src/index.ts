import path from 'path';
import fs from 'fs';
import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { MAX_IMPORT_SIZE_BYTES, PORT } from './config';
import { initializeDatabase } from './db';
import GameManager from './gameManager';
import { createApiRouter } from './routes/games';
import { setupWebsocket } from './ws';

async function bootstrap(): Promise<void> {
    await initializeDatabase();

    const app = express();
    app.use(cors({ origin: true, credentials: true }));
    app.use(helmet());
    app.use(express.json({ limit: MAX_IMPORT_SIZE_BYTES }));

    const manager = new GameManager();
    app.use('/api', createApiRouter(manager));

    const staticDir = path.resolve(__dirname, '../../client/dist');
    if (fs.existsSync(staticDir)) {
        app.use(express.static(staticDir));
        app.get('*', (_req: Request, res: Response) => {
            res.sendFile(path.join(staticDir, 'index.html'));
        });
    }

    const server = http.createServer(app);
    setupWebsocket(server, manager);

    server.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Trivia server listening on http://localhost:${PORT}`);
    });
}

bootstrap().catch((error) => {
    console.error('[server] failed to start', error);
    process.exit(1);
});
