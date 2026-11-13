import { describe, expect, it } from 'vitest';
import { resolveFiscalDocumentUnitScope } from './fiscal-document-unit-scope';

describe('Fiscal documents — unidade da URL', () => {
  it('prioriza deep link explícito sobre a unidade padrão', () => {
    expect(resolveFiscalDocumentUnitScope('UNIT_B', 'UNIT_A')).toBe('UNIT_B');
  });

  it('retorna à unidade padrão quando o parâmetro de URL é removido', () => {
    expect(resolveFiscalDocumentUnitScope('', 'UNIT_A')).toBe('UNIT_A');
  });

  it('não inventa unidade quando não existe nenhuma disponível', () => {
    expect(resolveFiscalDocumentUnitScope('', undefined)).toBe('');
  });
});
