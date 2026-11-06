import { describe, expect, it } from 'vitest';
import { formatEconomicRetryResult } from './pages/EconomicPostingWorklistPage';

describe('economic posting retry result', () => {
  it('reports a journal only when the API returns its identifier', () => {
    expect(formatEconomicRetryResult({ outcome: 'POSTED', journalEntryId: 'journal-123' }))
      .toBe('Contabilização reprocessada: POSTED. Lançamento journal-123.');
  });

  it.each([null, undefined, '', '   '])(
    'does not invent a journal for an absent identifier (%s)',
    (journalEntryId) => {
      const message = formatEconomicRetryResult({ outcome: 'PENDING', journalEntryId });
      expect(message).toContain('Nenhum lançamento identificado na resposta.');
      expect(message).not.toContain('Lançamento null');
      expect(message).not.toContain('Lançamento undefined');
    },
  );
});
