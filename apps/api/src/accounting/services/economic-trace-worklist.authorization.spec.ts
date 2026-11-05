import { describe, expect, it, vi } from 'vitest';
import { EconomicTraceAccessService } from './economic-trace-access.service';

describe('accounting exception command authorization', () => {
  it('removes retry actions the actor cannot execute', async () => {
    const item = {
      availableCommands: ['RETRY_POSTING', 'OPEN_ECONOMIC_EVENT'],
      nextAction: { command: 'RETRY_POSTING', label: 'Reprocessar contabilização' },
    };
    const reader = { worklist: vi.fn().mockResolvedValue({
      items: [item], total: 1, offset: 0, limit: 10,
      counts: { pending: 0, failed: 1, reversed: 0 },
    }) };
    const authz = {
      assertAccountingAction: vi.fn().mockResolvedValue(undefined),
      hasAccountingAction: vi.fn().mockResolvedValue(false),
    };
    const service = new EconomicTraceAccessService(reader as never, authz as never);
    const response = await service.worklist(
      { identityId: 'actor', sessionId: 'session' },
      { unitId: 'unit', limit: 10, offset: 0 },
    );
    expect(response.items[0]?.availableCommands).not.toContain('RETRY_POSTING');
    expect(response.items[0]?.nextAction.command).toBeNull();
    expect(authz.assertAccountingAction).toHaveBeenCalledOnce();
  });
});
