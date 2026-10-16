import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { APP_HOME_HEADING, loginAndReachApp } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';

type ViewportProfile = 'mobile' | 'tablet' | 'desktop';

const VIEWPORTS: Record<ViewportProfile, { width: number; height: number; mobile: boolean }> = {
  mobile: { width: 375, height: 667, mobile: true },
  tablet: { width: 768, height: 1024, mobile: true },
  desktop: { width: 1280, height: 800, mobile: false },
};

function applyViewport(profile: ViewportProfile) {
  const { width, height, mobile } = VIEWPORTS[profile];
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height, writable: true });
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: mobile ? query.includes('max-width') : query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  window.dispatchEvent(new Event('resize'));
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await loginAndReachApp(user);
}

describe('first vertical UI quality gate (responsive)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  for (const profile of ['mobile', 'tablet', 'desktop'] as const) {
    it(`renders protected shell landmarks at ${profile} viewport`, async () => {
      applyViewport(profile);
      vi.stubGlobal('fetch', createShellFetchMock());
      render(<App />);

      const user = userEvent.setup();
      await login(user);

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /ir para o conteúdo principal/i })).toBeInTheDocument();

      if (profile === 'mobile') {
        const toggle = screen.getByRole('button', { name: /abrir menu/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(toggle);
        const nav = screen.getByRole('dialog', { name: /menu de navegação/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(within(nav).getByRole('link', { name: /painel operacional/i })).toBeVisible();
      } else {
        expect(screen.getByRole('navigation', { name: /navegação principal/i })).toBeVisible();
      }
    });
  }

  it('shows forbidden state when capability probe denies access', async () => {
    applyViewport('desktop');
    vi.stubGlobal('fetch', createShellFetchMock({ probeAllowed: false }));
    render(<App />);

    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /clientes/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { level: 1, name: APP_HOME_HEADING })).toBeInTheDocument();
  });
});
