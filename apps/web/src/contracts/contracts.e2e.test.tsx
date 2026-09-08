import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { createContractsFetchMock } from './contracts-fetch-mock';

type CapturedRequest = {
  pathname: string;
  method: string;
  body: Record<string, unknown> | undefined;
};

function captureRequests(
  mock: ReturnType<typeof createContractsFetchMock>['fetch'],
): CapturedRequest[] {
  return mock.mock.calls.map((call) => {
    const input = call[0] as RequestInfo;
    const init = (call[1] ?? {});
    const { pathname } = parseRequestPath(input);
    const method = init.method ?? 'GET';
    let body: Record<string, unknown> | undefined;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
    }
    return { pathname, method, body };
  });
}

const PROBE_CONTRACT_PATH = '00000000-0000-4000-8000-000000000005';

/** Ignora requisições de probe de capacidade (usam o id de contrato inexistente). */
function realRequests(requests: CapturedRequest[]): CapturedRequest[] {
  return requests.filter((request) => !request.pathname.includes(PROBE_CONTRACT_PATH));
}

async function openContractsNav(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('link', { name: 'Contratos' }, { timeout: 10000 }),
  );
}

async function goToContractDetail(
  user: ReturnType<typeof userEvent.setup>,
  contractNumber: string,
) {
  await user.click(screen.getByRole('link', { name: 'Voltar à lista' }));
  await user.click(
    await screen.findByRole('link', { name: contractNumber }, { timeout: 10000 }),
  );
}

describe('contratos comerciais — fluxo de telas (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  it('lista, cria, edita rascunho, conflito de versão, ativa, encerra (motivo) e expira (sem corpo)', async () => {
    const mock = createContractsFetchMock();
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    await openContractsNav(user);
    await screen.findByRole('heading', { name: /^contratos$/i });

    // lista renderiza contratos com badges de status
    expect(screen.getByRole('link', { name: 'CTR-ACT-001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CTR-ACT-002' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CTR-DRAFT-001' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Status: Ativo').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Status: Rascunho')).toBeInTheDocument();

    // create: fluxo do formulário posta o payload correto
    await user.click(await screen.findByRole('link', { name: 'Novo contrato' }));
    await screen.findByRole('heading', { name: /^novo contrato$/i });

    await user.selectOptions(
      screen.getByLabelText(/^cliente/i),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    await user.type(screen.getByLabelText(/^unidade operacional/i), 'UNIT-A');
    await user.type(screen.getByLabelText(/número do contrato/i), 'CTR-E2E-001');
    await user.type(screen.getByLabelText(/^título/i), 'Contrato E2E de testes');
    fireEvent.change(screen.getByLabelText(/^vigência inicial/i), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText(/^vigência final/i), {
      target: { value: '2027-12-31' },
    });

    await user.click(screen.getByRole('button', { name: 'Cadastrar contrato' }));

    await screen.findByRole('heading', { name: 'CTR-E2E-001' });
    expect(screen.getByLabelText('Status: Rascunho')).toBeInTheDocument();

    const requests = captureRequests(mock.fetch);
    const createCall = requests.find(
      (request) =>
        request.method === 'POST' &&
        request.pathname === '/api/v1/commercial/contracts' &&
        request.body?.['contractNumber'] === 'CTR-E2E-001',
    );
    expect(createCall).toBeDefined();
    expect(createCall?.body).toMatchObject({
      clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      unitId: 'UNIT-A',
      contractNumber: 'CTR-E2E-001',
      title: 'Contrato E2E de testes',
      validFrom: '2026-01-01',
      validTo: '2027-12-31',
      currencyCode: 'BRL',
    });

    // update (versão): edição de rascunho envia rowVersion e atualiza
    await user.click(screen.getByRole('button', { name: 'Editar dados' }));
    await screen.findByRole('heading', { name: /editar dados do contrato/i });
    await user.clear(screen.getByLabelText(/número do contrato/i));
    await user.type(screen.getByLabelText(/número do contrato/i), 'CTR-E2E-001-R2');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await screen.findByRole('heading', { name: 'CTR-E2E-001-R2' });
    const patchCall = realRequests(captureRequests(mock.fetch)).find(
      (request) => request.method === 'PATCH',
    );
    expect(patchCall?.body).toMatchObject({
      rowVersion: 1,
      contractNumber: 'CTR-E2E-001-R2',
    });

    // 409 version conflict mostra o banner de conflito
    mock.state.versionConflictOnNext();
    await user.click(screen.getByRole('button', { name: 'Editar dados' }));
    await screen.findByRole('heading', { name: /editar dados do contrato/i });
    await user.clear(screen.getByLabelText(/número do contrato/i));
    await user.type(screen.getByLabelText(/número do contrato/i), 'CTR-E2E-CONFLICT');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    const conflictAlert = await screen.findByRole('alert');
    expect(conflictAlert).toHaveTextContent(/alterado por outro usuário/i);
    const conflictPatch = realRequests(captureRequests(mock.fetch)).find(
      (request) =>
        request.method === 'PATCH' && request.body?.['contractNumber'] === 'CTR-E2E-CONFLICT',
    );
    expect(conflictPatch?.body).toMatchObject({ rowVersion: 2 });

    await user.click(
      within(conflictAlert).getByRole('button', { name: 'Recarregar dados atuais' }),
    );
    await waitFor(() => {
      expect(screen.queryByText(/alterado por outro usuário/i)).not.toBeInTheDocument();
    });
    await screen.findByRole('heading', { name: 'CTR-E2E-001-R2' });

    // activate: envia rowVersion e efetiva o contrato
    await user.click(screen.getByRole('button', { name: 'Ativar contrato' }));
    await screen.findByRole('heading', { name: /ativar contrato/i });
    await user.click(screen.getByRole('button', { name: 'Confirmar ativação' }));

    await screen.findByLabelText('Status: Ativo');
    const activateCall = realRequests(captureRequests(mock.fetch)).find((request) =>
      request.pathname.endsWith('/activate'),
    );
    expect(activateCall?.body).toMatchObject({ rowVersion: 2 });

    // close: exige motivo e envia rowVersion
    await goToContractDetail(user, 'CTR-ACT-001');
    await screen.findByLabelText('Status: Ativo');
    await user.click(screen.getByRole('button', { name: 'Encerrar contrato' }));
    await screen.findByRole('heading', { name: /encerrar contrato/i });

    const confirmClose = screen.getByRole('button', { name: 'Confirmar encerramento' });
    expect(confirmClose).toBeDisabled();
    await user.click(confirmClose);
    expect(
      realRequests(captureRequests(mock.fetch)).filter((request) =>
        request.pathname.endsWith('/close'),
      ),
    ).toHaveLength(0);

    await user.type(
      screen.getByLabelText(/motivo do encerramento/i),
      'Encerramento operacional planejado',
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));

    await screen.findByLabelText('Status: Encerrado');
    const closeCall = realRequests(captureRequests(mock.fetch)).find((request) =>
      request.pathname.endsWith('/close'),
    );
    expect(closeCall?.body).toMatchObject({
      rowVersion: 2,
      closureReason: 'Encerramento operacional planejado',
    });

    // expire: endpoint é chamado SEM corpo (sem rowVersion/motivo)
    await goToContractDetail(user, 'CTR-ACT-002');
    await screen.findByLabelText('Status: Ativo');
    await user.click(screen.getByRole('button', { name: 'Expirar contrato' }));
    await screen.findByRole('heading', { name: /expirar contrato/i });
    await user.click(screen.getByRole('button', { name: 'Confirmar expiração' }));

    await screen.findByLabelText('Status: Expirado');
    const expireCall = realRequests(captureRequests(mock.fetch)).find((request) =>
      request.pathname.endsWith('/expire'),
    );
    expect(expireCall?.method).toBe('POST');
    expect(expireCall?.body).toBeUndefined();
  }, 60000);

  it('redireciona para acesso negado quando a listagem é proibida (403)', async () => {
    const mock = createContractsFetchMock({ listAllowed: false });
    vi.stubGlobal('fetch', mock.fetch);
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    await openContractsNav(user);
    expect(await screen.findByText(/commercial:contract:list/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /acesso negado/i })).toBeInTheDocument();
  }, 30000);
});
