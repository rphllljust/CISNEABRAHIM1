import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDomainWork } from './use-domain-work';

const { getWorkInbox } = vi.hoisted(() => ({ getWorkInbox: vi.fn() }));
vi.mock('../../work-inbox/api/work-inbox-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../work-inbox/api/work-inbox-api')>()),
  getWorkInbox,
}));

function setup(count: number | undefined, unavailable = false) {
  getWorkInbox.mockImplementation(async () => ({
    items: [],
    limit: 5,
    offset: 0,
    total: 0,
    totalPages: 0,
    byDomain: count === undefined ? {} : { OPERACOES: count },
    unavailableDomains: unavailable ? ['OPERACOES'] : [],
  }));
}

describe('workspace counts must come from an available authoritative read model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not turn a missing backend counter into zero', async () => {
    setup(undefined);
    const { result } = renderHook(() => useDomainWork('OPERACOES'));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.agoraCount).toBeNull();
    expect(result.current.message).toMatch(/Não foi possível ler/);
  });

  it('marks an unavailable source unknown even when the partial aggregate says zero', async () => {
    setup(0, true);
    const { result } = renderHook(() => useDomainWork('OPERACOES'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.agoraCount).toBeNull();
  });

  it('accepts zero only when the backend actually published a healthy zero', async () => {
    setup(0, false);
    const { result } = renderHook(() => useDomainWork('OPERACOES'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.unavailable).toBe(false);
    expect(result.current.agoraCount).toBe(0);
  });
});
