import { describe, expect, it } from 'vitest';
import { buildUnitRlsClause, isSupersetDashboardKey } from './superset-embedded.service';

describe('MASTER 015 — Superset RLS validation', () => {
  it('denies arbitrary dashboards and client-supplied dashboard UUIDs', () => {
    expect(isSupersetDashboardKey('service-orders')).toBe(true);
    expect(isSupersetDashboardKey('executive')).toBe(true);
    expect(isSupersetDashboardKey('malicious')).toBe(false);
    expect(isSupersetDashboardKey({ id: 'service-orders' })).toBe(false);
  });

  it('accepts explicit unit IDs and prevents SQL injection', () => {
    expect(buildUnitRlsClause('CISNE-RO-PVH')).toBe("unit_id = 'CISNE-RO-PVH'");
    expect(() => buildUnitRlsClause("PVH' OR true--")).toThrow();
    expect(() => buildUnitRlsClause('')).toThrow();
    expect(() => buildUnitRlsClause('unit with space')).toThrow();
    expect(() => buildUnitRlsClause(null)).toThrow();
  });
});
