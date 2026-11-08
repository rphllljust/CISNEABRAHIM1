import { describe, expect, it } from 'vitest';
import { resolveJsonBodyLimit } from './json-body-limit';

describe('resolveJsonBodyLimit', () => {
  it('mantém o default de 8 KiB sem configuração', () => {
    expect(resolveJsonBodyLimit(undefined)).toBe(8_192);
    expect(resolveJsonBodyLimit('')).toBe(8_192);
  });

  it('aceita valor inteiro positivo', () => {
    expect(resolveJsonBodyLimit('65536')).toBe(65_536);
  });

  it('rejeita valores inválidos voltando ao default', () => {
    for (const raw of ['abc', '-5', '0', '1.5', 'NaN']) {
      expect(resolveJsonBodyLimit(raw)).toBe(8_192);
    }
  });

  it('aplica teto de 5 MiB', () => {
    expect(resolveJsonBodyLimit('999999999')).toBe(5 * 1024 * 1024);
  });
});
