import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { ReceivablesListPage } from './pages/ReceivablesListPage';

/** Identidade HUMANA da linha, lida do texto da célula de referência externa. */
function rowIdentifiers(): string[] {
  return screen
    .getAllByTestId('dynamic-list-row')
    .map((row) => within(row).getByText(/^A[RP]-\d+$/).textContent ?? '');
}

/**
 * FILTRO COMPOSTO EM CONTAS A RECEBER — A ÁRVORE TEM DE CHEGAR AO SERVIDOR.
 *
 * DEFEITO MEDIDO (corrigido nesta mudança): a worklist montava o construtor AND/OR desde a adoção
 * do padrão de worklists, mas a árvore era aplicada SÓ no navegador (`byBuilder` filtrava a página
 * carregada com `matchesFilterGroup`). O servidor nunca recebia o recorte.
 *
 * O que isso produzia, e é o que estes testes travam: numa carteira maior que uma página, compor um
 * filtro e ver "nenhum título" não significava "não existe" — significava "não está entre as
 * linhas carregadas". Os testes que já existiam passavam porque mediam a MÁSCARA, não o contrato.
 */
describe('Contas a receber — o recorte composto vai ao servidor', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  function listCalls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
    return fetchMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((url) => url.includes('/finance/receivables') && !url.includes('/summary'));
  }

  /** Abre o construtor e devolve o seletor de CAMPO da primeira regra. */
  async function openBuilderAndGetFieldSelect(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    const toggle = screen.getByTestId('dynamic-filter-builder-toggle');
    if (toggle.getAttribute('aria-expanded') !== 'true') {
      await user.click(toggle);
    }
    await user.click(screen.getByTestId('dynamic-filter-add-rule'));
    return screen.getByTestId('dynamic-filter-rule-field');
  }

  it('envia `filters` na consulta quando o operador compõe uma condição', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    const fieldSelect = await openBuilderAndGetFieldSelect(user);

    // O construtor só oferece campos marcados `in_filter` no metadata store; a moeda é um deles.
    await user.selectOptions(fieldSelect, 'currency_code');
    await user.selectOptions(screen.getByTestId('dynamic-filter-rule-op'), '=');
    await user.type(screen.getByTestId('dynamic-filter-rule-value'), 'BRL');

    await waitFor(() => {
      const withFilters = listCalls(fetchMock).filter((url) => url.includes('filters='));
      // Espera o valor COMPLETO: cada tecla dispara uma consulta, e afirmar na primeira provaria
      // que o recorte viaja — não que ele viaja inteiro.
      expect(
        withFilters.some((url) => decodeURIComponent(url).includes('"value":"BRL"')),
      ).toBe(true);
    });

    const url = listCalls(fetchMock).find((candidate) =>
      decodeURIComponent(candidate).includes('"value":"BRL"'),
    )!;
    const raw = decodeURIComponent(url.slice(url.indexOf('filters=') + 'filters='.length));
    const payload = JSON.parse(raw) as {
      connector: string;
      groups: Array<{ conditions: Array<{ field: string; operator: string; value: string }> }>;
    };

    // O contrato do servidor: campo traduzido para o nome do CONTRATO, não o do metadado.
    expect(payload.groups[0]!.conditions[0]).toEqual({
      field: 'currencyCode',
      operator: 'eq',
      value: 'BRL',
    });
  });

  it('NÃO oferece situação no construtor composto — o título não tem coluna de status', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    const fieldSelect = await openBuilderAndGetFieldSelect(user);
    const options = Array.from(fieldSelect.querySelectorAll('option')).map(
      (option) => option.getAttribute('value') ?? '',
    );

    /*
     * `lifecycle` é um recorte DIFERENTE do que o operador lê como situação (derivada de lifecycle
     * + liquidações + vencimento). Oferecê-lo trocaria um filtro correto por um quase-correto —
     * pior, porque parece funcionar. O recorte por situação continua no filtro simples.
     */
    expect(options).not.toContain('status');
    expect(options).not.toContain('lifecycle');
  });

  it('sem árvore composta, nenhum `filters` é inventado na consulta', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ReceivablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AR-001');
    });

    const urls = listCalls(fetchMock);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => !url.includes('filters='))).toBe(true);
  });
});
