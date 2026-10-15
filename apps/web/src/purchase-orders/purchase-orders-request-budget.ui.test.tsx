import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { createCommercialFetchMock } from '../test/commercial-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { parseRequestPath } from '../test/request-url';

/**
 * ORÇAMENTO DE REQUISIÇÕES — a superfície nova não pode multiplicar consultas.
 *
 * O filtro avançado é dirigido por metadado e sua árvore vive na URL. A implementação ingênua
 * coloca o payload convertido nas dependências do carregador da fila; como a leitura da árvore
 * devolve um OBJETO NOVO a cada render, o carregador troca de identidade a cada render e a fila
 * refaz a consulta indefinidamente — o defeito clássico de refetch por identidade instável.
 *
 * Este teste conta as requisições da LISTAGEM durante uma permanência ociosa na tela. Não é teste
 * de tempo: é teste de QUANTIDADE, que é a causa real e a que não pode regredir.
 */

beforeEach(() => {
  resetTokenStoreForTests();
});

describe('PurchaseOrdersListPage — orçamento de requisições', () => {
  it('does not re-query the listing while the operator is idle on the screen', async () => {
    const shell = createShellFetchMock();
    const commercial = createCommercialFetchMock();

    let listingCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === '/api/v1/commercial/purchase-orders') {
        listingCalls += 1;
        return jsonResponse({
          items: [],
          limit: 20,
          offset: 0,
          summary: { recordCount: 0, currencies: [] },
        });
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
    await user.click(await screen.findByRole('link', { name: /pedidos de compra/i }));

    // Espera a lista montar e a primeira consulta concluir.
    await waitFor(() => {
      expect(listingCalls).toBeGreaterThan(0);
    });

    const afterFirstLoad = listingCalls;

    // PERMANÊNCIA OCIOSA: o operador apenas observa a tela. Nada muda no recorte, então NADA pode
    // disparar nova consulta. Uma espera real de relógio é o que expõe o refetch em laço.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(listingCalls).toBe(afterFirstLoad);
  }, 30000);
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}
