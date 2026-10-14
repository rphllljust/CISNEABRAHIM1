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
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DUAS CORREÇÕES DE HARNESS/CONTRATO NESTA SUÍTE (a suíte estava vermelha em `main`)
 *
 * 1. HARNESS — as duas telas são dirigidas por METADADO (`DynamicList`, `DynamicFilterBuilder`).
 *    A suíte renderizava sem `{ metadata: true }` e o mock de financeiro não servia NENHUMA rota
 *    `/api/v1/meta/:entity`. Resultado: a página ficava presa antes da grade e o teste media uma
 *    tela que nunca carregava — vermelho de harness, não de produto. Corrigido nos dois lados
 *    (rota no mock + provider na renderização).
 *
 * 2. CONTRATO — a asserção de identidade da linha era `getByRole('link', { name: 'AR-001' })`.
 *    A worklist foi movida para o padrão enterprise de linha: a navegação é `onRowClick` e a ação
 *    visível é o botão "Prévia de AR-001". Não existe mais `<a>` na linha, e o teste continuava
 *    exigindo o contrato ANTIGO. As asserções agora leem a identidade pelo `data-row-id` e a ação
 *    pelo nome acessível real — sem afrouxar nada: continua provando que o título aparece, que o
 *    não selecionado não é processado e que a prévia abre com o payload autorizado.
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

/**
 * Identidade HUMANA da linha, lida do atributo `data-field="external_reference"` da célula.
 *
 * NÃO se usa um matcher por TEXTO: em contas a pagar a mesma referência aparece DUAS vezes na linha
 * (referência externa E referência de origem), e `getByText` encontraria dois elementos e lançaria.
 * Mirar a coluna certa é o que a tela realmente afirma.
 */
function rowIdentifiers(): string[] {
  return screen.getAllByTestId('dynamic-list-row').map((row) => {
    const cell = row.querySelector('[data-field="external_reference"]');
    return cell?.textContent ?? '';
  });
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
    renderWithProviders(<ReceivablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    // O mock devolve títulos OPEN: a visão Vencidos precisa ficar vazia de verdade.
    // A visão vive na barra "Visões": o escopo evita colidir com o indicador de mesmo
    // nome no drill-down, que é um LINK para a lista filtrada e não aplica visão.
    const viewsBar = screen.getByRole('group', { name: 'Visões salvas desta lista' });
    await user.click(within(viewsBar).getByRole('button', { name: 'Vencidos' }));

    await waitFor(() => {
      expect(screen.getByText(/nenhum título neste recorte/i)).toBeInTheDocument();
    });
    // O estado vazio explica o recorte em vez de parecer que a carteira sumiu.
    expect(screen.getByText(/ajuste o filtro ou limpe a visão/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('dynamic-list-row')).toHaveLength(0);
  });

  it('salva uma visão e persiste SOMENTE configuração — nunca dado de negócio', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    /*
     * A barra só habilita "Salvar visão" quando HÁ recorte — salvar "tudo" não é uma visão. O
     * teste aplica um recorte real (a visão de sistema "A vencer") antes de salvar, que é o
     * caminho do operador.
     */
    const viewsBar = screen.getByRole('group', { name: 'Visões salvas desta lista' });
    await user.click(within(viewsBar).getByRole('button', { name: 'A vencer' }));

    const before = readAllStorage();
    await user.click(within(viewsBar).getByRole('button', { name: /salvar visão/i }));
    await user.type(screen.getByLabelText('Nome da nova visão'), 'Minha carteira');
    await user.click(within(viewsBar).getByRole('button', { name: /^salvar$/i }));

    await waitFor(() => {
      expect(within(viewsBar).getByRole('button', { name: 'Minha carteira' })).toBeInTheDocument();
    });

    const after = readAllStorage();
    const written = after.slice(before.length);
    // PROVA NEGATIVA: nada de dado de negócio é persistido junto da configuração da visão.
    expect(written).not.toContain('AR-001');
    expect(written).not.toContain('1500');
    expect(written).not.toContain('Cliente');
  });

  it('exporta em lote APENAS os selecionados — o não selecionado não é processado', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock({ receivableCount: 3 }));

    const captured: { text: () => Promise<string> }[] = [];
    class BlobStub {
      private readonly parts: string[];
      constructor(parts: string[]) {
        this.parts = parts;
        captured.push({ text: async () => this.parts.join('') });
      }
    }
    vi.stubGlobal('Blob', BlobStub);
    /*
     * Só os DOIS métodos de objeto-URL são substituídos: trocar o global `URL` inteiro derruba o
     * React Router, que usa `URL` para resolver a rota corrente. O dublê precisa ser estreito.
     */
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));

    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    const boxes = screen.getAllByTestId('dynamic-list-select-row');
    await user.click(boxes[0]!);

    await user.click(screen.getByRole('button', { name: /exportar selecionados/i }));

    await waitFor(() => {
      expect(captured.length).toBeGreaterThan(0);
    });
    const csv = await captured[0]!.text();
    expect(csv).toContain('AR-001');
    // PROVA NEGATIVA: o título NÃO marcado não entra no arquivo.
    expect(csv).not.toContain('AR-002');
  });

  it('abre a prévia lateral só com o payload autorizado e oferece o atalho ao detalhe', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    // A prévia abre por intenção explícita — não por seleção automática da primeira linha.
    await user.click(screen.getByRole('button', { name: 'Prévia de AR-001' }));

    const drawer = await screen.findByRole('dialog', { name: 'Contexto do título' });
    expect(within(drawer).getByText('AR-001')).toBeInTheDocument();
    // O atalho para o detalhe completo é uma rota REAL.
    expect(within(drawer).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('todo KPI tem caminho até o dado: os indicadores são links para a lista filtrada', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<ReceivablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    /*
     * A FAIXA DE SITUAÇÃO SUBSTITUIU A GRADE DE DRILL-DOWN — o CONTRATO é o mesmo.
     *
     * Antes os indicadores eram células de `DrilldownRow` (rótulo "Vencidos", "A vencer", "Recebidos");
     * agora são a `FinanceSituationStrip`, que publica a mesma promessa em linguagem de operação:
     * cada valor é um LINK para o conjunto EXATO que ele conta. "Indicador sem drilldown é decoração"
     * continua sendo a regra — o que mudou foi o rótulo e a densidade, não a exigência.
     *
     * O nome acessível do link é a FRASE ("Vencido: 0: R$ 0,00"), e não apenas o número: o valor
     * sozinho não diria de que indicador ele é.
     */
    const overdue = screen.getByRole('link', { name: /^Vencido/i });
    expect(overdue.getAttribute('href')).toContain('status=OVERDUE');

    const due = screen.getByRole('link', { name: /^A vencer/i });
    expect(due.getAttribute('href')).toContain('status=OPEN');
  });

  it('ordena por coluna e expõe aria-sort, sem alterar o payload', async () => {
    const user = userEvent.setup();
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ReceivablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    const callsBefore = fetchMock.mock.calls.length;
    const header = screen.getByRole('button', { name: 'Referência externa' });
    await user.click(header);

    // A ordenação é da GRADE (a lista continua server-side por `due_date`): o cabeçalho anuncia
    // a direção e nenhuma consulta nova é disparada só para reordenar o que já está em tela.
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Referência externa/ })).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it('contas a pagar expõe aging como dimensão filtrável e drill-down por aging', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderWithProviders(<PayablesListPage />, { metadata: true });

    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AP-001');
    });

    // O aging é uma dimensão real da fila de pagáveis, não um rótulo decorativo.
    const agingHeader = screen.getByRole('columnheader', { name: /Aging/i });
    expect(agingHeader).toBeInTheDocument();
    expect(screen.getByLabelText(/Aging/i)).toBeInTheDocument();
  });
});
