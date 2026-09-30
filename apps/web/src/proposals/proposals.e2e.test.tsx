import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createCommercialFetchMock } from '../test/commercial-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { parseRequestPath } from '../test/request-url';
import { createProposalItemRow } from './utils/proposal-form-validation';

describe('proposals administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  function composeFetch(commercialOptions = {}) {
    const shellMock = createShellFetchMock();
    const commercialMock = createCommercialFetchMock(commercialOptions);
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (
        pathname.startsWith('/api/v1/commercial/') ||
        pathname.startsWith('/api/v1/clients')
      ) {
        return commercialMock(input, init);
      }
      return shellMock(input, init);
    });
  }

  it('supports list, create, issue and accept', async () => {
    vi.stubGlobal('fetch', composeFetch());
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /propostas/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('link', { name: /^propostas$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /propostas comerciais/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'PROP-2026-DEMO01' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /nova proposta/i }));
    // O Cliente passou a ser escolhido pela busca humana do cadastro: o mesmo fato de negocio
    // (proposta vinculada a um Cliente autorizado) agora acontece por busca, nao por lista nativa.
    const clientSelect = await screen.findByLabelText(/^cliente/i);
    await waitFor(() => {
      expect(within(clientSelect).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(clientSelect, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await user.type(screen.getByLabelText(/^unidade operacional/i), 'unit-demo');
    await user.type(screen.getByLabelText(/^título/i), 'Proposta E2E');
    await user.type(screen.getByLabelText(/^preço global de venda/i), '25000.00');
    await user.click(screen.getByRole('button', { name: /registrar proposta/i }));

    await waitFor(() => {
      expect(screen.getByText('Proposta E2E')).toBeInTheDocument();
    });

    // A acao primaria vive no header da object page: emitir a revisao vigente. O depoimento
    // do título da proposta confirma que o detalhe carregou na gramática canônica.
    await waitFor(() => {
      expect(screen.getAllByText('Proposta E2E').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /emitir proposta/i }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: /emitir proposta/i })[0]!);

    // Emitida: "Registrar aceite" passa a ser a acao mais provavel do estado.
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /registrar aceite/i }).length,
      ).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole('button', { name: /registrar aceite/i })[0]!);
    await user.click(screen.getByRole('button', { name: /confirmar aceitação/i }));

    await waitFor(() => {
      expect(screen.getAllByLabelText('Status: Aceita').length).toBeGreaterThan(0);
    });
  }, 25000);

  it('shows empty list state', async () => {
    const commercialMock = createCommercialFetchMock();
    const shellMock = createShellFetchMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { pathname } = parseRequestPath(input);
        if (pathname === '/api/v1/commercial/proposals' && (init?.method ?? 'GET') === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ items: [], limit: 20, offset: 0 }),
          } as Response;
        }
        if (pathname.startsWith('/api/v1/commercial/')) {
          return commercialMock(input, init);
        }
        return shellMock(input, init);
      }),
    );
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    await user.click(await screen.findByRole('link', { name: /^propostas$/i }));
    /*
     * O estado vazio passou de um `<p>` solto para o `WorklistStatePanel` compartilhado, e o
     * texto agora distingue os dois casos, como nas demais worklists:
     *   - catalogo vazio (este teste)  -> "Nenhuma proposta registrada."
     *   - filtro sem resultado          -> "Nenhuma proposta corresponde aos filtros aplicados."
     * O fato protegido continua o mesmo: lista vazia NAO e tabela muda.
     */
    await waitFor(() => {
      expect(screen.getByText(/nenhuma proposta registrada/i)).toBeInTheDocument();
    });
  });

  it('denies create when capability absent', async () => {
    vi.stubGlobal('fetch', composeFetch({ proposalCreateAllowed: false }));
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    await user.click(await screen.findByRole('link', { name: /^propostas$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /nova proposta/i })).not.toBeInTheDocument();
    });
  });
});

describe('proposal form validation unit', () => {
  it('validates required fields', async () => {
    const { validateProposalForm, EMPTY_PROPOSAL_FORM } = await import(
      './utils/proposal-form-validation'
    );
    const { PROPOSAL_PRICING_STRUCTURES } = await import('./types/proposal.types');
    // Mesmo fato de negocio de antes, na estrutura de composicao por linhas: uma proposta por
    // itens exige ao menos uma linha, e cada linha exige descricao e valor de venda.
    const itemized = {
      ...EMPTY_PROPOSAL_FORM,
      pricingStructure: PROPOSAL_PRICING_STRUCTURES.Itemized,
    };
    const withoutLines = validateProposalForm(itemized, 'create');
    expect(withoutLines.itemsRequired).toBeTruthy();

    const withEmptyLine = validateProposalForm(
      { ...itemized, items: [createProposalItemRow()] },
      'create',
    );
    expect(withEmptyLine.items?.[0]?.description).toBeTruthy();
    expect(withEmptyLine.items?.[0]?.lineSaleAmount).toBeTruthy();
  });
});
