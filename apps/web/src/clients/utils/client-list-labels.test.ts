import { describe, expect, it } from 'vitest';
import {
  formatClientCount,
  formatClientListDateTime,
  formatClientRangeLabel,
  formatPurchaseOrderRequirement,
} from './client-list-labels';
import { PURCHASE_ORDER_REQUIREMENTS } from '../types/client.types';

describe('formatClientListDateTime', () => {
  it('formats an ISO instant for pt-BR', () => {
    expect(formatClientListDateTime('2026-03-15T14:30:00.000Z')).toMatch(/15\/03\/2026/);
  });

  it('degrades to a dash for an unparseable value', () => {
    expect(formatClientListDateTime('not-a-date')).toBe('—');
  });
});

describe('formatClientRangeLabel', () => {
  it('describes the visible slice and the total', () => {
    expect(formatClientRangeLabel(20, 20, 137)).toBe('21–40 de 137');
  });

  it('uses the real visible count on a short last page', () => {
    expect(formatClientRangeLabel(120, 17, 137)).toBe('121–137 de 137');
  });

  it('handles the empty catalogue', () => {
    expect(formatClientRangeLabel(0, 0, 0)).toBe('Nenhum Cliente');
  });
});

describe('formatClientCount', () => {
  it('groups thousands in pt-BR', () => {
    expect(formatClientCount(1234)).toBe('1.234');
  });
});

describe('formatPurchaseOrderRequirement', () => {
  it('labels every domain value', () => {
    expect(formatPurchaseOrderRequirement(PURCHASE_ORDER_REQUIREMENTS.NotRequired)).toBe('Não exige');
    expect(formatPurchaseOrderRequirement(PURCHASE_ORDER_REQUIREMENTS.BeforeExecution)).toBe(
      'Antes da execução',
    );
    expect(formatPurchaseOrderRequirement(PURCHASE_ORDER_REQUIREMENTS.BeforeBilling)).toBe(
      'Antes do faturamento',
    );
  });
});
