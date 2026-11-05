import { getApiBaseUrl, isNetworkError } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';
import type { HumanLookupOption } from '../financial-ui/HumanLookupField';

/**
 * LOOKUP HUMANO DE CENTRO DE CUSTO E CATEGORIA DE DESPESA.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE MODULO FECHA
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Os dois cadastros eram `PARK: HUMAN_LOOKUP_API_GAP` na `CISNE_FINISH_MATRIX`: o backend so
 * tinha `POST`, entao quem precisava ESCOLHER um centro de custo ou uma categoria de despesa
 * era forcado a digitar o UUID. Com `GET finance/cost-centers` e `GET finance/expense-categories`
 * publicados, a busca passa a ser do SERVIDOR — o navegador nunca carrega o cadastro inteiro.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * REGRAS
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. A fonte e o servidor, sempre. Nao ha cache de cadastro no navegador.
 *   2. `limit` e pequeno e explicito: a busca e por termo, nao um despejo de milhares de linhas.
 *   3. Falha de rede vira erro tipado — o campo mostra que a busca falhou, nunca "nenhum
 *      resultado", porque as duas coisas significam coisas diferentes para o operador.
 *   4. O rotulo mostra codigo e nome; o `id` fica interno ao componente.
 */

/** Teto de opcoes por busca. Escolha humana, nao exportacao de cadastro. */
const LOOKUP_PAGE_SIZE = 20;

export class DirectoryLookupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type FinancialListPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function authHeaders(): HeadersInit {
  const token = tokenStore.getAccessToken();
  if (!token) {
    throw new DirectoryLookupError(401, 'FINANCE_DIRECTORY_DENIED');
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function requestPage<T>(
  path: string,
  signal?: AbortSignal,
): Promise<FinancialListPage<T>> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
  } catch (error) {
    if (error instanceof DirectoryLookupError) throw error;
    if (isNetworkError(error)) throw new DirectoryLookupError(0, 'NETWORK');
    throw new DirectoryLookupError(0, 'UNKNOWN');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: { code?: string };
    };
    throw new DirectoryLookupError(
      response.status,
      body.error?.code ?? body.code ?? 'FINANCE_DIRECTORY_REQUEST_FAILED',
    );
  }

  return (await response.json()) as FinancialListPage<T>;
}

type CostCenterRecord = { id: string; code: string; name: string; status: string };
type ExpenseCategoryRecord = { id: string; code: string; name: string; status: string };

/**
 * Opcao de lookup a partir do registro REAL.
 *
 * Centro de custo e categoria INATIVOS continuam aparecendo: um titulo historico precisa
 * resolver o nome do vinculo que ja gravou. Esconder o inativo faria o detalhe exibir apenas o
 * identificador tecnico — o defeito que este trabalho elimina.
 */
function toOption(record: CostCenterRecord | ExpenseCategoryRecord): HumanLookupOption {
  const inactive = record.status !== 'ACTIVE';
  return {
    id: record.id,
    label: inactive ? `${record.name} (inativo)` : record.name,
    support: record.code,
  };
}

function buildListPath(base: string, term: string): string {
  const params = new URLSearchParams();
  const trimmed = term.trim();
  if (trimmed.length > 0) {
    params.set('q', trimmed);
  }
  params.set('limit', String(LOOKUP_PAGE_SIZE));
  params.set('offset', '0');
  return `${base}?${params.toString()}`;
}

/**
 * Busca de centros de custo pelo termo livre (codigo OU nome).
 *
 * Consumidores reais: despesa, conferencia de compra, nota de fornecedor e apuracao fiscal —
 * exatamente os quatro que estavam bloqueados.
 */
export async function searchCostCenterOptions(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const page = await requestPage<CostCenterRecord>(
    buildListPath('/api/v1/finance/cost-centers', term),
    signal,
  );
  return page.items.map(toOption);
}

/** Busca de categorias de despesa pelo termo livre (codigo OU nome). */
export async function searchExpenseCategoryOptions(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const page = await requestPage<ExpenseCategoryRecord>(
    buildListPath('/api/v1/finance/expense-categories', term),
    signal,
  );
  return page.items.map(toOption);
}

/**
 * Rotulo de um vinculo JA GRAVADO, para a tela de detalhe.
 *
 * Consulta o registro pelo identificador persistido. Devolve `null` quando o cadastro nao
 * responde — o chamador entao exibe o proprio identificador, e a ausencia fica visivel em vez
 * de ser mascarada por um rotulo inventado.
 */
export async function resolveCostCenterLabel(
  costCenterId: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption | null> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/finance/cost-centers/${encodeURIComponent(costCenterId)}`,
      { method: 'GET', headers: authHeaders(), signal },
    );
    if (!response.ok) return null;
    const record = (await response.json()) as CostCenterRecord;
    return toOption(record);
  } catch {
    return null;
  }
}

/**
 * PERIODO CONTABIL — referencia humana para a linha de orcamento.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA FUNCAO EXISTE
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `GET accounting/periods` JA existia e JA era usado pela Contabilidade. Mas a tela de ORCAMENTO
 * pedia o identificador do periodo em um `Input` de texto livre, entao o operador de orcamento
 * precisava copiar UUID de outra tela — o mesmo defeito que o centro de custo tinha, apenas em
 * outro consumidor. O endpoint existir nao basta: o consumidor precisa alcancar-lo.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * DIFERENCA DELIBERADA: ESCOPO POR UNIDADE
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Diferente de categoria de despesa e centro de custo (cadastros GLOBAIS), o periodo contabil e
 * escopado por UNIDADE — o servidor exige `unitId`. Por isso a funcao RECEBE a unidade e, quando
 * ela nao esta disponivel, devolve lista vazia em vez de consultar sem escopo.
 *
 * Consultar sem `unitId` traria periodo de outra unidade para dentro de um orcamento, o que e
 * exatamente o vazamento de escopo que a autorizacao contextual existe para impedir. Devolver
 * vazio e honesto: o campo diz "informe a unidade" e o operador entende a dependencia.
 */

type AccountingPeriodRecord = {
  id: string;
  periodKey?: string;
  year?: number;
  month?: number;
  status?: string;
};

type PeriodsByUnitResponse = {
  items: AccountingPeriodRecord[];
};

function periodLabel(record: AccountingPeriodRecord, index: number): string {
  if (record.periodKey) {
    return record.periodKey;
  }
  if (typeof record.year === 'number' && typeof record.month === 'number') {
    return `${record.year}-${String(record.month).padStart(2, '0')}`;
  }
  // Sem competencia declarada pelo servidor nao se inventa rotulo: a posicao e o dado real.
  return `Período ${index + 1}`;
}

export async function searchAccountingPeriodOptions(
  term: string,
  unitId: string | null | undefined,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  /**
   * Sem unidade nao ha como consultar com escopo. Devolver `[]` mantem a fronteira: a lista
   * vazia diz "depende da unidade", nao "nao existe periodo". Consultar sem `unitId` traria
   * periodo de outra unidade para dentro de um orcamento — exatamente o vazamento de escopo
   * que a autorizacao contextual existe para impedir.
   */
  if (!unitId || unitId.trim().length === 0) {
    return [];
  }

  const search = new URLSearchParams({ unitId: unitId.trim() });
  /**
   * `GET accounting/periods` responde `{ items }`, sem o envelope de paginacao do Financeiro.
   * Le-se o formato REAL do endpoint em vez de se inventar um contrato que o servidor nao
   * publica — e nao se reimplementa o cliente do modulo de Contabilidade.
   */
  const raw = await requestJson<PeriodsByUnitResponse>(
    `/api/v1/accounting/periods?${search.toString()}`,
    signal,
  );

  const needle = term.trim().toLowerCase();
  return raw.items
    .map((record, index) => ({
      id: record.id,
      label: periodLabel(record, index),
      support: record.status,
    }))
    .filter((option) =>
      needle.length === 0
        ? true
        : option.label.toLowerCase().includes(needle) ||
          (option.support ?? '').toLowerCase().includes(needle),
    );
}

/** Leitura crua, usada quando o endpoint nao segue o envelope paginado do Financeiro. */
async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'GET',
      headers: authHeaders(),
      signal,
    });
  } catch (error) {
    if (error instanceof DirectoryLookupError) throw error;
    if (isNetworkError(error)) throw new DirectoryLookupError(0, 'NETWORK');
    throw new DirectoryLookupError(0, 'UNKNOWN');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: { code?: string };
    };
    throw new DirectoryLookupError(
      response.status,
      body.error?.code ?? body.code ?? 'FINANCE_DIRECTORY_REQUEST_FAILED',
    );
  }

  return (await response.json()) as T;
}
