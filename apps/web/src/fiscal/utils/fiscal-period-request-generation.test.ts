import { describe, expect, it } from 'vitest';
import { canApplyFiscalPeriodResult } from './fiscal-period-request-generation';

describe('Períodos fiscais — consultas concorrentes', () => {
  it('aplica o resultado de consulta mais recente', () => {
    expect(canApplyFiscalPeriodResult(3, 3)).toBe(true);
  });
  it('ignora resposta antiga mesmo sem AbortSignal, após atualização manual', () => {
    expect(canApplyFiscalPeriodResult(2, 3)).toBe(false);
  });
  it('ignora resposta de uma rota já cancelada', () => {
    const controller = new AbortController();
    controller.abort();
    expect(canApplyFiscalPeriodResult(3, 3, controller.signal)).toBe(false);
  });
});
