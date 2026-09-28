import { readFileSync } from 'node:fs';

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readSecretValue(
  env: NodeJS.ProcessEnv,
  key: string,
  fileKey = `${key}_FILE`,
): string | undefined {
  const filePath = normalize(env[fileKey]);
  if (filePath) {
    let value: string;
    try {
      value = readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${fileKey} cannot be read: ${detail}`);
    }
    if (!value) {
      throw new Error(`${fileKey} points to an empty secret file`);
    }
    return value;
  }
  return normalize(env[key]);
}

export function readFirstSecretValue(
  env: NodeJS.ProcessEnv,
  candidates: Array<{ key: string; fileKey?: string }>,
): string | undefined {
  for (const candidate of candidates) {
    const value = readSecretValue(env, candidate.key, candidate.fileKey);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function assertNoInlineSecrets(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): void {
  const present = keys.filter((key) => normalize(env[key]));
  if (present.length > 0) {
    throw new Error(
      `Inline production secrets are forbidden when secret store is required: ${present.join(', ')}`,
    );
  }
}
