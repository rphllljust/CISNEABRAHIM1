import { describe, expect, it } from 'vitest';
import { hasActiveWorklistFilters } from './worklist-filter-state';

describe('hasActiveWorklistFilters', () => {
  it('does not mistake an unfiltered or whitespace-only worklist for a filtered one', () => {
    expect(hasActiveWorklistFilters()).toBe(false);
    expect(hasActiveWorklistFilters('', ' ', null, undefined)).toBe(false);
  });

  it.each([
    ['client', 'client-1'],
    ['unit', 'unit-1'],
    ['status', 'ACTIVE'],
    ['committed search', 'ABC-123'],
    ['from date', '2026-11-01'],
    ['to date', '2026-11-30'],
    ['advanced filter', '{"operator":"and"}'],
  ])('recognizes an applied %s filter', (_name, value) => {
    expect(hasActiveWorklistFilters('', '', value)).toBe(true);
  });
});
