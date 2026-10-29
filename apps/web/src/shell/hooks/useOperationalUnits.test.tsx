import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationsApiError } from '../../service-orders/api/operations-api';
import { useOperationalUnits, type OperationalUnitsLoader } from './useOperationalUnits';

describe('authorized operational units — fail-closed loader contract', () => {
  it('keeps access denial distinct from an authorized empty directory', async () => {
    const loader: OperationalUnitsLoader = async () => {
      throw new OperationsApiError(403, 'SERVICE_ORDERS_DENIED', 'denied');
    };
    const { result } = renderHook(() => useOperationalUnits(loader));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeInstanceOf(OperationsApiError);
    expect((result.current.error as OperationsApiError).kind).toBe('denied');
    expect(result.current.units).toEqual([]);
    expect(result.current.options).toEqual([]);
    expect(result.current.unitId).toBe('');
  });

  it('recovers from a transport failure only after an explicit retry', async () => {
    const loader = vi.fn<OperationalUnitsLoader>()
      .mockRejectedValueOnce(new OperationsApiError(0, undefined, 'network'))
      .mockResolvedValueOnce({
        items: ['unit-a'],
        details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
      });
    const { result } = renderHook(() => useOperationalUnits(loader));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.options).toEqual([]);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.options).toEqual([{ value: 'unit-a', label: 'Porto Velho · PVH' }]);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
