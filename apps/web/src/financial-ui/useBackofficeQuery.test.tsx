import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBackofficeQuery } from './useBackofficeQuery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const mapError = () => 'Falha mapeada';

describe('useBackofficeQuery', () => {
  it('keeps the last ready payload visible while a refresh is in flight', async () => {
    const refresh = deferred<string>();
    const loader = vi
      .fn<(signal?: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('primeiro')
      .mockImplementationOnce(() => refresh.promise);

    const { result } = renderHook(() =>
      useBackofficeQuery({
        loader,
        mapError,
      }),
    );

    await waitFor(() => {
      expect(result.current.state).toEqual({ phase: 'ready', data: 'primeiro' });
      expect(result.current.refreshing).toBe(false);
    });

    act(() => {
      void result.current.reload();
    });

    // O conteúdo antigo continua na tela; `refreshing` é o que a UI usa para sinalizar a espera.
    expect(result.current.state).toEqual({ phase: 'ready', data: 'primeiro' });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      refresh.resolve('atualizado');
      await refresh.promise;
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ phase: 'ready', data: 'atualizado' });
      expect(result.current.refreshing).toBe(false);
    });
  });

  it('does not let an older slow request overwrite a newer response', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    let call = 0;
    const loader = vi.fn(() => {
      call += 1;
      return call === 1 ? older.promise : newer.promise;
    });

    const { result } = renderHook(() =>
      useBackofficeQuery({
        autoLoad: false,
        loader,
        mapError,
      }),
    );

    act(() => {
      void result.current.reload();
      void result.current.reload();
    });

    await act(async () => {
      newer.resolve('novo');
      await newer.promise;
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ phase: 'ready', data: 'novo' });
    });

    // A resposta antiga chega DEPOIS e não pode reescrever o estado.
    await act(async () => {
      older.resolve('antigo');
      await older.promise;
    });

    expect(result.current.state).toEqual({ phase: 'ready', data: 'novo' });
    expect(result.current.refreshing).toBe(false);
  });

  it('invalidates an in-flight request when reset is called', async () => {
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);

    const { result } = renderHook(() =>
      useBackofficeQuery({
        autoLoad: false,
        loader,
        mapError,
      }),
    );

    act(() => {
      void result.current.reload();
    });
    expect(result.current.state).toEqual({ phase: 'loading' });

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ phase: 'idle' });

    await act(async () => {
      pending.resolve('não deve reaparecer');
      await pending.promise;
    });

    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(result.current.refreshing).toBe(false);
  });
});
