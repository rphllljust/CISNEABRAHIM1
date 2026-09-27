import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { renderWithProviders } from '../test/render-with-providers';
import { createEmploymentContract, openPayrollPeriod } from './api/payroll-api';
import { PayrollPage } from './pages/PayrollPage';
import {
  rememberPayrollPeriod,
  resetPayrollDirectory,
  searchPayrollPeriodOptions,
} from './utils/payroll-directory';

/**
 * FRENTE D — descoberta humana da folha (sem digitar UUID).
 *
 * Prova duas coisas por teste:
 * (a) período e contrato são alcançados por superfícies humanas (competência, código/nome,
 *     unidade escolhida da lista real de unidades operacionais) — nenhum identificador técnico é
 *     digitado;
 * (b) a superfície humana escolhida realmente chega à API: as asserções são feitas sobre a URL e a
 *     query recebidas pelo fetch simulado.
 *
 * O servidor simulado abaixo devolve exatamente os payloads dos serializers da API de folha
 * (apps/api/src/payroll/serializers/payroll-response.serializer.ts) — inclusive o contrato, que
 * traz `code` e `displayName` e por isso permite o rótulo humano.
 */

const UNIT = 'UNIDADE-MATRIZ';
const OTHER_UNIT = 'UNIDADE-FILIAL';
const PERIOD_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

type RecordedCall = {
  pathname: string;
  method: string;
  searchParams: URLSearchParams;
  body: Record<string, unknown> | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function periodPayload() {
  return {
    id: PERIOD_ID,
    unitId: UNIT,
    competenceYear: 2026,
    competenceMonth: 1,
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
    status: 'OPEN',
    rowVersion: 1,
  };
}

function contractPayload() {
  return {
    id: CONTRACT_ID,
    unitId: UNIT,
    code: 'C-001',
    displayName: 'Maria Silva',
    status: 'ACTIVE',
    personRef: null,
    startsOn: '2026-01-01',
    endsOn: null,
  };
}

function installFetchMock() {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';
    calls.push({
      pathname,
      method,
      searchParams,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });

    if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
      return jsonResponse({ items: [UNIT, OTHER_UNIT] });
    }
    if (pathname === '/api/v1/payroll/periods' && method === 'POST') {
      return jsonResponse(periodPayload());
    }
    if (pathname === `/api/v1/payroll/periods/${PERIOD_ID}` && method === 'GET') {
      return jsonResponse(periodPayload());
    }
    if (pathname === `/api/v1/payroll/periods/${PERIOD_ID}/results` && method === 'GET') {
      return jsonResponse([]);
    }
    if (pathname === '/api/v1/payroll/contracts' && method === 'POST') {
      return jsonResponse(contractPayload());
    }
    if (pathname === '/api/v1/payroll/events' && method === 'POST') {
      return jsonResponse({
        id: EVENT_ID,
        payrollPeriodId: PERIOD_ID,
        employmentContractId: CONTRACT_ID,
        eventKind: 'EARNING',
        amount: '1000.00',
        componentLabel: 'Salário base',
        description: 'Competência 01/2026',
        formulaStatus: 'UNDECIDED',
        idempotencyKey: 'k-1',
        idempotent: false,
      });
    }
    return jsonResponse({ code: 'PAYROLL_NOT_FOUND', message: 'Not found.' }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function renderPayroll(initialEntry: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/app/payroll" element={<PayrollPage />} />
      <Route path="/app/payroll/periods/:periodId" element={<PayrollPage />} />
    </Routes>,
    { router: { initialEntries: [initialEntry] } },
  );
}

/** Período aberto pelo servidor: é a mesma chamada que a tela faz e alimenta o diretório humano. */
async function seedOpenedPeriod() {
  await openPayrollPeriod({
    unitId: UNIT,
    competenceYear: 2026,
    competenceMonth: 1,
    startsOn: '2026-01-01',
    endsOn: '2026-01-31',
  });
}

beforeEach(() => {
  resetTokenStoreForTests();
  tokenStore.setTokens('access-token', 'refresh-token');
  resetPayrollDirectory();
  window.localStorage.clear();
});

describe('Folha — descoberta humana de período e contrato', () => {
  it('a unidade é escolha humana vinda da API e a tela não pede identificador de período', async () => {
    const { calls } = installFetchMock();
    renderPayroll('/app/payroll');

    const unitSelect = await screen.findByLabelText(/Unidade/);
    await waitFor(() => {
      expect(unitSelect).toHaveValue(UNIT);
    });
    expect(within(unitSelect).getByRole('option', { name: OTHER_UNIT })).toBeInTheDocument();

    // A lista de unidades vem do endpoint real de unidades operacionais.
    expect(
      calls.some(
        (call) =>
          call.pathname === '/api/v1/requests/service-requests/operational-units' &&
          call.method === 'GET',
      ),
    ).toBe(true);

    // O antigo campo "Identificador do período" (UUID digitado) não existe mais.
    expect(screen.queryByLabelText(/Identificador do período/i)).not.toBeInTheDocument();
  });

  it('o período é alcançado pela competência na lista humana e a consulta chega à API com a unidade escolhida', async () => {
    const { calls } = installFetchMock();
    await seedOpenedPeriod();
    const user = userEvent.setup();
    renderPayroll(`/app/payroll?unitId=${UNIT}`);

    // O operador digita COMPETÊNCIA, não identificador.
    const term = await screen.findByLabelText('Buscar período de folha');
    await user.type(term, '01/2026');

    const periodSelect = screen.getByLabelText('Período de folha');
    await waitFor(() => {
      expect(within(periodSelect).getByRole('option', { name: /01\/2026 — Aberto/ })).toBeInTheDocument();
    });
    // O identificador técnico permanece interno: não é o rótulo da opção.
    expect(within(periodSelect).queryByRole('option', { name: new RegExp(PERIOD_ID) })).toBeNull();
    expect(term).toHaveValue('01/2026');

    await user.selectOptions(periodSelect, PERIOD_ID);

    await waitFor(() => {
      const call = calls.find(
        (entry) =>
          entry.pathname === `/api/v1/payroll/periods/${PERIOD_ID}` && entry.method === 'GET',
      );
      expect(call).toBeDefined();
      expect(call?.searchParams.get('unitId')).toBe(UNIT);
    });
  });

  it('trocar a unidade na lista humana refaz a consulta do período com a unidade escolhida', async () => {
    const { calls } = installFetchMock();
    await seedOpenedPeriod();
    const user = userEvent.setup();
    renderPayroll(`/app/payroll/periods/${PERIOD_ID}?unitId=${UNIT}`);

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.pathname === `/api/v1/payroll/periods/${PERIOD_ID}` &&
            call.searchParams.get('unitId') === UNIT,
        ),
      ).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText(/Unidade/), OTHER_UNIT);

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.pathname === `/api/v1/payroll/periods/${PERIOD_ID}` &&
            call.searchParams.get('unitId') === OTHER_UNIT,
        ),
      ).toBe(true);
    });
  });

  it('o contrato é escolhido por código e nome, e o evento chega à API com o vínculo escolhido', async () => {
    const { calls } = installFetchMock();
    await seedOpenedPeriod();
    await createEmploymentContract({
      unitId: UNIT,
      code: 'C-001',
      displayName: 'Maria Silva',
      startsOn: '2026-01-01',
      endsOn: null,
    });
    const user = userEvent.setup();
    renderPayroll(`/app/payroll/periods/${PERIOD_ID}?unitId=${UNIT}`);

    const contractSelect = await screen.findByLabelText(/Contrato de trabalho/);
    await waitFor(() => {
      expect(within(contractSelect).getByRole('option', { name: /C-001 — Maria Silva/ })).toBeInTheDocument();
    });
    expect(within(contractSelect).queryByRole('option', { name: new RegExp(CONTRACT_ID) })).toBeNull();

    await user.selectOptions(contractSelect, CONTRACT_ID);
    await user.type(screen.getByLabelText(/^Valor/), '1000.00');
    await user.type(screen.getByLabelText(/^Componente/), 'Salário base');
    await user.type(screen.getByLabelText(/^Descrição/), 'Competência 01/2026');
    await user.click(screen.getByRole('button', { name: 'Registrar evento' }));

    await waitFor(() => {
      const call = calls.find(
        (entry) => entry.pathname === '/api/v1/payroll/events' && entry.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(call?.body?.employmentContractId).toBe(CONTRACT_ID);
      expect(call?.body?.payrollPeriodId).toBe(PERIOD_ID);
      expect(call?.body?.unitId).toBe(UNIT);
    });

    // Não existe campo pedindo o identificador do contrato.
    expect(screen.queryByLabelText('Contrato')).not.toBeInTheDocument();
  });

  it('o diretório humano rotula por competência e nunca expõe o identificador técnico', () => {
    rememberPayrollPeriod(periodPayload());

    const options = searchPayrollPeriodOptions('01/2026');
    expect(options).toHaveLength(1);
    const [option] = options;
    expect(option?.label).toContain('01/2026');
    expect(option?.label).toContain('Aberto');
    expect(option?.support).toContain(UNIT);
    expect(`${option?.label} ${option?.support}`).not.toContain(PERIOD_ID);

    // Busca por termo que não corresponde a nada conhecido devolve vazio — nada é inventado.
    expect(searchPayrollPeriodOptions('12/2030')).toHaveLength(0);
  });
});
