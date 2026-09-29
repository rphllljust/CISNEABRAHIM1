import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { FiscalDocumentsPage } from './pages/FiscalDocumentsPage';

/**
 * Bancada operacional do Fiscal — o que a tela promete ao operador.
 *
 * Prova três coisas, todas com dado de servidor:
 * (a) unidade e competência são ESCOLHAS HUMANAS (select alimentado pelo servidor), sem
 *     campo livre e sem identificador digitado;
 * (b) recorte que chega por URL (Mesa de Fechamento / Ctrl+K) chega à consulta;
 * (c) total e estado vazio são honestos: o zero vem do servidor e "não existe documento
 *     ainda" não é confundido com "o recorte não devolveu nada".
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function renderFiscalDocuments(initialEntry: string) {
  renderWithProviders(
    <Routes>
      <Route path="/app/fiscal/documents" element={<FiscalDocumentsPage />} />
      <Route path="/app/fiscal/documents/:fiscalDocumentId" element={<FiscalDocumentsPage />} />
    </Routes>,
    { router: { initialEntries: [initialEntry] } },
  );
}

function requestUrls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
  return fetchMock.mock.calls.map(([input]) =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
}

function documentListUrls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
  return requestUrls(fetchMock).filter((url) => url.includes('/api/v1/fiscal/documents?'));
}

describe('Fiscal — bancada de documentos', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('escolhe unidade e competência como referências humanas, sem identificador digitado', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderFiscalDocuments('/app/fiscal/documents');

    await waitFor(() => {
      expect(documentListUrls(fetchMock).length).toBeGreaterThan(0);
    });

    // Unidade: select alimentado pelo contexto de unidades operacionais do shell.
    const unitControl = screen.getByLabelText(/unidade/i);
    expect(unitControl.tagName).toBe('SELECT');
    /*
     * PROVA NEGATIVA: o identificador interno da unidade NAO aparece como texto da
     * opcao. O `value` continua sendo o valor real — o recorte enviado a API e
     * verificado logo abaixo e segue igual; o que o operador LE passa a ser o escopo,
     * nao o slug interno.
     */
    expect(screen.queryByText('unit-1')).toBeNull();
    /*
     * O rotulo da opcao vem do dicionario UNICO de unidade (`OperationalUnitOptions`, do
     * shell): com uma unica unidade autorizada o texto e "Unidade autorizada". Antes a tela
     * montava o proprio "Unidade N", o que fazia o mesmo recorte ter dois nomes diferentes
     * conforme a superficie.
     */
    expect(within(unitControl).getByRole('option', { name: 'Unidade autorizada' })).toBeTruthy();

    // Competência: select alimentado pela lista REAL de períodos fiscais (`periodKey`),
    // exibida como MM/AAAA — o `id` do período não é a referência primária.
    const competenceControl = screen.getByLabelText(/competência/i);
    expect(competenceControl.tagName).toBe('SELECT');
    const option = await within(competenceControl).findByRole('option', {
      name: /08\/2026/,
    });
    expect((option as HTMLOptionElement).value).toBe('2026-08');
    expect(UUID.test((option as HTMLOptionElement).value)).toBe(false);

    // Nenhum campo livre de identificador para unidade/competência.
    expect(screen.queryByRole('textbox', { name: /unidade|competência/i })).toBeNull();

    // A consulta sai com a unidade real do contexto e sem identificador de registro.
    const listUrls = documentListUrls(fetchMock);
    expect(listUrls.some((url) => url.includes('unitId=unit-1'))).toBe(true);
    expect(listUrls.some((url) => UUID.test(url))).toBe(false);
  });

  it('envia a competência escolhida como recorte de emissão daquele mês', async () => {
    const user = userEvent.setup();
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderFiscalDocuments('/app/fiscal/documents');

    await waitFor(() => {
      expect(documentListUrls(fetchMock).length).toBeGreaterThan(0);
    });

    await user.selectOptions(screen.getByLabelText(/competência/i), '2026-08');

    await waitFor(() => {
      expect(
        documentListUrls(fetchMock).some(
          (url) => url.includes('issuedFrom=2026-08-01') && url.includes('issuedTo=2026-08-31'),
        ),
      ).toBe(true);
    });
    // O critério que foi para a API aparece na tela em linguagem humana.
    expect(screen.getByText(/emissão de 2026-08-01 a 2026-08-31/i)).toBeInTheDocument();
    expect(screen.getByText(/competência: 08\/2026/i)).toBeInTheDocument();
  });

  it('leva à API a situação que chegou pelo URL', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderFiscalDocuments('/app/fiscal/documents?status=REJECTED');

    await waitFor(() => {
      expect(documentListUrls(fetchMock).some((url) => url.includes('status=REJECTED'))).toBe(true);
    });
    expect(screen.getByLabelText(/situação/i)).toHaveValue('REJECTED');
    expect(screen.getByText(/situação: Rejeitado/i)).toBeInTheDocument();
  });

  it('honra a unidade trazida pelo link da Mesa de Fechamento', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    // `unitId` não é token enumerado: entra pela query string e a tela o usa na consulta.
    renderFiscalDocuments('/app/fiscal/documents?status=REJECTED&unitId=unit-9');

    await waitFor(() => {
      expect(
        documentListUrls(fetchMock).some(
          (url) => url.includes('unitId=unit-9') && url.includes('status=REJECTED'),
        ),
      ).toBe(true);
    });
    expect(screen.getByLabelText(/unidade/i)).toHaveValue('unit-9');
  });

  it('mostra o total real do servidor e distingue recorte sem resultado de unidade sem documento', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ fiscalDocumentCount: 0 }));
    renderFiscalDocuments('/app/fiscal/documents?status=REJECTED');

    // Sem unidade escolhida a tela nem consulta: espera o contexto entrar em vigor.
    await waitFor(() => {
      expect(screen.getByLabelText(/unidade/i)).toHaveValue('unit-1');
    });
    expect(await screen.findByText(/0 documentos na fila/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum documento para os filtros selecionados/i)).toBeInTheDocument();
    // Aqui NÃO se afirma que a unidade não tem documento algum: só o recorte está vazio.
    expect(screen.queryByText(/registrado para esta unidade ainda/i)).toBeNull();
  });

  it('afirma "nenhum documento ainda" só quando não há recorte aplicado', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ fiscalDocumentCount: 0 }));
    renderFiscalDocuments('/app/fiscal/documents');

    await waitFor(() => {
      expect(screen.getByLabelText(/unidade/i)).toHaveValue('unit-1');
    });
    expect(await screen.findByText(/0 documentos na fila/i)).toBeInTheDocument();
    expect(
      screen.getByText(/nenhum documento fiscal registrado para esta unidade ainda/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/para os filtros selecionados/i)).toBeNull();
  });
});
