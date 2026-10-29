import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getServiceOrderCostEvidence,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { useServiceOrderCostEvidence } from './useServiceOrderCostEvidence';

vi.mock('../api/service-orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/service-orders-api')>();
  return { ...actual, getServiceOrderCostEvidence: vi.fn() };
});

describe('authorized Cost-to-Serve query state', () => {
  beforeEach(() => vi.mocked(getServiceOrderCostEvidence).mockReset());

  it('classifies 403 as denied, never ready with a fabricated zero value', async () => {
    vi.mocked(getServiceOrderCostEvidence).mockRejectedValueOnce(
      new ServiceOrdersApiError(403, undefined, 'denied'),
    );
    const { result } = renderHook(() => useServiceOrderCostEvidence('os-001'));
    await waitFor(() => expect(result.current.state.phase).toBe('denied'));
    expect(result.current.state).toEqual({ phase: 'denied' });
    expect(getServiceOrderCostEvidence).toHaveBeenCalledWith('os-001', expect.any(AbortSignal));
  });

  it('reports a transport failure separately from missing economic evidence', async () => {
    vi.mocked(getServiceOrderCostEvidence).mockRejectedValueOnce(
      new ServiceOrdersApiError(0, undefined, 'network'),
    );
    const { result } = renderHook(() => useServiceOrderCostEvidence('os-002'));
    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    expect(result.current.state).toEqual({ phase: 'error' });
  });
});
