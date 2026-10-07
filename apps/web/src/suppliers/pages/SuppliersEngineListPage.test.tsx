import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createSuppliersFetchMock } from '../../test/suppliers-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { SuppliersEngineListPage } from './SuppliersEngineListPage';

/**
 * WORKLIST DE FORNECEDORES — o que esta suíte protege.
 *
 * Antes, a tela era um `DynamicList` cru sem busca, sem filtro, sem paginação e sem comando.
 * Cada teste abaixo mede uma capacidade OPERACIONAL que passou a existir, não um detalhe de
 * markup:
 *   1. busca vai ao SERVIDOR (não filtra a página no navegador);
 *   2. filtro de estado vai ao servidor e a contagem usa o `total` autoritativo;
 *   3. o estado vazio do recorte é distinguível do vazio de origem;
 *   4. a exceção e a próxima ação aparecem em linguagem humana, sem enum cru;
 *   5. os comandos REAIS do backend ficam disponíveis na linha.
 */
describe('SuppliersEngineListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('lists suppliers by human reference and shows the authoritative total', async () => {
    vi.stubGlobal('fetch', createSuppliersFetchMock());
    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByText('Metalúrgica Aurora Ltda')).toBeInTheDocument();
    });

    expect(screen.getByRole('table', { name: 'Lista de fornecedores' })).toBeInTheDocument();
    // `total` do contrato é a contagem do conjunto filtrado: a faixa situa o operador no todo.
    expect(screen.getByText(/1–2 de 2/)).toBeInTheDocument();
    // A referência humana aparece; o UUID não.
    expect(screen.getByText('11.222.333/0001-44')).toBeInTheDocument();
    expect(screen.queryByText(/bbbbbbbb-bbbb/)).not.toBeInTheDocument();
  });

  it('sends the search term to the server instead of filtering the loaded page', async () => {
    const fetchMock = createSuppliersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByText('Metalúrgica Aurora Ltda')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'Aurora');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('/api/v1/suppliers') && url.includes('q=Aurora'))).toBe(
        true,
      );
    });

    // O fornecedor que NÃO casa some porque o SERVIDOR devolveu menos linhas, e o total cai junto.
    await waitFor(() => {
      expect(screen.getByText(/1–1 de 1/)).toBeInTheDocument();
    });
  });

  it('sends the state filter to the server', async () => {
    const fetchMock = createSuppliersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });
    await waitFor(() => {
      expect(screen.getByText('Metalúrgica Aurora Ltda')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Estado'), 'INACTIVE');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('status=INACTIVE'))).toBe(true);
    });
  });

  it('distinguishes an empty result of the filter from an empty registry', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createSuppliersFetchMock());
    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByText('Metalúrgica Aurora Ltda')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'Inexistente');

    // O recorte vazio NOMEIA o recorte e oferece a saída, em vez de dizer que o cadastro está vazio.
    // Dois botões "Limpar filtros" existem de propósito: o da toolbar (sempre visível com recorte
    // ativo) e o do painel de estado vazio (a saída no ponto onde o operador trava). Ambos limpam.
    await waitFor(() => {
      expect(
        screen.getByText('Nenhum fornecedor corresponde aos filtros aplicados.'),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' })).toHaveLength(2);
  });

  it('shows the exception and the next action in human language, never the raw enum', async () => {
    vi.stubGlobal('fetch', createSuppliersFetchMock());
    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByText('Transportes Vale Norte S.A.')).toBeInTheDocument();
    });

    const table = screen.getByRole('table', { name: 'Lista de fornecedores' });
    // O estado vem rotulado, com a exceção que explica o bloqueio da compra e o próximo passo.
    expect(within(table).getByText('Inativo')).toBeInTheDocument();
    expect(within(table).getByText('Não pode comprar')).toBeInTheDocument();
    expect(within(table).getByText('Reativar para comprar')).toBeInTheDocument();
    expect(within(table).getByText('Ativo')).toBeInTheDocument();
    // Nenhum enum cru chega ao operador.
    expect(within(table).queryByText('INACTIVE')).not.toBeInTheDocument();
    expect(within(table).queryByText('ACTIVE')).not.toBeInTheDocument();
  });

  /*
   * COMANDOS REAIS NO CONTEXTO — não repetidos em cada linha.
   *
   * O teste anterior exigia `data-testid="supplier-row-actions"` DENTRO da linha, ou seja, o mesmo
   * conjunto de botões repetido em todos os registros. Esse é o padrão CRUD que a função abandonou:
   * comandos idênticos em toda linha, apresentados sem o contexto do registro afetado, e com o
   * MOTIVO de inativação/arquivamento preenchido por texto fixo do frontend.
   *
   * O contrato agora é: a linha abre o CONTEXTO e os comandos válidos — publicados pelo próprio
   * backend em `available-actions` — aparecem lá, com o motivo informado pelo operador.
   */
  it('exposes the real backend commands in the row context, not repeated per row', async () => {
    vi.stubGlobal(
      'fetch',
      createSuppliersFetchMock({
        commands: [
          {
            comando: 'activate',
            label: 'Reativar',
            requer_permissao: 'suppliers:supplier:activate',
            usuario_tem_permissao: true,
          },
        ],
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByText('Metalúrgica Aurora Ltda')).toBeInTheDocument();
    });

    // Nenhum comando repetido na grade: a linha carrega apenas a identidade como drillback.
    expect(screen.queryAllByTestId('supplier-row-actions')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument();

    /*
     * DOIS GESTOS DISTINTOS, de propósito:
     *   - clicar a IDENTIDADE (link real) navega para a ficha completa — drillback;
     *   - clicar qualquer outra área da LINHA abre o CONTEXTO, sem sair da fila.
     * Por isso o teste clica na linha, e não no nome: o nome é um link de navegação.
     */
    const row = screen.getAllByRole('row')[1];
    if (!row) {
      throw new Error('a grade deveria ter ao menos uma linha de registro');
    }
    await user.click(row);

    const context = await screen.findByRole('dialog', { name: /contexto do fornecedor/i });
    expect(within(context).getByRole('button', { name: 'Reativar' })).toBeInTheDocument();
  });

  it('shows the denied state when the server refuses the list grant', async () => {
    vi.stubGlobal('fetch', createSuppliersFetchMock({ denied: true }));
    renderWithProviders(<SuppliersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});
