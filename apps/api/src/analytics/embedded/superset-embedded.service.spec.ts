import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { SupersetEmbeddedService } from './superset-embedded.service';
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

describe('MASTER 015 — authorization and upstream isolation', () => {
  const actor = { identityId: '00000000-0000-4000-8000-000000000001', sessionId: 'test-session' };

  beforeEach(() => {
    vi.stubEnv('SUPERSET_EMBED_ENABLED', 'true');
    vi.stubEnv('SUPERSET_INTERNAL_URL', 'http://superset:8088/');
    vi.stubEnv('SUPERSET_PUBLIC_URL', 'https://bi.cisne-hml.example.invalid/');
    vi.stubEnv('SUPERSET_SERVICE_USERNAME', 'integration');
    vi.stubEnv('SUPERSET_SERVICE_PASSWORD', 'test-only-secret');
    vi.stubEnv('SUPERSET_DASHBOARD_SERVICE_ORDERS_ID', '00000000-0000-4000-8000-0000000000a1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('never calls Superset after a unit-scope denial', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'DENY' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'OTHER-UNIT'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(decide).toHaveBeenCalledWith(actor, expect.objectContaining({
      context: { unitId: 'OTHER-UNIT' },
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats disabled integration as 503, not as an empty dashboard', async () => {
    vi.stubEnv('SUPERSET_EMBED_ENABLED', 'false');
    const decide = vi.fn();
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'CISNE-RO-PVH'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(decide).not.toHaveBeenCalled();
  });

  it('issues a server-approved single-unit RLS token after PDP ALLOW', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'ALLOW' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'service-access-token-12345' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'guest-access-token-123456' }) });
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    const actual = await sut.issueGuestToken(actor, 'service-orders', 'CISNE-RO-PVH');
    expect(actual.token).toBe('guest-access-token-123456');
    expect(actual.supersetDomain).toBe('https://bi.cisne-hml.example.invalid');
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(init.body as string) as { resources: Array<{ id: string }>; rls: Array<{ clause: string }> };
    expect(payload.resources[0]?.id).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(payload.rls).toEqual([{ clause: "unit_id = 'CISNE-RO-PVH'" }]);
  });

  it('catalog returns only dashboards whose configured scopes pass PDP', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'ALLOW' });
    const subject = new SupersetEmbeddedService(
      { decide } as unknown as PolicyDecisionPointService,
    );
    const catalog = await subject.listDashboardCatalog(actor, 'CISNE-RO-PVH');
    expect(catalog.items).toEqual([{ key: 'service-orders', label: 'Ordens de serviço' }]);
    expect(decide).toHaveBeenCalledWith(actor, expect.objectContaining({
      context: { unitId: 'CISNE-RO-PVH' },
    }), { audit: false });
  });

  it('catalog denies a unit if it has no matching dashboard entitlement', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'DENY' });
    const subject = new SupersetEmbeddedService(
      { decide } as unknown as PolicyDecisionPointService,
    );
    await expect(subject.listDashboardCatalog(actor, 'OTHER-UNIT'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects cross-unit access even if the requested dashboard exists', async () => {
    const decide = vi.fn().mockImplementation(
      (_actor: unknown, request: { context: { unitId: string } }) =>
        Promise.resolve({ result: request.context.unitId === 'CISNE-RO-PVH' ? 'ALLOW' : 'DENY' }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'OTHER-UNIT'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(sut.listDashboardCatalog(actor, 'OTHER-UNIT'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies multi-domain dashboards if any required capability is missing', async () => {
    vi.stubEnv('SUPERSET_DASHBOARD_EXECUTIVE_ID', '00000000-0000-4000-8000-0000000000a2');
    const decide = vi.fn()
      .mockResolvedValueOnce({ result: 'ALLOW' })
      .mockResolvedValueOnce({ result: 'DENY' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'executive', 'CISNE-RO-PVH'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the upstream login fails and does not call guest issuance', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'ALLOW' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'CISNE-RO-PVH'))
      .rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid upstream guest response instead of forwarding it', async () => {
    const decide = vi.fn().mockResolvedValue({ result: 'ALLOW' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'service-access-token-12345' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'bad' }) });
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'CISNE-RO-PVH'))
      .rejects.toMatchObject({ status: 502 });
  });

  it('rejects an insecure public Superset origin in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPERSET_PUBLIC_URL', 'http://bi.cisne-hml.example.invalid/');
    const decide = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sut = new SupersetEmbeddedService({ decide } as unknown as PolicyDecisionPointService);
    await expect(sut.issueGuestToken(actor, 'service-orders', 'CISNE-RO-PVH'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(decide).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
