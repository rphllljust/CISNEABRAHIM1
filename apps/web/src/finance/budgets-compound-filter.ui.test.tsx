import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { BudgetsListPage } from './pages/BudgetsListPage';

/** Identidade HUMANA da linha, lida da célula do código. */
function rowIdentifiers(): string[] {
  return screen.getAllByTestId('dynamic-list-row').map((row) => {
    const cell = row.querySelector('[data-field="code"]');
    return cell?.textContent ?? '';
  });
}

/**
 * FILTRO COMPOSTO EM ORÇAMENTOS.
 *
 * Aqui o defeito era de AUSÊNCIA, não de máscara: a tela oferecia um termo de busca e UM valor de
 * situação, e combinar "situação ACTIVE E moeda BRL E criado depois de X" não era expressável. Não
 * havia construtor para corrigir — havia um vazio a preencher, já pelo caminho correto (a árvore vai
 * ao servidor; nada é refiltrado no navegador).
 *
 * `status` ENTRA no allow-list desta entidade, e a diferença em relação a recebíveis/pagáveis é de
 * domínio: `fin.budgets` TEM coluna de situação; as filas de títulos derivam a sua. O teste abaixo
 * trava essa diferença em vez de assumir que as três telas são iguais.
 */
describe('Orçamentos — o recorte composto vai ao servidor', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function listCalls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
    return fetchMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter((url) => url.includes('/finance/budgets'));
  }

  async function openBuilderAndGetFieldSelect(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<BudgetsListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('ORC-001');
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

    await user.selectOptions(fieldSelect, 'code');
    await user.selectOptions(screen.getByTestId('dynamic-filter-rule-op'), 'contains');
    /*
     * Um valor CORTO e digitado de uma vez: a tela re-renderiza a cada mudança da árvore, e digitar
     * caractere a caractere faria a asserção medir o remonte do componente em vez do contrato.
     */
    await user.type(screen.getByTestId('dynamic-filter-rule-value'), 'O');

    await waitFor(() => {
      expect(
        listCalls(fetchMock).some((url) => decodeURIComponent(url).includes('"value":"O"')),
      ).toBe(true);
    });

    const withFilters = listCalls(fetchMock).filter((candidate) =>
      decodeURIComponent(candidate).includes('"value":"O"'),
    );
    const url = withFilters[withFilters.length - 1]!;
    const raw = decodeURIComponent(url.slice(url.indexOf('filters=') + 'filters='.length));
    const payload = JSON.parse(raw) as {
      connector: string;
      groups: Array<{ conditions: Array<{ field: string; operator: string; value: string }> }>;
    };

    /*
     * O contrato do servidor: campo e operador traduzidos. `code` mantém o próprio nome (é o nome do
     * contrato também), e `contains` é o operador do contrato para o `contains` da engine.
     */
    expect(payload.groups[0]!.conditions[0]!.field).toBe('code');
    expect(payload.groups[0]!.conditions[0]!.operator).toBe('contains');
    expect(payload.groups[0]!.conditions[0]!.value).toBe('O');
  });

  it('OFERECE situação no construtor — a entidade tem coluna de status', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    const fieldSelect = await openBuilderAndGetFieldSelect(user);
    const options = Array.from(fieldSelect.querySelectorAll('option')).map(
      (option) => option.getAttribute('value') ?? '',
    );

    /*
     * PROVA POSITIVA da diferença de domínio: ao contrário de recebíveis e pagáveis (que derivam a
     * situação e por isso a excluem do recorte), orçamentos TEM a coluna `status` e o recorte
     * composto por situação é executável de verdade.
     */
    expect(options).toContain('status');
    // E `unit_id` fica fora: já é o filtro simples e o escopo de autorização.
    expect(options).not.toContain('unit_id');
  });

  it('sem árvore composta, nenhum `filters` é inventado na consulta', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<BudgetsListPage />, { metadata: true });
    await waitFor(() => {
      expect(rowIdentifiers()).toContain('ORC-001');
    });

    const urls = listCalls(fetchMock);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => !url.includes('filters='))).toBe(true);
  });
});
