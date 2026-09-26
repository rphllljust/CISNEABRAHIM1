import { createHmac } from 'node:crypto';
import { containsSensitiveErrorLeak } from '../domain/safe-error-message';

export const DENIED_HTTP_STATUSES = [401, 403, 404] as const;

/** Privileged command attempts may also fail closed with validation or state errors. */
export const PRIVILEGED_COMMAND_DENIED_STATUSES = [401, 403, 404, 400, 409] as const;

export const SQL_INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE pty.clients; --",
  "1; SELECT pg_sleep(0)--",
  `%' UNION SELECT id::text FROM pty.clients --`,
  `"; DELETE FROM so.service_orders WHERE '1'='1`,
] as const;

/** Fields rejected by assertNoPrivilegedFields on client create. */
export const MASS_ASSIGNMENT_REJECTED_FIELDS = [
  'status',
  'role',
  'scope',
  'approvedBy',
  'createdBy',
  'internalCost',
] as const;

/** Extra attacker fields that must be ignored (not persisted) when accepted by DTO parsing. */
export const MASS_ASSIGNMENT_IGNORED_FIELDS = [
  'permissions',
  'margin',
  'publishedAt',
  'billingStatus',
  'deactivatedAt',
] as const;

export function expectDeniedStatus(statusCode: number): void {
  if (!DENIED_HTTP_STATUSES.includes(statusCode as (typeof DENIED_HTTP_STATUSES)[number])) {
    throw new Error(`Expected denied status (401/403/404), received ${statusCode}`);
  }
}

export function expectPrivilegedCommandDenied(statusCode: number): void {
  if (
    !PRIVILEGED_COMMAND_DENIED_STATUSES.includes(
      statusCode as (typeof PRIVILEGED_COMMAND_DENIED_STATUSES)[number],
    )
  ) {
    throw new Error(`Expected privileged command denial, received ${statusCode}`);
  }
}

/**
 * Verifica que a resposta nao vaza interno do servidor (SQL, caminhos, credenciais, stack).
 *
 * `reflectedInput` remove do corpo apenas o eco do proprio dado enviado pelo chamador
 * (ex.: o termo de busca devolvido em `query.raw`). Eco de entrada do cliente nao e
 * vazamento; sem essa exclusao um payload de injecao que contenha "SELECT ... FROM"
 * faria o detector acusar o proprio payload. Qualquer outro trecho (erro de SQL real,
 * caminho de arquivo, credencial) permanece sob varredura.
 */
export function assertNoSensitiveLeak(
  body: string,
  options?: { reflectedInput?: readonly string[] },
): void {
  let scanned = body;
  for (const echo of options?.reflectedInput ?? []) {
    if (echo.length > 0) {
      scanned = scanned.split(echo).join('');
    }
  }
  if (containsSensitiveErrorLeak(scanned)) {
    throw new Error(`Sensitive data leak detected in response body: ${body.slice(0, 200)}`);
  }
  expect(scanned.toLowerCase()).not.toMatch(/storagekey|storage_key/);
  expect(scanned).not.toMatch(/jwt_secret|refresh_token|access_token/i);
}

export function buildMultipartBody(
  fields: Record<string, string>,
  file: { name: string; mime: string; buffer: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----CisneAdvSec${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export function buildExpiredDownloadToken(secret: string, documentId: string, versionNumber: number): string {
  const expiresAtMs = Date.now() - 60_000;
  const payload = `${documentId}:${versionNumber}:${expiresAtMs}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

export function buildTamperedDownloadToken(secret: string, documentId: string, versionNumber: number): string {
  const expiresAtMs = Date.now() + 60_000;
  const payload = `${documentId}:${versionNumber}:${expiresAtMs}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  const tampered = `${payload}:${signature.slice(0, -1)}Z`;
  return Buffer.from(tampered).toString('base64url');
}
