import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetDocumentsPanel } from './AssetDocumentsPanel';
import { AssetDocumentsApiError } from '../api/asset-documents-api';

const { listLinked, attach, findDocs } = vi.hoisted(() => ({
  listLinked: vi.fn(),
  attach: vi.fn(),
  findDocs: vi.fn(),
}));

vi.mock('../api/asset-documents-api', () => ({
  AssetDocumentsApiError: class AssetDocumentsApiError extends Error {
    constructor(readonly kind: string) { super(kind); }
  },
  listAssetDocuments: listLinked,
  attachAssetDocument: attach,
}));

vi.mock('../../documents/api/documents-api', () => ({
  listDocuments: findDocs,
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

function renderPanel() {
  render(<MemoryRouter><AssetDocumentsPanel assetId="asset-1" unitId="unit-a" /></MemoryRouter>);
}

describe('AssetDocumentsPanel: authorized GED/asset integration', () => {
  beforeEach(() => {
    listLinked.mockReset().mockResolvedValue({ items: [], scope: 'RECENT_WINDOW' });
    attach.mockReset().mockResolvedValue({ attached: true, document });
    findDocs.mockReset().mockResolvedValue({ items: [document], limit: 20, offset: 0, total: 1 });
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
    expect(findDocs).toHaveBeenCalledWith(undefined, {
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
});
