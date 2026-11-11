export interface HostSession {
    gameCode: string;
    adminSecret: string;
}

const STORAGE_KEY = 'trivia.host.session.v2';

export function loadHostSession(): HostSession | null {
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === 'object' && 'gameCode' in value && 'adminSecret' in value &&
            typeof value.gameCode === 'string' && typeof value.adminSecret === 'string') {
            return { gameCode: value.gameCode, adminSecret: value.adminSecret };
        }
        console.warn('Invalid saved host session');
    } catch (error) {
        console.warn('Unable to read host session', error);
    }
    return null;
}

export function persistHostSession(session: HostSession | null): void {
    if (session) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
    }
}
