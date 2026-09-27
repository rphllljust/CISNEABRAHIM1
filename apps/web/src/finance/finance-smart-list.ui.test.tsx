import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { PayablesListPage } from './pages/PayablesListPage';
import { ReceivablesListPage } from './pages/ReceivablesListPage';

/**
 * Mecanismos transversais aplicados às listas financeiras:
 * visão salva, contador real, ordenação, drill-down, prova negativa de bulk,
 * contexto lateral e estado vazio humano.
 */

function readAllStorage(): string {
  const parts: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key) {
      parts.push(key, window.localStorage.getItem(key) ?? '');
    }
  }
  return parts.join('|');
}

describe('Financeiro — smart lists e mecanismos de operação', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('aplica a visão de sistema "Vencidos" e mostra estado vazio humano, não uma tabela vazia', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });

    // O mock devolve títulos OPEN: a visão Vencidos precisa ficar vazia de verdade.
    await user.click(screen.getByRole('button', { name: 'Vencidos' }));

    await waitFor(() => {
      expect(screen.getByText(/nenhum título nesta visão/i)).toBeInTheDocument();
    });
    // O estado vazio explica o recorte em vez de parecer que a carteira sumiu.
    expect(screen.getByText(/ajuste o filtro ou limpe a visão/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AR-001' })).not.toBeInTheDocument();
  });

  it('salva uma visão e persiste SOMENTE configuração — nunca dado de negócio', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });

    // Aplica um filtro real para habilitar o salvamento.
    await user.selectOptions(screen.getByLabelText('Status'), 'OPEN');
    await user.click(screen.getByRole('button', { name: '+ Salvar visão' }));
    await user.type(screen.getByLabelText('Nome da nova visão'), 'Minhas pendências');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      const stored = readAllStorage();
      expect(stored).toContain('Minhas pendências');
    });

    const stored = readAllStorage();
    // Configuração de visualização: o valor enumerado do filtro é esperado.
    expect(stored).toContain('OPEN');
    // PROVA: nenhum dado de negócio foi para o browser.
    expect(stored).not.toContain('AR-001');
    expect(stored).not.toContain('1500');
    expect(stored).not.toContain('client-1');
    expect(stored).not.toContain('so-1');
    expect(stored).not.toContain('2026-09-10');
  });

  it('exporta em lote APENAS os selecionados — o não selecionado não é processado', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 3 }));

    const captured: { parts: string[]; text: () => Promise<string> }[] = [];
    class CapturingBlob {
      parts: string[];
      constructor(parts: unknown[]) {
        this.parts = parts.filter((part): part is string => typeof part === 'string');
        captured.push(this);
      }
      text() {
        return Promise.resolve(this.parts.join(''));
      }
    }
    vi.stubGlobal('Blob', CapturingBlob);
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

    renderWithProviders(<ReceivablesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'AR-002' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar AR-001' }));
    expect(screen.getByText(/1 selecionado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exportar selecionados (CSV)' }));

    expect(captured).toHaveLength(1);
    const content = await captured[0]!.text();
    expect(content).toContain('AR-001');
    // PROVA NEGATIVA OBRIGATÓRIA: o item não selecionado não entra no processamento.
    expect(content).not.toContain('AR-002');
  });

  it('abre a prévia lateral só com o payload autorizado e oferece o atalho ao detalhe', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Prévia de AR-001' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Contexto do título')).toBeInTheDocument();
    expect(within(dialog).getByText('Vencimento')).toBeInTheDocument();
    expect(within(dialog).getByText('Saldo')).toBeInTheDocument();
    // A cadeia empresarial usa os vínculos reais do payload.
    expect(within(dialog).getByText(/Ordem de serviço/)).toBeInTheDocument();
    expect(within(dialog).getByText('so-1')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /abrir título completo/i }),
    ).toBeInTheDocument();
  });

  it('todo KPI tem caminho até o dado: os indicadores são links para a lista filtrada', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Vencidos/ })).toHaveAttribute(
      'href',
      '/app/finance/receivables?status=OVERDUE',
    );
    expect(screen.getByRole('link', { name: /Recebidos/ })).toHaveAttribute(
      'href',
      '/app/finance/receivables?status=PAID',
    );
  });

  it('ordena por coluna e expõe aria-sort, sem alterar o payload', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AR-001' })).toBeInTheDocument();
    });

    const balanceHead = screen.getByRole('columnheader', { name: /Saldo/ });
    expect(balanceHead).toHaveAttribute('aria-sort', 'none');

    await user.click(within(balanceHead).getByRole('button'));
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Saldo/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
    });
  });

  it('contas a pagar expõe aging como dimensão filtrável e drill-down por aging', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<PayablesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'AP-001' })).toBeInTheDocument();
    });

    // O aging do mock é CURRENT, então a visão 90+ precisa ficar vazia.
    await user.click(screen.getByRole('button', { name: 'Aging 90+' }));
    await waitFor(() => {
      expect(screen.getByText(/nenhum título nesta visão/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Aging 90\+/ })).toHaveAttribute(
      'href',
      '/app/finance/payables?agingBucket=90_PLUS',
    );
  });
});
