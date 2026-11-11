import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { isAllowedOrigin, MAX_IMPORT_SIZE_BYTES } from './config';
import GameManager from './gameManager';
import { createApiRouter } from './routes/games';
import { HttpError } from './errors';

export function createApp(manager: GameManager): express.Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet());
    app.use(cors({
        origin(origin, callback) {
            callback(isAllowedOrigin(origin) ? null : new HttpError(403, 'Origin is not allowed'), true);
        },
    }));
    app.use(express.json({ limit: MAX_IMPORT_SIZE_BYTES }));
    app.use('/api', (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    }, createApiRouter(manager));
    app.use((_req, res) => {
        res.status(404).json({ error: 'Endpoint not found' });
    });
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
        if (error instanceof HttpError) {
            res.status(error.status).json({ error: error.message });
        } else if (error instanceof SyntaxError && 'body' in error) {
            res.status(400).json({ error: 'Request body must be valid JSON' });
        } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
            res.status(413).json({ error: 'Question import exceeds the 2 MB limit' });
        } else {
            console.error('[server]', error);
            res.status(500).json({ error: 'Unexpected server error' });
        }
    };
    app.use(handleError);
    return app;
}
