import { describe, expect, it } from 'vitest';
import { canApplyServiceRequestListResult } from './service-request-list-generation';

describe('Solicitações — proteção contra respostas antigas', () => {
  it('aceita a consulta mais recente, inclusive paginação manual sem signal', () => {
    expect(canApplyServiceRequestListResult(3, 3)).toBe(true);
  });
  it('recusa resposta de consulta anterior mesmo quando não há AbortSignal', () => {
    expect(canApplyServiceRequestListResult(2, 3)).toBe(false);
  });
  it('recusa consulta cancelada mesmo se o token ainda é o mais recente', () => {
    const controller = new AbortController();
    controller.abort();
    expect(canApplyServiceRequestListResult(3, 3, controller.signal)).toBe(false);
  });
});
