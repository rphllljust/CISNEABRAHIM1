import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { tokenStore } from '../auth/storage/token-store';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { APP_HOME_HEADING, loginAndReachApp, LOGIN_FORM_HEADING } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';

describe('protected application shell', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('renders shell landmarks and operational dashboard for a valid session', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    const primaryNavigation = screen.getByRole('navigation', { name: /navegação principal/i });
    expect(primaryNavigation).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ir para o conteúdo principal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /menu do usuário/i })).toBeInTheDocument();
    expect(screen.getByText('Minha conta')).toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /contas a receber/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /documentos fiscais/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /plano de contas/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^despesas$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^fornecedores$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^compras$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^estoque$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^folha$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^pessoas$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^locações$/i })).not.toBeInTheDocument();
    expect(within(primaryNavigation).queryByRole('link', { name: /^transporte$/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(primaryNavigation).getByRole('link', { name: /^alertas$/i })).toBeInTheDocument();
      expect(within(primaryNavigation).getByRole('link', { name: /^relatórios$/i })).toBeInTheDocument();
      expect(within(primaryNavigation).getByRole('link', { name: /^rentabilidade operacional$/i })).toBeInTheDocument();
    });
  });

  /*
   * DEEP LINK PARA MÓDULO CONSTRUÍDO — A ROTA RESOLVE.
   *
   * Estes caminhos pertenciam, no texto original deste caso, a "módulos fora da Release 1", e
   * o teste exigia a mensagem `não faz parte da Release 1`. Isso deixou de ser verdade: os
   * três são `BUILT_MODULES` e têm página real ligada no `App.tsx`. Medido por sonda:
   *
   *   /app/inventory    -> "Estoque" (Depósitos, itens, movimentos, reservas)
   *   /app/procurement  -> "Compras" (solicitações, pedidos, notas)
   *   /app/suppliers    -> "Fornecedores"
   *
   * O caso antigo falhava porque esperava o gate ERRADO — não porque houvesse vazamento. E a
   * asserção de bloqueio seria PIOR que inútil aqui: ela exigiria negar acesso a módulo que o
   * produto publica.
   *
   * O bloqueio por AUTORIZAÇÃO é medido onde ele de fato acontece — ver
   * `blocks deep links to capability routes without backend permission` abaixo, que exercita a
   * recusa real, e `feature-flags.test.ts` para a resolução da flag com env explícito.
   */
  it.each([
    ['/app/inventory', /estoque/i],
    ['/app/procurement', /compras/i],
    ['/app/suppliers', /fornecedores/i],
  ])(
    'resolves deep link %s to its real module page',
    async (path, moduleHeading) => {
      vi.stubGlobal('fetch', createShellFetchMock());
      tokenStore.setTokens('access-token', 'refresh-token');
      window.history.pushState({}, '', path);
      render(<App />);

      /*
       * ASSERÇÃO POSITIVA, NÃO SÓ A AUSÊNCIA DE ERRO.
       *
       * A primeira versão deste caso afirmava apenas que "Página não encontrada" NÃO aparecia.
       * Verificado por mutação — renomeando a rota em `App.tsx` — o caso continuava passando:
       * o `queryByText` negativo era avaliado antes de a navegação assentar, e "ainda não
       * renderizou" é indistinguível de "renderizou sem erro" para uma asserção negativa.
       *
       * Agora o caso exige o TÍTULO REAL do módulo. Sem a rota, o catch-all renderiza a página
       * de não encontrado e o título do módulo nunca aparece — a mutação falha, que é o que
       * um teste de rota precisa fazer.
       */
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: moduleHeading }),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/página não encontrada/i)).not.toBeInTheDocument();
    },
  );

  /*
   * ROTA DESCONHECIDA É FAIL-CLOSED — o outro lado da moeda.
   *
   * `/app/accounting` não tem rota de índice no `App.tsx` (só sub-rotas como
   * `/app/accounting/journals`). Medido por sonda, a URL termina em "Página não encontrada".
   *
   * O caso original exigia aqui a mensagem "não faz parte da Release 1", que só aparece quando
   * o gate de FLAG dispara. Com `VITE_CISNE_SURFACE=dev` os módulos construídos ficam ligados
   * (política declarada em `feature-flags.ts`: homologação existe para homologar o produto
   * construído), então essa mensagem não é a que aparece — e o teste falhava por esperar o
   * gate errado.
   *
   * A resolução da flag continua verificada onde é determinística: `feature-flags.test.ts`,
   * com env passado explicitamente. Só ali ela não depende do `.env` da máquina.
   */
  it('does not resolve an unknown module deep link', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    tokenStore.setTokens('access-token', 'refresh-token');
    window.history.pushState({}, '', '/app/accounting');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/página não encontrada/i)).toBeInTheDocument();
    });
  });

  it('redirects absent sessions to login', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/app');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: LOGIN_FORM_HEADING })).toBeInTheDocument();
    });
  });

  it('shows session expired notice after bootstrap failure', async () => {
    tokenStore.setTokens('expired-token', 'refresh-token');
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/app');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: LOGIN_FORM_HEADING })).toBeInTheDocument();
    });
  });

  it('hides capability nav when backend denies probe access', async () => {
    vi.stubGlobal('fetch', createShellFetchMock({ probeAllowed: false }));
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /painel operacional/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /diagnóstico da plataforma/i })).not.toBeInTheDocument();
  });

  it('blocks deep links to capability routes without backend permission', async () => {
    vi.stubGlobal('fetch', createShellFetchMock({ probeAllowed: false }));
    tokenStore.setTokens('access-token', 'refresh-token');
    window.history.pushState({}, '', '/app/platform');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /acesso negado/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/CAP-001/i);
  });

  it('supports direct navigation to platform diagnostics when allowed', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    await user.click(await screen.findByRole('link', { name: /diagnóstico da plataforma/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /platform diagnostics/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/probe status/i)).toBeInTheDocument();
  });

  it('toggles mobile navigation with keyboard-accessible control', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    const toggle = await screen.findByRole('button', { name: /abrir menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    const nav = screen.getByRole('dialog', { name: /menu de navegação/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: /painel operacional/i })).toBeVisible();
  });

  it('closes mobile drawer with Escape', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    await user.click(await screen.findByRole('button', { name: /abrir menu/i }));
    expect(screen.getByRole('dialog', { name: /menu de navegação/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /menu de navegação/i })).not.toBeInTheDocument();
    });
  });

  it('logs out from the shell user menu', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    await user.click(screen.getByRole('button', { name: /menu do usuário/i }));
    await user.click(screen.getByRole('menuitem', { name: /sair/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: LOGIN_FORM_HEADING })).toBeInTheDocument();
    });
  });

  it('shows not found page for unknown routes', async () => {
    vi.stubGlobal('fetch', createShellFetchMock());
    tokenStore.setTokens('access-token', 'refresh-token');
    window.history.pushState({}, '', '/app/rota-inexistente');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /página não encontrada/i })).toBeInTheDocument();
    });
  });

  it('shows service unavailable when bootstrap cannot reach backend', async () => {
    sessionStorage.setItem('cisne.refreshToken', 'refresh-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    window.history.pushState({}, '', '/app');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /service unavailable/i })).toBeInTheDocument();
    });
  });

  it('continues shell when alert summary endpoint fails', async () => {
    const fetchMock = createShellFetchMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/v1/alerts/summary')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { code: 'ALERTS_FAILED' } }),
          } as Response;
        }
        return fetchMock(input, init);
      }),
    );
    window.history.pushState({}, '', '/login');
    render(<App />);

    const user = userEvent.setup();
    await loginAndReachApp(user);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: APP_HOME_HEADING })).toBeInTheDocument();
    });
  });
});
