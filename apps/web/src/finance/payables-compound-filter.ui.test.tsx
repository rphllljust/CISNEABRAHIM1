import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { PayablesListPage } from './pages/PayablesListPage';

/**
 * Identidade HUMANA da linha, lida do atributo `data-field="external_reference"` da célula.
 *
 * NÃO se usa `getByText(/^AP-\d+$/)`: em pagáveis a MESMA referência aparece duas vezes na linha
 * (referência externa E referência de origem), e um matcher por texto encontraria dois elementos e
 * lançaria. Mirar a coluna certa é o que a tela realmente afirma.
 */
function rowIdentifiers(): string[] {
  return screen.getAllByTestId('dynamic-list-row').map((row) => {
    const cell = row.querySelector('[data-field="external_reference"]');
    return cell?.textContent ?? '';
  });
}

/**
 * FILTRO COMPOSTO EM CONTAS A PAGAR — A ÁRVORE TEM DE CHEGAR AO SERVIDOR.
 *
 * Mesmo defeito corrigido em recebíveis: o construtor AND/OR aparecia na tela, mas a árvore era
 * aplicada SÓ no navegador (`byBuilder` filtrava a página carregada). Numa carteira maior que uma
 * página, "nenhuma obrigação" não significava "não existe" — significava "não está entre as linhas
 * carregadas", e o indicador ao lado seguia contando o conjunto não filtrado.
 *
 * O aging é o caso de fronteira desta tela: ele CONTINUA local, porque o servidor não o aceita como
 * parâmetro. O teste abaixo prova que essa diferença é real e explícita — e que a árvore, essa sim,
 * viaja.
 */
describe('Contas a pagar — o recorte composto vai ao servidor', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function listCalls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
    return fetchMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((url) => url.includes('/finance/payables') && !url.includes('/summary'));
  }

  async function openBuilderAndGetFieldSelect(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<PayablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AP-001');
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

    // `origin_reference` é campo PRÓPRIO de pagáveis — não existe em recebíveis.
    await user.selectOptions(fieldSelect, 'origin_reference');
    await user.selectOptions(screen.getByTestId('dynamic-filter-rule-op'), 'contains');
    await user.type(screen.getByTestId('dynamic-filter-rule-value'), 'OC-1');

    await waitFor(() => {
      expect(
        listCalls(fetchMock).some((url) =>
          decodeURIComponent(url).includes('"value":"OC-1"'),
        ),
      ).toBe(true);
    });

    const url = listCalls(fetchMock).find((candidate) =>
      decodeURIComponent(candidate).includes('"value":"OC-1"'),
    )!;
    const raw = decodeURIComponent(url.slice(url.indexOf('filters=') + 'filters='.length));
    const payload = JSON.parse(raw) as {
      connector: string;
      groups: Array<{ conditions: Array<{ field: string; operator: string; value: string }> }>;
    };

    // O contrato do servidor: campo traduzido para o nome do CONTRATO, não o do metadado.
    expect(payload.groups[0]!.conditions[0]).toEqual({
      field: 'originReference',
      operator: 'contains',
      value: 'OC-1',
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

    expect(options).not.toContain('status');
    expect(options).not.toContain('lifecycle');
    // E o campo que DIFERENCIA esta fila está presente.
    expect(options).toContain('origin_reference');
  });

  it('sem árvore composta, nenhum `filters` é inventado na consulta', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PayablesListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('AP-001');
    });

    const urls = listCalls(fetchMock);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => !url.includes('filters='))).toBe(true);
  });
});
