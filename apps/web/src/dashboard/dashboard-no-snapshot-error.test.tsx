import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { requestUrl } from '../test/request-url';
import { createShellFetchMock } from '../test/shell-fetch-mock';

describe('dashboard first-load API failure without a prior snapshot', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  it('renders a retriable error state rather than crashing the entire workspace', async () => {
    const shellFetch = createShellFetchMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).includes('/api/v1/dashboard/executive')) {
        return new Response(JSON.stringify({
          error: { code: 'DASHBOARD_UNAVAILABLE', message: 'Test-only upstream failure' },
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return shellFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await loginAndReachApp(userEvent.setup());

    // No authoritative snapshot arrived. The UI must not convert absence to zero
    // or crash before publishing the server-error state and its retry action.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeVisible();
    });
    expect(screen.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
    expect(screen.queryByText(/erro inesperado/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  }, 15000);
});
