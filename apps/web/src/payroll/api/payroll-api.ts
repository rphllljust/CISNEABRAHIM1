import {
  authHeaders,
  BACKOFFICE_PROBE_ID,
  jsonHeaders,
  probeReadAccess,
  requestJson,
} from '../../financial-ui/enterprise-api';
import {
  rememberEmploymentContract,
  rememberPayrollPeriod,
} from '../utils/payroll-directory';

export type PayrollPeriod = {
  id: string;
  unitId: string;
  competenceYear: number;
  competenceMonth: number;
  startsOn: string;
  endsOn: string;
  status: string;
  rowVersion: number;
};

export type PayrollResult = {
  id: string;
  employmentContractId: string;
  earningTotal: string;
  deductionTotal: string;
  employerChargeTotal: string;
  netTotal: string;
};

/**
 * Contrato de trabalho como o servidor devolve (EmploymentContractResponse em
 * apps/api/src/payroll/serializers/payroll-response.serializer.ts). `code` e `displayName` são os
 * campos legíveis usados na busca humana do operador.
 */
export type EmploymentContract = {
  id: string;
  unitId: string;
  code: string;
  displayName: string;
  status: string;
  personRef: string | null;
  startsOn: string;
  endsOn: string | null;
};

/** Resposta de POST /payroll/periods/:periodId/calculate. */
export type PayrollCalculation = {
  period: PayrollPeriod;
  results: PayrollResult[];
  idempotent: boolean;
};

/**
 * Resposta de POST /api/v1/payroll/events (espelha PayrollEventResponse do
 * backend em apps/api/src/payroll/serializers/payroll-response.serializer.ts).
 * `idempotent` é true quando o servidor reaproveitou um evento já registrado
 * para a mesma chave idempotente em vez de criar uma duplicata.
 */
export type PayrollEventResponse = {
  id: string;
  payrollPeriodId: string;
  employmentContractId: string;
  eventKind: string;
  amount: string;
  componentLabel: string;
  description: string;
  formulaStatus: string;
  idempotencyKey: string;
  idempotent: boolean;
};

/**
 * Mapeia os códigos reais emitidos pelo backend de folha (PAYROLL_ERROR_CODES /
 * mapPayrollDomainError em apps/api/src/payroll) para mensagens PT-BR.
 * O backend reutiliza PAYROLL_VALIDATION_FAILED também para erros internos 500:
 * qualquer resposta 5xx deve cair em texto de erro de servidor, nunca em
 * "dados inválidos".
 */
export function mapPayrollErrorToMessage(code: string | undefined, status: number): string {
  if (status === 0) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  }
  if (status === 401 || status === 403) {
    return 'Você não tem permissão para esta operação de folha.';
  }
  if (status >= 500) {
    return 'Erro interno do servidor ao processar a operação de folha. Tente novamente em instantes.';
  }
  switch (code) {
    case 'PAYROLL_DENIED':
      return 'Você não tem permissão para esta operação de folha.';
    case 'PAYROLL_NOT_FOUND':
      return 'Período ou contrato de folha não encontrado.';
    case 'PAYROLL_VALIDATION_FAILED':
      return 'Os dados enviados são inválidos. Revise os campos e tente novamente.';
    case 'PAYROLL_INVALID_AMOUNT':
      return 'O valor do evento é inválido: deve ser um valor positivo.';
    case 'PAYROLL_INVALID_EVENT_KIND':
      return 'Tipo de evento inválido: use EARNING, DEDUCTION ou EMPLOYER_CHARGE.';
    case 'PAYROLL_PERIOD_CLOSED':
      return 'O período de folha está fechado e é imutável. Reabra o período para registrar novos dados.';
    case 'PAYROLL_PERIOD_NOT_OPEN':
      return 'O período de folha não está aberto para esta operação.';
    case 'PAYROLL_PERIOD_NOT_CALCULATED':
      return 'O período ainda não foi calculado.';
    case 'PAYROLL_PERIOD_NOT_CLOSED':
      return 'Somente um período de folha fechado pode ser reaberto.';
    case 'PAYROLL_FORMULA_NOT_DECIDED':
      return 'A fórmula oficial ainda não foi decidida. O servidor não inventa encargos legais.';
    case 'PAYROLL_OPERATIONS_COUPLING_FORBIDDEN':
      return 'O vínculo com registros operacionais foi recusado: não é um evento de folha.';
    case 'AUTHZ_SOD_DUTY_CONFLICT':
    case 'APPROVAL_MATRIX_SELF_APPROVAL':
      return 'O fechamento foi recusado pela segregação de funções.';
    default:
      return 'Não foi possível concluir a operação de folha.';
  }
}

/**
 * Cliente da folha. A API endereça período e contrato por identificador (UUID), então cada resposta
 * que devolve essas entidades alimenta o diretório humano (`../utils/payroll-directory`) na própria
 * fronteira do cliente: é o único ponto por onde passa dado do servidor, e assim nenhuma opção
 * inventada consegue entrar na busca do operador.
 */
export async function getPayrollPeriod(
  periodId: string,
  unitId: string,
  signal?: AbortSignal,
): Promise<PayrollPeriod> {
  const period = await requestJson<PayrollPeriod>(
    `/api/v1/payroll/periods/${periodId}?unitId=${encodeURIComponent(unitId)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
  rememberPayrollPeriod(period);
  return period;
}

export async function listPayrollResults(
  periodId: string,
  unitId: string,
  signal?: AbortSignal,
): Promise<PayrollResult[]> {
  return requestJson<PayrollResult[]>(
    `/api/v1/payroll/periods/${periodId}/results?unitId=${encodeURIComponent(unitId)}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}

export async function createEmploymentContract(
  payload: Record<string, unknown>,
): Promise<EmploymentContract> {
  const contract = await requestJson<EmploymentContract>('/api/v1/payroll/contracts', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  rememberEmploymentContract(contract);
  return contract;
}

export async function openPayrollPeriod(payload: Record<string, unknown>): Promise<PayrollPeriod> {
  const period = await requestJson<PayrollPeriod>('/api/v1/payroll/periods', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  rememberPayrollPeriod(period);
  return period;
}

export async function recordPayrollEvent(payload: Record<string, unknown>): Promise<PayrollEventResponse> {
  return requestJson<PayrollEventResponse>('/api/v1/payroll/events', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function calculatePayrollPeriod(
  periodId: string,
  unitId: string,
): Promise<PayrollCalculation> {
  const calculation = await requestJson<PayrollCalculation>(
    `/api/v1/payroll/periods/${periodId}/calculate`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ unitId }),
    },
  );
  rememberPayrollPeriod(calculation.period);
  return calculation;
}

export async function closePayrollPeriod(periodId: string, unitId: string): Promise<PayrollPeriod> {
  const period = await requestJson<PayrollPeriod>(`/api/v1/payroll/periods/${periodId}/close`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ unitId }),
  });
  rememberPayrollPeriod(period);
  return period;
}

export async function reopenPayrollPeriod(periodId: string, unitId: string): Promise<PayrollPeriod> {
  const period = await requestJson<PayrollPeriod>(`/api/v1/payroll/periods/${periodId}/reopen`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ unitId }),
  });
  rememberPayrollPeriod(period);
  return period;
}

export async function probePayrollReadAccess(signal?: AbortSignal): Promise<boolean> {
  return probeReadAccess(
    `/api/v1/payroll/periods/${BACKOFFICE_PROBE_ID}?unitId=${BACKOFFICE_PROBE_ID}`,
    signal,
  );
}
