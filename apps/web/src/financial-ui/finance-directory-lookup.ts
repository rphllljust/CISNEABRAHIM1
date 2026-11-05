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
