export class HttpError extends Error {
    public readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}

export function assert(condition: unknown, status: number, message: string): asserts condition {
    if (!condition) {
        throw new HttpError(status, message);
    }
}
