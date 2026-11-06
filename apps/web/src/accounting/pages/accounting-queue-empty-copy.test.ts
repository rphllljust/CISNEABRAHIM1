import { describe, expect, it } from 'vitest';
import { accountingQueueEmptyCopy } from './accounting-queue-empty-copy';

describe('accounting worklist empty state', () => {
  it('does not claim the ledger has zero exceptions when a filtered page is empty', () => {
    const copy = accountingQueueEmptyCopy(true);
    expect(copy.title).toBe('Nenhum caso neste filtro');
    expect(copy.description).not.toContain('Todos os fatos econômicos');
    expect(copy.description).toContain('filtro');
  });

  it('does not claim zero exceptions for an empty page of a paginated queue', () => {
    const copy = accountingQueueEmptyCopy(false);
    expect(copy.title).toBe('Nenhum caso nesta página');
    expect(copy.description).toContain('não comprova ausência de pendências');
  });
});
