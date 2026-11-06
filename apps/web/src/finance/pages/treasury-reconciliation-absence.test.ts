import { describe, expect, it } from 'vitest';
import { movementCountOrUnknown } from './treasury-engine-rows';

describe('tesouraria: ausência não é zero', () => {
  it('mantém desconhecido quando a reconciliação não foi lida', () => {
    expect(movementCountOrUnknown(null)).toBeNull();
  });

  it('mantém zero quando a API informou zero movimentos', () => {
    expect(movementCountOrUnknown({ movementCount: 0 })).toBe(0);
  });

  it('transporta contagem positiva do servidor', () => {
    expect(movementCountOrUnknown({ movementCount: 7 })).toBe(7);
  });
});
