import crypto from 'crypto';

export function generateGameCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i += 1) {
        const index = crypto.randomInt(0, alphabet.length);
        code += alphabet[index];
    }
    return code;
}

export function generateToken(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
}

export function nowUtc(): string {
    return new Date().toISOString();
}

export function normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}
