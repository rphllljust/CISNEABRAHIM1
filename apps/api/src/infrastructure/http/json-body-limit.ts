const DEFAULT_JSON_BODY_LIMIT_BYTES = 8_192;
const MAX_JSON_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * Limite do corpo JSON (uploads multipart têm limite próprio em documents.module).
 * Default conservador mantido (8 KiB); permite ajuste por ambiente sem alterar código
 * caso payloads legítimos (ex.: propostas/OS com muitos itens) recebam HTTP 413.
 * Valor inválido cai no default; teto de 5 MiB.
 */
export function resolveJsonBodyLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_JSON_BODY_LIMIT_BYTES;
  }
  return Math.min(parsed, MAX_JSON_BODY_LIMIT_BYTES);
}
