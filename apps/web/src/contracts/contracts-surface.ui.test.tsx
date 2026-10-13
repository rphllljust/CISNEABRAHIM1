import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createContractsFetchMock } from './contracts-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';

/**
 * PROVA DE SUPERFÍCIE — CONTRATOS.
 *
 * O contrato de listagem já aceitava situação, busca, janela de VIGÊNCIA e filtro avançado
 * composto, e a tela só oferecia cliente e unidade. Este teste afirma que os CONTROLES e as REGIÕES
 * existem no DOM depois de autenticar — a diferença entre "o backend está pronto" e "o operador
 * consegue usar".
 *
 * A navegação é feita pelo histórico (mesmo helper do e2e do módulo): a entrada de Contratos na
 * sidebar depende de feature flag, e o caminho de produção continua sendo a rota.
 */

beforeEach(() => {
  resetTokenStoreForTests();
});

function openContractsNav(): void {
  window.history.pushState({}, '', '/app/contracts');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('ContractsListPage — superfície operacional', () => {
  it('exposes search, status, effective window and the advanced filter surface', async () => {
    const mock = createContractsFetchMock();
    vi.stubGlobal('fetch', mock.fetch);

    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    openContractsNav();

    await screen.findByRole('heading', { name: /^contratos$/i }, { timeout: 10000 });

    // CONTROLES QUE O SERVIDOR JÁ EXECUTAVA E A TELA NÃO OFERECIA.
    await waitFor(() => {
      expect(document.getElementById('contract-search')).not.toBeNull();
    });
    expect(document.getElementById('contract-status-filter')).not.toBeNull();

    // JANELA DE VIGÊNCIA — o recorte mais próprio deste domínio.
    expect(document.getElementById('contract-effective-from')).not.toBeNull();
    expect(document.getElementById('contract-effective-to')).not.toBeNull();

    // A superfície de filtro avançado existe como REGIÃO PRÓPRIA da work area.
    expect(document.querySelector('[data-region="advanced-filter-surface"]')).not.toBeNull();
  });
});
