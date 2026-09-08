import { describe, expect, it } from 'vitest';
import {
  buildSnapshotEnvelope,
  snapshotIdsDiffer,
} from './snapshot-semantics';

describe('ANALYTICS SNAPSHOT SEMANTICS (query-time envelope)', () => {
  it('mesma janela+dataAsOf gera mesmo snapshotId; janela diferente gera outro (detecta mudanca)', () => {
    const a = buildSnapshotEnvelope({ windowKey: 'actor-a|week-1', dataAsOf: '2026-09-08T00:00:00.000Z' });
    const b = buildSnapshotEnvelope({ windowKey: 'actor-a|week-1', dataAsOf: '2026-09-08T00:00:00.000Z' });
    const c = buildSnapshotEnvelope({ windowKey: 'actor-a|week-1', dataAsOf: '2026-09-09T00:00:00.000Z' });
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(snapshotIdsDiffer(a, c)).toBe(true);
    expect(a.generatedAt).toBeDefined();
    expect(a.dataAsOf).toBeDefined();
    expect(a.consistency).toBe('SINGLE_WINDOW');
    expect(a.partial).toBe(false);
  });

  it('envelope explicita partial/reasons quando mascarada', () => {
    const env = buildSnapshotEnvelope({
      windowKey: 'x',
      dataAsOf: '2026-09-08T00:00:00.000Z',
      partial: true,
      partialReasons: ['no_measurement_grant'],
    });
    expect(env.partial).toBe(true);
    expect(env.partialReasons).toContain('no_measurement_grant');
  });
});
