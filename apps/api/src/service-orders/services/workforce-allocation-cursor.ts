import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadAuthConfig } from '../../auth/config/auth.config';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';

type CursorPayload = {
  v: 1;
  identityId: string;
  sessionId: string;
  workforceMemberId: string;
  rawOffset: number;
  expiresAt: number;
};

const CONTEXT = 'cisne.people.workforce-allocation-cursor.v1';
const CURSOR_TTL_MS = 15 * 60 * 1000;

function key(): Buffer {
  return createHash('sha256').update(CONTEXT).update('\0').update(loadAuthConfig().jwtSecret).digest();
}

/** Authenticated encryption prevents a caller from learning or modifying raw candidate offsets. */
export function sealWorkforceCursor(
  actor: IdentityAuthzContext,
  workforceMemberId: string,
  rawOffset: number,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const value: CursorPayload = {
    v: 1,
    identityId: actor.identityId,
    sessionId: actor.sessionId,
    workforceMemberId,
    rawOffset,
    expiresAt: Date.now() + CURSOR_TTL_MS,
  };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openWorkforceCursor(
  cursor: string,
  actor: IdentityAuthzContext,
  workforceMemberId: string,
): number {
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error('INVALID_WORKFORCE_CURSOR');
  }
  try {
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.length < 29) throw new Error('invalid cursor');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const decoded = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const payload = JSON.parse(decoded.toString('utf8')) as CursorPayload;
    if (
      payload.v !== 1 ||
      payload.identityId !== actor.identityId ||
      payload.sessionId !== actor.sessionId ||
      payload.workforceMemberId !== workforceMemberId ||
      !Number.isSafeInteger(payload.rawOffset) ||
      payload.rawOffset < 0 ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      throw new Error('invalid cursor');
    }
    return payload.rawOffset;
  } catch {
    throw new Error('INVALID_WORKFORCE_CURSOR');
  }
}
