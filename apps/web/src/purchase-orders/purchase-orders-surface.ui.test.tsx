import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createCommercialFetchMock } from '../test/commercial-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { parseRequestPath } from '../test/request-url';

/**
 * PROVA DE SUPERFÍCIE — a capacidade PRECISA APARECER.
 *
 * O contrato de listagem de Pedidos de compra já aceitava busca, situação, janela de emissão e
 * filtro avançado composto, e NADA disso chegava à tela: o operador só podia recortar por cliente e
 * unidade. Capacidade existente e invisível é entrega incompleta.
 *
 * Este teste não verifica comportamento de rede detalhado: ele afirma que os CONTROLES e as REGIÕES
 * existem no DOM depois de autenticar. É a diferença entre "o backend está pronto" e "o operador
 * consegue usar".
 *
 * O mock de listagem é ajustado para uma página VAZIA de propósito: os controles de recorte
 * pertencem à superfície de trabalho e não podem depender de haver registro para aparecer.
 */

beforeEach(() => {
  resetTokenStoreForTests();
});

describe('PurchaseOrdersListPage — superfície operacional', () => {
  it('exposes search, status, issue window and the advanced filter surface', async () => {
    const shell = createShellFetchMock();
    const commercial = createCommercialFetchMock();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname: path } = parseRequestPath(input);

      // Listagem de pedidos: página VAZIA. A superfície de recorte não depende de dado.
      if (path === '/api/v1/commercial/purchase-orders') {
        return jsonResponse({ items: [], limit: 20, offset: 0 });
      }

      const commercialResponse = await commercial(input, init);
      if (commercialResponse) {
        return commercialResponse;
      }
      const shellResponse = await shell(input, init);
      if (shellResponse) {
        return shellResponse;
      }
      return jsonResponse({ items: [], limit: 20, offset: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    // Navega pela sidebar — o mesmo caminho do operador em produção.
    await user.click(await screen.findByRole('link', { name: /pedidos de compra/i }));

    // REGIÕES DA WORK AREA — a gramática declarada nas demais worklists.
    await waitFor(() => {
      expect(document.querySelector('[data-region="saved-view-surface"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-region="command-filter-surface"]')).not.toBeNull();
    expect(document.querySelector('[data-region="advanced-filter-surface"]')).not.toBeNull();

    // CONTROLES QUE O SERVIDOR JÁ SUSTENTAVA E A TELA NÃO OFERECIA.
    // Identificadores exatos: a tela tem mais de um campo de busca (global e da fila), e um
    // matcher por rótulo amplo passaria a apontar para o controle errado se a ordem mudasse.
    expect(document.getElementById('po-search')).not.toBeNull();
    expect(document.getElementById('po-status')).not.toBeNull();
    expect(document.getElementById('po-issue-from')).not.toBeNull();
    expect(document.getElementById('po-issue-to')).not.toBeNull();
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}
