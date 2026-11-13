import { describe, expect, it } from 'vitest';
import { pendingDuplicateCheckState } from './useClientDuplicateCheck';

describe('Clientes — nova consulta de duplicidade', () => {
  it('não mantém bloqueio nem evidência pertencente ao documento anterior', () => {
    const pending = pendingDuplicateCheckState();
    expect(pending).toEqual({ phase: 'checking', result: null, blocking: false });
  });

  it('cria estado independente a cada entrada, sem compartilhar referência', () => {
    const first = pendingDuplicateCheckState();
    const second = pendingDuplicateCheckState();
    expect(first).not.toBe(second);
    expect(second.blocking).toBe(false);
  });
});
