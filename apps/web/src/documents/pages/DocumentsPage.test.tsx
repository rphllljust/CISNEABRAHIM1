import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsPage } from './DocumentsPage';
import { renderWithProviders } from '../../test/render-with-providers';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createDocumentsFetchHandler } from '../../test/documents-fetch-mock';
import { createShellFetchMock } from '../../test/shell-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { DOCUMENT_CATEGORIES } from '../types/document.types';

const UAT_TITLE = 'Evidência UAT — Locação de equipamento';

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/documents" element={<DocumentsPage />} />
    </Routes>,
    { router: { initialEntries: ['/app/documents'] } },
  );
}

/**
 * Mock da pagina: a listagem de documentos e resolvida pelo handler compartilhado (que honra
 * `q`/`categoryCode`, como o servidor) e o restante do shell fica com o mock padrao.
 */
function createPageFetchMock(
  options: Parameters<typeof createDocumentsFetchHandler>[0] = {},
  override?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | null,
) {
  const shell = createShellFetchMock();
  const documents = createDocumentsFetchHandler(options);
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const overridden = override?.(input, init);
    if (overridden) {
      return overridden;
    }
    const { pathname, searchParams } = parseRequestPath(input);
    const response = documents.handle(pathname, init?.method ?? 'GET', init, searchParams);
    return response ?? shell(input, init);
  });
  return { mock, documents };
}

function seed(
  documents: ReturnType<typeof createDocumentsFetchHandler>,
  index: number,
  title: string,
  categoryCode: string,
  unitId = 'unit-synthetic-homolog',
) {
  return documents.seedDocument(
    `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
    unitId,
    title,
    'evidencia-uat.pdf',
    { categoryCode },
  );
}

/** Consulta de listagem que chegou ao servidor, ja decodificada. */
function listQueries(mock: ReturnType<typeof vi.fn>): URLSearchParams[] {
  return mock.mock.calls
    .map(([input]) => parseRequestPath(input as RequestInfo | URL))
    .filter(({ pathname }) => pathname === '/api/v1/documents')
    .map(({ searchParams }) => searchParams);
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows the document as the primary column with the metadata the contract really returns', async () => {
    const { mock, documents } = createPageFetchMock();
    seed(documents, 7, UAT_TITLE, DOCUMENT_CATEGORIES.Evidence);
    vi.stubGlobal('fetch', mock);

    renderPage();

    const table = await screen.findByRole('table', { name: /lista de documentos/i });
    // A asserção e por LINHA: o mock da plataforma ja semeia um documento padrao, entao "Ativo"
    // existe em mais de uma linha — o que importa e a hierarquia DENTRO da linha do documento.
    const row = within(table).getByText(UAT_TITLE).closest('tr') as HTMLElement;
    const cells = within(row);
    // Coluna principal: o titulo.
    expect(cells.getByText(UAT_TITLE)).toBeInTheDocument();
    // Linha secundaria: so metadados que a LISTAGEM devolve. Mimetype e tamanho vivem na versao,
    // que esta rota nao carrega — exibi-los seria inventar dado.
    expect(cells.getByText('Evidência · Interno')).toBeInTheDocument();
    expect(cells.getByText('Ativo')).toBeInTheDocument();
    expect(cells.getByText('v1')).toBeInTheDocument();
    expect(cells.getByText('unit-synthetic-homolog')).toBeInTheDocument();
    for (const header of ['Documento', 'Situação', 'Versão', 'Unidade', 'Atualizado', 'Arquivo']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.queryByText('PDF')).not.toBeInTheDocument();
  });

  it('commits the timestamp with seconds so distinct runs of the same title differ', async () => {
    const { mock, documents } = createPageFetchMock();
    seed(documents, 1, UAT_TITLE, DOCUMENT_CATEGORIES.Evidence);
    vi.stubGlobal('fetch', mock);

    renderPage();

    const table = await screen.findByRole('table', { name: /lista de documentos/i });
    // O runner de UAT cria um documento novo por execucao, com titulos identicos; sem segundos,
    // duas linhas legitimamente distintas ficariam indistinguiveis.
    const updated = within(table).getAllByText(/\d{2}:\d{2}:\d{2}/);
    expect(updated.length).toBeGreaterThan(0);
  });

  it('gives the download action a real button carrying the document in its accessible name', async () => {
    const { mock, documents } = createPageFetchMock();
    seed(documents, 1, 'Contrato assinado', DOCUMENT_CATEGORIES.General);
    vi.stubGlobal('fetch', mock);

    renderPage();

    // Mesmo fluxo de download de antes, agora como BOTAO do design system e nao como texto solto.
    // Em listas com titulos repetidos, "Baixar" sozinho nao diz QUAL documento sera baixado.
    const button = await screen.findByRole('button', { name: 'Baixar Contrato assinado' });
    expect(button).toHaveTextContent('Baixar');
    expect(button.className).toContain('border-gray-300');
  });

  it('resolves search and type on the server instead of filtering the loaded page', async () => {
    const { mock, documents } = createPageFetchMock();
    seed(documents, 1, UAT_TITLE, DOCUMENT_CATEGORIES.Evidence);
    seed(documents, 2, 'Contrato assinado', DOCUMENT_CATEGORIES.General);
    vi.stubGlobal('fetch', mock);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Contrato assinado');

    // Tipo: usa o parametro ja publicado pelo backend.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'EVIDENCE');
    await waitFor(() => {
      expect(listQueries(mock).some((params) => params.get('categoryCode') === 'EVIDENCE')).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('Contrato assinado')).not.toBeInTheDocument();
    });

    // Busca: vai ao servidor apos o debounce, com o termo acentuado intacto.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), '');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'Locação');
    await waitFor(() => {
      expect(listQueries(mock).some((params) => params.get('q') === 'Locação')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(UAT_TITLE)).toBeInTheDocument();
    });
    expect(screen.queryByText('Contrato assinado')).not.toBeInTheDocument();
  });

  it('distinguishes an empty catalogue from a search without results, and offers a way back', async () => {
    // Escopo sem NENHUM documento. O mock da plataforma semeia um documento por padrao, entao a
    // listagem vazia e declarada explicitamente em vez de presumida.
    const { mock } = createPageFetchMock({}, (input, init) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === '/api/v1/documents' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], limit: 100, offset: 0 }),
        } as Response);
      }
      return null;
    });
    vi.stubGlobal('fetch', mock);

    const empty = renderPage();
    expect(
      await screen.findByText(/nenhum documento disponível no seu escopo/i),
    ).toBeInTheDocument();
    empty.unmount();

    const seeded = createPageFetchMock();
    seed(seeded.documents, 1, 'Contrato assinado', DOCUMENT_CATEGORIES.General);
    vi.stubGlobal('fetch', seeded.mock);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Contrato assinado');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'Zinco inexistente');
    expect(
      await screen.findByText(/nenhum documento corresponde aos filtros aplicados/i),
    ).toBeInTheDocument();
    // "Sem resultado" nao repete o estado de acervo vazio.
    expect(
      screen.queryByText(/nenhum documento disponível no seu escopo/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /limpar filtros/i }));
    expect(await screen.findByText('Contrato assinado')).toBeInTheDocument();
  });

  it('keeps the loaded documents visible while a new filter is being resolved', async () => {
    // Trocar a tela inteira por "Carregando…" a cada ajuste de filtro apagaria a tabela e o campo
    // de busca no meio da digitacao.
    let release: (response: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { mock, documents } = createPageFetchMock({}, (input, init) => {
      const { pathname, searchParams } = parseRequestPath(input);
      if (
        pathname === '/api/v1/documents' &&
        (init?.method ?? 'GET') === 'GET' &&
        searchParams.get('categoryCode') === 'EVIDENCE'
      ) {
        return gate;
      }
      return null;
    });
    seed(documents, 1, UAT_TITLE, DOCUMENT_CATEGORIES.Evidence);
    vi.stubGlobal('fetch', mock);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(UAT_TITLE);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'EVIDENCE');

    // Em curso: a tabela anterior continua no lugar, com o campo de busca e o aviso de atualizacao.
    await waitFor(() => {
      expect(screen.getByText(/atualizando/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByText(UAT_TITLE)).toBeInTheDocument();
    // O indicador de atualizacao fica no cartao da tabela (o proprio DataTable ja abre o contêiner
    // de rolagem horizontal).
    expect(
      screen.getByRole('table', { name: /lista de documentos/i }).closest('[aria-busy]'),
    ).toHaveAttribute('aria-busy', 'true');

    release({
      ok: true,
      status: 200,
      json: async () => ({ items: [], limit: 100, offset: 0 }),
    } as Response);

    await waitFor(() => {
      expect(screen.getByText(/nenhum documento corresponde aos filtros aplicados/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/atualizando/i)).not.toBeInTheDocument();
  });

  it('shows access denied when listing is forbidden', async () => {
    const { mock } = createPageFetchMock({ documentsReadAllowed: false });
    vi.stubGlobal('fetch', mock);

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem permissão/i);
  });

  it('offers retry when the list fails', async () => {
    const base = createPageFetchMock();
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (pathname === '/api/v1/documents' && (init?.method ?? 'GET') === 'GET') {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return base.mock(input, init);
    });
    vi.stubGlobal('fetch', mock);

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('says honestly when the page came full instead of presenting it as the whole archive', async () => {
    const { mock, documents } = createPageFetchMock();
    for (let index = 0; index < 100; index += 1) {
      seed(documents, index + 1, `Documento ${index + 1}`, DOCUMENT_CATEGORIES.General);
    }
    vi.stubGlobal('fetch', mock);

    renderPage();

    expect(await screen.findByText(/100 documentos mais recentes/i)).toBeInTheDocument();
  });

  it('truncates a long title visually without losing the full value', async () => {
    const longTitle = `Evidência UAT — ${'Locação de equipamento '.repeat(6).trim()}`;
    const { mock, documents } = createPageFetchMock();
    seed(documents, 1, longTitle, DOCUMENT_CATEGORIES.Evidence);
    vi.stubGlobal('fetch', mock);

    renderPage();

    const title = await screen.findByText(longTitle);
    expect(title).toHaveAttribute('title', longTitle);
    expect(title.className).toContain('truncate');
  });
});
