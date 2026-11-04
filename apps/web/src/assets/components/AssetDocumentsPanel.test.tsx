import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetDocumentsPanel } from './AssetDocumentsPanel';
import { AssetDocumentsApiError } from '../api/asset-documents-api';

const { listLinked, attach, findDocs, listVersions } = vi.hoisted(() => ({
  listLinked: vi.fn(),
  attach: vi.fn(),
  findDocs: vi.fn(),
  listVersions: vi.fn(),
}));

vi.mock('../api/asset-documents-api', () => ({
  AssetDocumentsApiError: class AssetDocumentsApiError extends Error {
    constructor(readonly kind: string) { super(kind); }
  },
  listAssetDocuments: listLinked,
  attachAssetDocument: attach,
}));

vi.mock('../../documents/api/documents-api', () => ({
  DocumentsApiError: class DocumentsApiError extends Error {
    constructor(readonly kind: string) { super(kind); }
  },
  listDocuments: findDocs,
  listDocumentVersions: listVersions,
}));

vi.mock('../../documents/components/DocumentDownloadAction', () => ({
  DocumentDownloadAction: ({ filename, label = 'Baixar' }: { filename: string; label?: string }) => (
    <button type="button" aria-label={label + ' ' + filename}>{label}</button>
  ),
}));

const document = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'CRLV — veículo',
  categoryCode: 'GENERAL',
  classificationCode: 'INTERNAL',
  status: 'ACTIVE',
  unitId: 'unit-a',
  currentVersionNumber: 2,
  createdAt: '2026-11-03T00:00:00Z',
  updatedAt: '2026-11-03T00:00:00Z',
};

function renderPanel(canAttach = true, canDownload = false) {
  return render(
    <MemoryRouter>
      <AssetDocumentsPanel assetId="asset-1" unitId="unit-a"
        canAttach={canAttach} canDownload={canDownload} />
    </MemoryRouter>,
  );
}

describe('AssetDocumentsPanel: authorized GED/asset integration', () => {
  beforeEach(() => {
    listLinked.mockReset().mockResolvedValue({ items: [], scope: 'RECENT_WINDOW' });
    attach.mockReset().mockResolvedValue({ attached: true, document });
    findDocs.mockReset().mockResolvedValue({ items: [document], limit: 20, offset: 0, total: 1 });
    listVersions.mockReset().mockResolvedValue([]);
  });

  it('renders only the linked documents returned by backend', async () => {
    listLinked.mockResolvedValue({ items: [document], scope: 'RECENT_WINDOW' });
    renderPanel();
    expect(await screen.findByText('CRLV — veículo')).toBeInTheDocument();
    expect(screen.getByText('GENERAL · v2')).toBeInTheDocument();
    expect(screen.getByText(/consulta cobre os vínculos recentes autorizados/i)).toBeInTheDocument();
  });

  it('searches only the asset unit and links the selected GED document', async () => {
    renderPanel();
    expect(await screen.findByText(/nenhum documento autorizado encontrado/i)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar documento/i }), 'CRLV');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar no GED' }));
    expect(findDocs).toHaveBeenCalledWith(expect.any(AbortSignal), {
      unitId: 'unit-a', q: 'CRLV', limit: 20,
    });
    expect(await screen.findByRole('button', { name: 'Vincular' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(attach).toHaveBeenCalledWith('asset-1', document.id);
  });

  it('does not display empty authorized state on backend denial', async () => {
    listLinked.mockRejectedValue(new AssetDocumentsApiError('denied'));
    renderPanel();
    expect(await screen.findByText(/acesso aos documentos deste ativo não autorizado/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum documento autorizado encontrado/i)).not.toBeInTheDocument();
  });

  it('shows real GED version history and download actions when allowed', async () => {
    const version = {
      id: 'version-1', documentId: document.id, versionNumber: 2,
      originalFilename: 'CRLV-2026.pdf', mimeType: 'application/pdf',
      byteSize: 320, sha256Hash: 'x', uploadedByIdentityId: 'operator',
      publishedAt: '2026-11-03T00:00:00Z', supersededAt: null, isCurrent: true,
    };
    listLinked.mockResolvedValue({ items: [document], scope: 'RECENT_WINDOW' });
    listVersions.mockResolvedValue([version]);
    renderPanel(true, true);
    expect(await screen.findByRole('button', { name: 'Baixar CRLV — veículo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver versões' }));
    expect(listVersions).toHaveBeenCalledWith(document.id, expect.any(AbortSignal));
    expect(await screen.findByText('v2 · CRLV-2026.pdf · Atual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar v2 CRLV-2026.pdf' })).toBeInTheDocument();
  });

  it('does not expose linking or download controls without grants', async () => {
    listLinked.mockResolvedValue({ items: [document], scope: 'RECENT_WINDOW' });
    renderPanel(false, false);
    expect(await screen.findByText('CRLV — veículo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar no GED' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Baixar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/vinculação indisponível/i)).toBeInTheDocument();
  });

  it('discards obsolete version responses when moving between assets', async () => {
    let resolveVersions: (value: unknown[]) => void = () => {};
    listLinked.mockResolvedValue({ items: [document], scope: 'RECENT_WINDOW' });
    listVersions.mockImplementation(() => new Promise((resolve) => { resolveVersions = resolve; }));
    const rendered = renderPanel(true, false);
    await screen.findByText('CRLV — veículo');
    await userEvent.click(screen.getByRole('button', { name: 'Ver versões' }));
    rendered.rerender(
      <MemoryRouter>
        <AssetDocumentsPanel assetId="asset-2" unitId="unit-b" canAttach canDownload={false} />
      </MemoryRouter>,
    );
    resolveVersions([{
      id: 'stale', documentId: document.id, versionNumber: 1,
      originalFilename: 'NÃO DEVE APARECER.pdf', isCurrent: false,
    }]);
    await waitFor(() => expect(listLinked).toHaveBeenCalledWith('asset-2', expect.any(AbortSignal)));
    expect(screen.queryByText(/NÃO DEVE APARECER/)).not.toBeInTheDocument();
  });

  it('does not replace results after a search has been cancelled by a new query', async () => {
    let resolveSearch: (value: unknown) => void = () => {};
    findDocs.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
    renderPanel();
    expect(await screen.findByText(/nenhum documento autorizado encontrado/i)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar documento/i }), 'CRLV');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar no GED' }));
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar documento/i }), ' novo');
    resolveSearch({ items: [document], limit: 20, offset: 0, total: 1 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Vincular' })).not.toBeInTheDocument());
  });

});
