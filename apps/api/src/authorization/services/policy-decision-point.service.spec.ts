import { describe, expect, it, vi } from 'vitest';
import { AUTHZ_DENY_REASONS } from '../errors/authz-error-codes';
import type { AuthorizationRepository } from '../repositories/authorization.repository';
import { PolicyDecisionPointService } from './policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../types/authz-resources';

describe('PolicyDecisionPointService', () => {
  const findActiveGrants = vi.fn();
  const findRoleDerivedActionRows = vi.fn();
  const insertDecisionAudit = vi.fn();
  const securityAudit = { record: vi.fn().mockResolvedValue('audit-id') };
  const repository = {
    findActiveGrants,
    findRoleDerivedActionRows,
    insertDecisionAudit,
  } as unknown as AuthorizationRepository;
  findRoleDerivedActionRows.mockResolvedValue([]);

  const pdp = new PolicyDecisionPointService(repository, securityAudit as never);

  it('denies by default without identity (fail-closed)', async () => {
    const decision = await pdp.decide(null, {
      action: AUTHZ_ACTIONS.ProbeExecute,
      resourceType: AUTHZ_RESOURCE_TYPES.Probe,
    });

    expect(decision.result).toBe('DENY');
    expect(decision.reasonCode).toBe(AUTHZ_DENY_REASONS.NO_IDENTITY);
  });

  it('denies authenticated identity without grant', async () => {
    findActiveGrants.mockResolvedValue([]);

    const decision = await pdp.decide(
      { identityId: 'id-1', sessionId: 'sid-1' },
      {
        action: AUTHZ_ACTIONS.ProbeExecute,
        resourceType: AUTHZ_RESOURCE_TYPES.Probe,
      },
      { audit: false },
    );

    expect(decision.result).toBe('DENY');
    expect(decision.reasonCode).toBe(AUTHZ_DENY_REASONS.NO_ACTIVE_GRANT);
  });

  it('allows when a matching GLOBAL grant exists', async () => {
    findActiveGrants.mockResolvedValue([
      {
        id: 'g1',
        identity_id: 'id-1',
        action: AUTHZ_ACTIONS.ProbeExecute,
        resource_type: AUTHZ_RESOURCE_TYPES.Probe,
        resource_id: null,
        scope_type: 'GLOBAL',
        constraints: null,
        granted_by_identity_id: 'admin',
        version: 1,
        valid_from: new Date().toISOString(),
        valid_until: null,
        revoked_at: null,
        revoked_by_identity_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const decision = await pdp.decide(
      { identityId: 'id-1', sessionId: 'sid-1' },
      {
        action: AUTHZ_ACTIONS.ProbeExecute,
        resourceType: AUTHZ_RESOURCE_TYPES.Probe,
      },
      { audit: false },
    );

    expect(decision.result).toBe('ALLOW');
  });
});
