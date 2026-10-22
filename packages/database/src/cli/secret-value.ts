import { readFileSync } from 'node:fs';

/**
 * Resolve um segredo de ambiente aceitando a forma montada em arquivo.
 *
 * Contrato (o mesmo do runtime da API em
 * `apps/api/src/platform/runtime-config/secret-value.ts`):
 * - `NAME_FILE` tem precedência sobre `NAME`;
 * - o conteúdo do arquivo é aparado (trim) — arquivos montados por secret costumam
 *   terminar em newline;
 * - arquivo ilegível ou vazio é ERRO, nunca um fallback silencioso para inline.
 *
 * Vive em módulo próprio para ser testável: o CLI executa `main()` no import e
 * não é importável com segurança.
 */
export function readSecretValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const filePath = env[`${name}_FILE`]?.trim();
  if (filePath) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${name}_FILE cannot be read: ${detail}`);
    }
    const value = raw.trim();
    if (!value) {
      throw new Error(`${name}_FILE points to an empty secret file`);
    }
    return value;
  }

  const inline = env[name]?.trim();
  return inline ? inline : undefined;
}
