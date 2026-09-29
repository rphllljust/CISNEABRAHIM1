import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeopleListPage } from './PeopleListPage';
import { createPeopleFetchMock } from '../../test/people-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';

describe('PeopleListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders paginated list from backend', async () => {
    vi.stubGlobal('fetch', createPeopleFetchMock());
    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Demo' })).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: /lista de pessoas/i })).toBeInTheDocument();
  });

  it('shows access denied when list is forbidden', async () => {
    vi.stubGlobal('fetch', createPeopleFetchMock({ personListAllowed: false }));
    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('filters by status via backend query', async () => {
    const fetchMock = createPeopleFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Demo' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'INACTIVE');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=INACTIVE'),
        expect.anything(),
      );
    });
  });

  /*
   * WORKFORCE WORKLIST — a busca e o recorte de funcao vao AO SERVIDOR. O contrato ja
   * aceitava `q` e `defaultLaborTypeCode`; antes a tela nao usava nenhum dos dois.
   */
  it('busca por nome ou código no servidor, não no navegador', async () => {
    const fetchMock = createPeopleFetchMock({
      seed: [
        { legalName: 'Ana Ribeiro', memberCode: 'M-001' },
        { legalName: 'Bruno Costa', memberCode: 'M-002' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Ana Ribeiro' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Bruno Costa' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar'), 'Bruno');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=Bruno'), expect.anything());
    });
    // O recorte e do servidor: a linha nao correspondente sai da tabela.
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Ana Ribeiro' })).not.toBeInTheDocument();
    });
  });

  it('recorta por função no servidor quando o filtro é aplicado', async () => {
    const fetchMock = createPeopleFetchMock({
      seed: [
        { legalName: 'Ana Ribeiro', memberCode: 'M-001', defaultLaborTypeCode: 'OPERATOR' },
        { legalName: 'Bruno Costa', memberCode: 'M-002', defaultLaborTypeCode: 'SUPERVISOR' },
      ],
      laborTypes: [
        { code: 'OPERATOR', name: 'Operador' },
        { code: 'SUPERVISOR', name: 'Supervisor' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Ana Ribeiro' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Função' }), 'OPERATOR');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('defaultLaborTypeCode=OPERATOR'),
        expect.anything(),
      );
    });
  });

  it('declara a aptidão a alocação sem inventar disponibilidade', async () => {
    vi.stubGlobal(
      'fetch',
      createPeopleFetchMock({
        seed: [{ legalName: 'Ana Ribeiro', memberCode: 'M-001', serviceOrderAllocationSupported: true }],
      }),
    );
    renderWithProviders(<PeopleListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Ana Ribeiro' })).toBeInTheDocument();
    });
    const table = screen.getByRole('table', { name: /lista de pessoas/i });
    // A coluna existe e declara a aptidao a partir do dado real do contrato.
    expect(within(table).getByText(/apta a alocação/i)).toBeInTheDocument();
    // O contrato nao publica alocacao vigente: a LINHA nao pode afirmar disponibilidade.
    const row = within(table).getByRole('row', { name: /Ana Ribeiro/ });
    expect(within(row).queryByText(/dispon[íi]vel/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^em OS$/i)).not.toBeInTheDocument();
  });

  it('mantém o recorte de filtros na URL para recarregar e compartilhar', async () => {
    const fetchMock = createPeopleFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<PeopleListPage />, {
      router: { initialEntries: ['/app/people?status=INACTIVE'] },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=INACTIVE'),
        expect.anything(),
      );
    });
    // O controle reflete o recorte que veio da URL.
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('INACTIVE');
    void user;
  });
});
