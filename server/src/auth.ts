import { timingSafeEqual } from 'crypto';
import { ADMIN_SECRET } from './config';
import { assert } from './errors';

export function assertAdminSecret(secret: string): void {
    const expected = Buffer.from(ADMIN_SECRET);
    const supplied = Buffer.from(secret);
    assert(expected.length > 0 && supplied.length === expected.length &&
        timingSafeEqual(supplied, expected), 401, 'Invalid host secret');
}
