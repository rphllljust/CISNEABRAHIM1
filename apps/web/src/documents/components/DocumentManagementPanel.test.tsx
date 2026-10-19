import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { DocumentManagementPanel } from '../components/DocumentManagementPanel';
import { MOCK_DOCUMENT_ID } from '../../test/documents-fetch-mock';
import { createRequestsFetchMock } from '../../test/requests-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';

const scope = {
  kind: 'SERVICE_REQUEST' as const,
  unitId: 'unit-demo',
  entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  entityLabel: 'SR-2026-DEMO01',
};

describe('DocumentManagementPanel', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  function renderPanel(links: Array<{ id?: string; documentId: string; linkPurpose?: string }> = []) {
    const onLinksChange = vi.fn();
    renderWithProviders(
      <DocumentManagementPanel
        scope={scope}
        links={links.map((link) => ({
          id: link.id,
          documentId: link.documentId,
          linkPurpose: link.linkPurpose ?? 'EVIDENCE',
          createdAt: '2026-01-01T00:00:00.000Z',
        }))}
        onLinksChange={onLinksChange}
      />,
    );
    return { onLinksChange };
  }

  it('lists linked documents with responsive layout regions', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    renderPanel([{ id: 'link-1', documentId: MOCK_DOCUMENT_ID, linkPurpose: 'EVIDENCE' }]);

    await waitFor(() => {
      expect(screen.getAllByText(/anexo demo/i).length).toBeGreaterThan(0);
    });

    expect(document.querySelector('.doc-list--desktop')).toBeTruthy();
    expect(document.querySelector('.doc-list--mobile')).toBeTruthy();
    expect(screen.getByText(/downloads apenas por endpoints autorizados/i)).toBeInTheDocument();
  });

  it('uploads, shows progress and links document to scope', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    const { onLinksChange } = renderPanel([]);

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
    });

    const file = new File(['%PDF-1.4'], 'evidencia.pdf', { type: 'application/pdf' });
    const input = document.querySelector('.doc-upload input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getAllByText(/enviado com sucesso|vinculado com sucesso/i).length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(onLinksChange).toHaveBeenCalled();
    });
  });

  it('rejects invalid files from API validation', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: { invalidFile: true },
      }),
    );
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
    });

    const file = new File(['%PDF-1.4'], 'bad.pdf', { type: 'application/pdf' });
    const input = document.querySelector('.doc-upload input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/tipo de arquivo não permitido/i)).toBeInTheDocument();
    });
  });

  it('supports retry after failed upload', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: { uploadFailsOnce: true },
      }),
    );
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
    });

    const file = new File(['%PDF-1.4'], 'retry.pdf', { type: 'application/pdf' });
    const input = document.querySelector('.doc-upload input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
    const retryInput = document.querySelectorAll('.doc-upload input[type="file"]')[1] as HTMLInputElement;
    await user.upload(retryInput, file);

    await waitFor(() => {
      expect(screen.getAllByText(/enviado com sucesso|vinculado com sucesso/i).length).toBeGreaterThan(0);
    });
  });

  it('rejects invalid files on client before upload', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
    });

    const input = document.querySelector('.doc-upload input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['plain'], 'notes.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/tipo de arquivo não permitido/i)).toBeInTheDocument();
    });
  });

  it('shows version history without destructive overwrite messaging', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    renderPanel([{ id: 'link-1', documentId: MOCK_DOCUMENT_ID }]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /versões/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: /versões/i })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText(/não há sobrescrita destrutiva/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/versão atual/i).length).toBeGreaterThan(0);
    });
  });

  it('downloads via authorized content endpoint', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    renderPanel([{ id: 'link-1', documentId: MOCK_DOCUMENT_ID }]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /versões/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: /versões/i })[0]!);

    const downloadButton = (await screen.findAllByRole('button', { name: /baixar/i }))[0]!;
    await user.click(downloadButton);

    await waitFor(() => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const contentCalls = (fetchMock.mock.calls as Array<[RequestInfo, RequestInit?]>).filter(
        (call) => {
          const request = call[0];
          const url = typeof request === 'string' ? request : request instanceof Request ? request.url : '';
          return url.includes('/content');
        },
      );
      expect(contentCalls.length).toBeGreaterThan(0);
    });
  });

  it('denies unauthorized document read', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: { crossScopeDenied: true },
      }),
    );
    renderPanel([{ id: 'link-1', documentId: MOCK_DOCUMENT_ID }]);

    await waitFor(() => {
      expect(screen.getAllByText(/não tem permissão/i).length).toBeGreaterThan(0);
    });
  });

  it('blocks panel when document read is fully denied', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        // Negação declarada em `/me`: o painel projeta capabilities dos grants publicados,
        // então "sem permissão" precisa ser AUSÊNCIA de grant, não só uma flag do mock.
        documents: { documentsReadAllowed: false, documentsAllowed: false, grants: [] },
      }),
    );
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByText(/não tem permissão para visualizar documentos/i)).toBeInTheDocument();
    });
  });

  it('exposes accessible upload progress labels', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        documents: {},
      }),
    );
    renderPanel([]);

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
      expect(screen.getByText(/enviar documento/i)).toBeInTheDocument();
    });
  });
});

describe('DocumentUpload', () => {
  it('shows file metadata in queue', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createRequestsFetchMock({ documents: {} }));
    renderWithProviders(
      <DocumentManagementPanel scope={scope} links={[]} onLinksChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/selecionar arquivo/i)).toBeInTheDocument();
    });

    const file = new File(['%PDF'], 'meta.pdf', { type: 'application/pdf' });
    const input = document.querySelector('.doc-upload input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getAllByText('meta.pdf').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/PDF/).length).toBeGreaterThan(0);
    });
  });
});
