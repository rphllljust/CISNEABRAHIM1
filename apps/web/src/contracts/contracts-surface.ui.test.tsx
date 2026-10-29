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
  // Cada teste deve autenticar a partir de /login; o anterior navega por URL.
  window.history.pushState({}, '', '/login');
  vi.unstubAllGlobals();
});

function openContractsNav(path = '/app/contracts'): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('ContractsListPage — superfície operacional', () => {
  it('Contrato 360 recebe apenas OS filtradas pelo contrato e navega ao documento real', async () => {
    const mock = createContractsFetchMock();
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    openContractsNav();
    await user.click(await screen.findByRole('link', { name: 'CTR-ACT-001' }));
    const table = await screen.findByRole('table', { name: 'Ordens vinculadas ao contrato' });
    expect(table.querySelector('a[href="/app/service-orders/77777777-7777-4777-8777-000000000001"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Ver carteira do contrato' }))
      .toHaveAttribute('href', '/app/service-orders?contractId=aaaaaaaa-aaaa-4aaa-8aaa-00000000000a');
    const queries = mock.fetch.mock.calls.map(([input]) =>
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://127.0.0.1'));
    expect(queries.some((url) => url.pathname === '/api/v1/service-orders' &&
      url.searchParams.get('contractId') === 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a')).toBe(true);
  });

  it('Contrato 360 não revela a relação quando OS retorna 403', async () => {
    const mock = createContractsFetchMock({ linkedOrdersAccess: 'denied' });
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    openContractsNav();
    await user.click(await screen.findByRole('link', { name: 'CTR-ACT-001' }));
    await screen.findByRole('heading', { name: 'CTR-ACT-001' });
    await waitFor(() => {
      expect(screen.queryByText('Carregando ordens vinculadas…')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('table', { name: 'Ordens vinculadas ao contrato' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver carteira do contrato' })).not.toBeInTheDocument();
  });

  it('Contrato 360 distingue HTTP 500 de carteira vazia', async () => {
    const mock = createContractsFetchMock({ linkedOrdersAccess: 'error' });
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    openContractsNav();
    await user.click(await screen.findByRole('link', { name: 'CTR-ACT-001' }));
    expect(await screen.findByText(/A ausência de resposta não indica carteira vazia/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma ordem vinculada ao contrato/i)).not.toBeInTheDocument();
  });

  it('sem total autoritativo, mostra linhas mas não inventa contagem', async () => {
    const mock = createContractsFetchMock({ linkedOrdersAccess: 'unknown-total' });
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    openContractsNav();
    await user.click(await screen.findByRole('link', { name: 'CTR-ACT-001' }));
    expect(await screen.findByText('Total não publicado pelo servidor')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Ordens vinculadas ao contrato' })).toBeInTheDocument();
  });

  it('recebe o contexto do Customer 360 na URL e usa o mesmo recorte na API', async () => {
    const mock = createContractsFetchMock();
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    const foreignClientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    openContractsNav(`/app/contracts?clientId=${foreignClientId}`);
    await screen.findByRole('heading', { name: /^contratos$/i }, { timeout: 10000 });
    await waitFor(() => {
      const filtered = mock.fetch.mock.calls.some(([input]) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://127.0.0.1');
        return url.pathname === '/api/v1/commercial/contracts' &&
          url.searchParams.get('limit') === '20' &&
          url.searchParams.get('clientId') === foreignClientId;
      });
      expect(filtered).toBe(true);
    });
    expect(await screen.findByText('Nenhum contrato corresponde aos filtros aplicados.')).toBeInTheDocument();
    const currentUrl = new URL(window.location.href);
    expect(currentUrl.searchParams.get('clientId')).toBe(foreignClientId);
  });

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
