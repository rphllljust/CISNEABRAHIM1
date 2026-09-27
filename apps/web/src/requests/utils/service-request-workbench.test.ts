import { describe, expect, it } from 'vitest';
import {
  describeDesiredWindowTiming,
  describeServiceRequestAttention,
  describeServiceRequestTemporalContext,
  formatRelativePast,
} from './service-request-workbench';

const NOW = new Date('2026-03-10T09:00:00.000Z');

describe('service request workbench derivations', () => {
  it('describes the desired window as a temporal fact, never as a contracted deadline', () => {
    const past = describeDesiredWindowTiming('2026-03-05T09:00:00.000Z', NOW);
    expect(past?.tone).toBe('past');
    expect(past?.text).toBe('início desejado passou há 5 dias');

    const today = describeDesiredWindowTiming('2026-03-10T14:00:00.000Z', NOW);
    expect(today?.tone).toBe('today');

    const soon = describeDesiredWindowTiming('2026-03-12T09:00:00.000Z', NOW);
    expect(soon?.tone).toBe('soon');
    expect(soon?.text).toBe('início desejado em 2 dias');

    // Nenhum texto afirma atraso, violação de prazo ou SLA inexistente no domínio.
    for (const timing of [past, today, soon]) {
      expect(timing?.text ?? '').not.toMatch(/atras/i);
      expect(timing?.text ?? '').not.toMatch(/sla/i);
    }
  });

  it('reports only derivable attention facts', () => {
    const facts = describeServiceRequestAttention(
      {
        priority: 'URGENT',
        desiredStartAt: '2026-03-01T09:00:00.000Z',
        desiredEndAt: null,
        clientId: null,
        status: 'SUBMITTED',
      },
      NOW,
    );
    const codes = facts.map((fact) => fact.code);
    expect(codes).toContain('PRIORITY_URGENT');
    expect(codes).toContain('DESIRED_START_PAST');
    expect(codes).toContain('CLIENT_UNIDENTIFIED');

    const quiet = describeServiceRequestAttention(
      {
        priority: 'NORMAL',
        desiredStartAt: '2026-04-01T09:00:00.000Z',
        desiredEndAt: null,
        clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'APPROVED',
      },
      NOW,
    );
    expect(quiet.map((fact) => fact.code)).toEqual([]);
  });

  it('derives the temporal context from the persisted timestamps only', () => {
    const entries = describeServiceRequestTemporalContext(
      {
        createdAt: '2026-03-08T09:00:00.000Z',
        submittedAt: '2026-03-09T09:00:00.000Z',
        reviewStartedAt: null,
        approvedAt: null,
        rejectedAt: null,
        cancelledAt: null,
        convertedAt: null,
        desiredStartAt: '2026-03-12T09:00:00.000Z',
        desiredEndAt: null,
      },
      NOW,
    );

    expect(entries.map((entry) => entry.label)).toEqual([
      'Criada',
      'Enviada',
      'Janela desejada',
    ]);
    expect(entries[0]?.relative).toBe('há 2 dias');
    expect(entries[1]?.relative).toBe('há 1 dia');
  });

  it('formats relative past instants without inventing precision', () => {
    expect(formatRelativePast(null, NOW)).toBeNull();
    expect(formatRelativePast('2026-03-10T08:30:00.000Z', NOW)).toBe('há 30 min');
    expect(formatRelativePast('2026-03-10T06:00:00.000Z', NOW)).toBe('há 3 h');
    expect(formatRelativePast('2026-03-05T09:00:00.000Z', NOW)).toBe('há 5 dias');
  });
});
