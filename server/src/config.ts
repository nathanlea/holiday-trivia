import path from 'path';

const DEFAULT_DB_FILENAME = 'trivia.db';

export const PORT = Number(process.env.PORT ?? 3000);
export const ADMIN_HEADER = 'x-trivia-admin';
export const TEAM_TOKEN_BYTES = 16;
export const DATA_DIR = path.resolve(process.env.TRIVIA_DATA_DIR ?? path.join(process.cwd(), 'data'));

export const ADMIN_SECRET = process.env.TRIVIA_ADMIN_SECRET ?? '';
export const ALLOWED_ORIGINS = (process.env.TRIVIA_ALLOWED_ORIGINS ?? 'http://localhost:8000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): boolean {
    return !origin || ALLOWED_ORIGINS.includes(origin);
}

export function validateConfig(): void {
    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    if (ADMIN_SECRET.length < 16) {
        throw new Error('TRIVIA_ADMIN_SECRET must contain at least 16 characters');
    }
    if (!ALLOWED_ORIGINS.length) {
        throw new Error('TRIVIA_ALLOWED_ORIGINS must contain at least one frontend origin');
    }
}

const configuredDbPath = process.env.TRIVIA_DB_FILE;

export const DB_FILE = configuredDbPath && configuredDbPath !== ':memory:'
    ? path.resolve(configuredDbPath)
    : path.join(DATA_DIR, DEFAULT_DB_FILENAME);

export const DB_STORAGE = configuredDbPath === ':memory:' ? ':memory:' : DB_FILE;

export const WS_PATH = '/ws';
export const MAX_IMPORT_SIZE_BYTES = 1024 * 1024 * 2; // 2MB
