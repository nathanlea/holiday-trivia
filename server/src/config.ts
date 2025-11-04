import path from 'path';

const DEFAULT_DB_FILENAME = 'trivia.db';

export const PORT = Number(process.env.PORT ?? 3000);
export const PIN_HEADER = 'x-trivia-pin';
export const TEAM_TOKEN_BYTES = 16;
export const DATA_DIR = path.resolve(__dirname, '../../data');

const configuredDbPath = process.env.TRIVIA_DB_FILE;

export const DB_FILE = configuredDbPath && configuredDbPath !== ':memory:'
    ? path.resolve(configuredDbPath)
    : path.join(DATA_DIR, DEFAULT_DB_FILENAME);

export const DB_STORAGE = configuredDbPath === ':memory:' ? ':memory:' : DB_FILE;

export const WS_PATH = '/ws';
export const MAX_IMPORT_SIZE_BYTES = 1024 * 1024 * 2; // 2MB
