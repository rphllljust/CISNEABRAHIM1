import { getApiBaseUrl } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';

/**
 * CONTRATO ÚNICO DE ACESSO POR SUPERFÍCIE — fonte da verdade do MENU e da PÁGINA.
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE ARQUIVO ELIMINA (44 casos medidos no HML real)
 * ---------------------------------------------------------------------------------------------
 *
 * A navegação decidia visibilidade com uma SONDA DE DETALHE sobre um UUID sintético:
 *
 *     GET /api/v1/finance/budgets/00000000-0000-4000-8000-000000000099
 *
 * e `probeReadAccess` interpretava **404 como autorizado**, por analogia com "a rota existe,
 * o registro é que não". Só que a página não pede um registro: ela pede a LISTA.
 *
 *     sonda (menu)  → 404  ⇒ menu MOSTRA
 *     lista (página) → 403  ⇒ página NEGA
 *
 * Resultado: Orçamentos e Despesas apareciam no menu e negavam ao clicar. Pior que esconder
 * demais: o sistema afirmava uma capacidade que não tinha.
 *
 * A causa não é o 404 em si — é a sonda perguntar por uma CAPACIDADE DIFERENTE da que a página
 * exige (leitura de um registro vs. listagem do domínio). Um UUID sintético nunca pode provar
 * "posso listar".
 *
 * ---------------------------------------------------------------------------------------------
 * O CONTRATO
 * ---------------------------------------------------------------------------------------------
 *
 * Cada superfície declara a **operação de leitura que representa ENTRAR no módulo** — a MESMA
 * que a página executa ao abrir. O menu passa a perguntar exatamente o que a página pergunta:
 * mesma rota, mesmo verbo, mesmo escopo.
 *
 * Consequências deliberadas:
 *
 *   - Nenhum UUID sintético decide visibilidade.
 *   - Nenhum 404 é lido como autorização. `probeSurfaceAccess` é FAIL-CLOSED: só 2xx autoriza.
 *   - `entry: null` significa "esta superfície NÃO tem operação de leitura de entrada própria"
 *     (a entrada depende de um identificador que o menu não pode conhecer). Nesses casos a
 *     página usa a MESMA sonda de capability que o menu — então menu e página já concordam por
 *     construção, e inventar uma sonda nova só criaria uma segunda regra.
 *
 * Isto NÃO é fronteira de segurança. A decisão real continua no servidor, por requisição
 * (`AuthorizationGuard` + PDP). Aqui só se decide o que o MENU mostra — e o menu nunca deve
 * mostrar uma porta que a página não abre.
 */

const enc = encodeURIComponent;

/**
 * REVISÃO DO CONTRATO — versiona a DECISÃO, não o arquivo.
 *
 * Quem consome este descritor guarda o resultado em `sessionStorage` para não repetir a bateria
 * de sondas a cada rota (ver `useNavAccess.ts`). O mapa guardado responde "o que o ator podia
 * abrir QUANDO ELE FOI CALCULADO" — e sobrevive a reload na mesma aba.
 *
 * Sem esta revisão, toda correção de sonda fica INVISÍVEL para quem já tem o mapa na aba: a
 * lógica nova entra, o navegador continua servindo o veredito antigo, e o defeito "corrigido"
 * reaparece idêntico na tela. Foi o caso de Despesas e Orçamentos, que seguiam visíveis no menu
 * (404 do detalhe lido como autorização) depois de o descritor passar a perguntar pela LISTA
 * (403 FINANCE_DENIED medido na fronteira real).
 *
 * REGRA: qualquer mudança em `SURFACE_ENTRY_READS`, em `COMPOSITE_SURFACES` ou na semântica de
 * `probeEntry` (o que autoriza, o que nega) EXIGE incrementar esta revisão. Mapa persistido com
 * revisão diferente é DESCARTADO e o menu é resolvido de novo pela rede.
 */
export const SURFACE_ACCESS_CONTRACT_VERSION = 2;

/** Operação de leitura que representa entrar no módulo. `null` = superfície sem leitura própria. */
export type SurfaceEntryRead = (unitId: string) => string | null;

/**
 * DESCRIPTOR CENTRAL. Chave = `accessCheck` declarado em `nav-config.ts`.
 *
 * O valor devolve a URL da leitura de ENTRADA da superfície, com o escopo autorizado quando a
 * operação exige unidade. É a mesma consulta que a página dispara ao abrir.
 */
export const SURFACE_ENTRY_READS: Record<string, SurfaceEntryRead> = {
  /* ---------------------------------------------------------------- COMERCIAL / OPERAÇÕES */
  'request-list': () => '/api/v1/requests/service-requests?limit=1&offset=0',
  'client-list': () => '/api/v1/clients?limit=1&offset=0',
  'proposal-list': () => '/api/v1/commercial/proposals?limit=1&offset=0',
  'purchase-order-list': () => '/api/v1/commercial/purchase-orders?limit=1&offset=0',
  'contract-list': () => '/api/v1/commercial/contracts?limit=1&offset=0',
  'catalog-list': () => '/api/v1/catalog/service-definitions?limit=1&offset=0',
  'asset-list': () => '/api/v1/resources/physical-assets?limit=1&offset=0',
  'people-list': () => '/api/v1/people?limit=1&offset=0',
  'service-order-list': () => '/api/v1/service-orders?limit=1&offset=0',
  'document-list': () => '/api/v1/documents?limit=1&offset=0',

  /* ------------------------------------------------------------------------- FINANCEIRO */
  'finance-receivable-list': () => '/api/v1/finance/receivables?limit=1&offset=0',
  'finance-payable-list': () => '/api/v1/finance/payables?limit=1&offset=0',
  'finance-treasury-list': () => '/api/v1/finance/treasury/accounts',
  'finance-reconciliation-read': () => '/api/v1/finance/bank-statements?limit=1&offset=0',
  'finance-expense-read': () => '/api/v1/finance/expenses?limit=1&offset=0',
  'finance-budget-read': () => '/api/v1/finance/budgets?limit=1&offset=0',
  // A previsão de caixa é por unidade + moeda. A sonda antiga usava `unitId` SINTÉTICO e por
  // isso nunca podia provar acesso; agora usa a unidade REAL do ator.
  'finance-forecast-read': (unitId) =>
    unitId ? `/api/v1/finance/cash-forecast?unitId=${enc(unitId)}&currencyCode=BRL` : null,

  /* ----------------------------------------------------------------------------- FISCAL */
  'fiscal-document-read': (unitId) =>
    unitId ? `/api/v1/fiscal/documents?unitId=${enc(unitId)}&page=0&pageSize=1` : null,
  'fiscal-period-read': (unitId) =>
    unitId ? `/api/v1/fiscal/periods?unitId=${enc(unitId)}&page=0&pageSize=1` : null,
  'fiscal-tax-read': (unitId) =>
    unitId ? `/api/v1/fiscal/tax/calculations?unitId=${enc(unitId)}&limit=1&offset=0` : null,

  /* ----------------------------------------------------------------------- CONTABILIDADE */
  // A entrada da contabilidade é o plano de contas da unidade (as demais telas derivam dele).
  'accounting-journal-read': (unitId) =>
    unitId ? `/api/v1/accounting/charts?unitId=${enc(unitId)}&limit=1&offset=0` : null,

  /* ------------------------------------------------------------------------- SUPRIMENTOS */
  'supplier-read': () => '/api/v1/suppliers?limit=1&offset=0',
  'procurement-read': () => '/api/v1/procurement/requests?limit=1&offset=0',
  'inventory-read': () => '/api/v1/inventory/items?limit=1&offset=0',

  /* ------------------------------------------- SUPERFÍCIES SEM LEITURA DE ENTRADA PRÓPRIA */
  /*
   * `billing`, `payroll` e `ativo imobilizado` NÃO publicam operação de listagem de entrada:
   *
   *   - faturamento é derivado de OS  (`/service-orders/{id}/billing-records`);
   *   - folha é por competência      (`/payroll/periods/{id}?unitId=`);
   *   - imobilizado é lookup por ativo (`/accounting/fixed-assets?unitId=&operationalAssetId=`).
   *
   * O menu não pode conhecer esse identificador. Nestas três, a PÁGINA e o MENU já usam a MESMA
   * sonda de capability (`BackofficeCapabilityRoute`) — logo concordam por construção, e uma
   * sonda nova aqui seria uma SEGUNDA regra de acesso para a mesma porta.
   */
  'billing-list': () => null,
  'payroll-read': () => null,
  'accounting-fixed-asset-read': () => null,
};

/**
 * Superfícies compostas: o acesso existe se QUALQUER entrada autorizada existir.
 * O painel financeiro abre com receber, pagar OU caixa — é a mesma regra que a página aplica.
 */
const COMPOSITE_SURFACES: Record<string, string[]> = {
  'finance-overview': [
    'finance-receivable-list',
    'finance-payable-list',
    'finance-treasury-list',
  ],
};

export type SurfaceAccessResult =
  /** A leitura de entrada respondeu 2xx: a página vai abrir. */
  | { outcome: 'allowed' }
  /** O servidor negou (403/404/etc.): o menu NÃO deve mostrar a porta. */
  | { outcome: 'denied' }
  /**
   * Não foi possível decidir por leitura de entrada (superfície sem leitura própria, ou escopo
   * de unidade ainda desconhecido). Quem chama decide — e usa a sonda de capability, que é a
   * MESMA da página.
   */
  | { outcome: 'undetermined' };

/* ------------------------------------------------------------------------------- ESCOPO */

const UNIT_STORAGE_KEY = 'cisne.navUnit.v1';
let unitCache: { identityId: string; units: string[] } | null = null;

/** Test-only reset for isolated unit tests. */
export function resetSurfaceAccessCacheForTests(): void {
  unitCache = null;
  try {
    window.sessionStorage.removeItem(UNIT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Unidade autorizada do ator — a MESMA lista que as páginas usam para montar o seletor.
 *
 * É resolvida uma única vez por sessão. Sem ela, as superfícies fiscais e contábeis não têm
 * como montar a leitura de entrada (o endpoint exige `unitId`), e o menu voltaria a adivinhar.
 */
export async function resolveAuthorizedUnit(
  identityId: string,
  signal?: AbortSignal,
): Promise<string> {
  const cached = unitCache;
  if (cached && cached.identityId === identityId) {
    return cached.units[0] ?? '';
  }

  try {
    const raw = window.sessionStorage.getItem(UNIT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { identityId?: unknown; units?: unknown };
      if (parsed.identityId === identityId && Array.isArray(parsed.units)) {
        const units = parsed.units.filter((u): u is string => typeof u === 'string');
        unitCache = { identityId, units };
        return units[0] ?? '';
      }
    }
  } catch {
    // cache é otimização; sem ele a resolução segue pela rede
  }

  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    return '';
  }

  try {
    const response = await fetch(
      `${getApiBaseUrl()}/api/v1/requests/service-requests/operational-units`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        signal,
      },
    );
    if (!response.ok) {
      return '';
    }
    const body = (await response.json()) as { items?: unknown };
    const units = Array.isArray(body.items)
      ? body.items.filter((u): u is string => typeof u === 'string')
      : [];
    unitCache = { identityId, units };
    try {
      window.sessionStorage.setItem(
        UNIT_STORAGE_KEY,
        JSON.stringify({ identityId, units }),
      );
    } catch {
      // sem persistência, o cache em memória ainda evita refetch na mesma sessão
    }
    return units[0] ?? '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------------------- SONDA */

/**
 * Executa a leitura de entrada e decide por evidência direta.
 *
 * FAIL-CLOSED: apenas 2xx autoriza. Qualquer outro status — inclusive 404 — significa "esta
 * leitura não provou acesso", e o menu esconde a porta. 401 é propagado: sessão inválida não é
 * decisão de visibilidade, é fim de sessão.
 */
async function probeEntry(url: string, signal?: AbortSignal): Promise<SurfaceAccessResult> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    return { outcome: 'denied' };
  }

  const response = await fetch(`${getApiBaseUrl()}${url}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal,
  });

  if (response.status === 401) {
    throw new Error('session_expired');
  }
  if (response.ok) {
    return { outcome: 'allowed' };
  }
  return { outcome: 'denied' };
}

/**
 * Decide o acesso de UMA superfície pelo contrato acima.
 *
 * Superfícies compostas tentam cada entrada e autorizam se qualquer uma responder 2xx.
 */
export async function probeSurfaceAccess(
  accessCheck: string,
  unitId: string,
  signal?: AbortSignal,
): Promise<SurfaceAccessResult> {
  const composite = COMPOSITE_SURFACES[accessCheck];
  if (composite) {
    let undetermined = false;
    for (const key of composite) {
      const result = await probeSurfaceAccess(key, unitId, signal);
      if (result.outcome === 'allowed') {
        return result;
      }
      if (result.outcome === 'undetermined') {
        undetermined = true;
      }
    }
    return undetermined ? { outcome: 'undetermined' } : { outcome: 'denied' };
  }

  const entry = SURFACE_ENTRY_READS[accessCheck];
  if (!entry) {
    // `authz-probe` e `access-admin` seguem suas sondas próprias (não são leitura de domínio).
    return { outcome: 'undetermined' };
  }

  const url = entry(unitId);
  if (!url) {
    return { outcome: 'undetermined' };
  }

  return probeEntry(url, signal);
}

/** `true` quando a superfície declara leitura de entrada própria. */
export function hasEntryRead(accessCheck: string): boolean {
  return Boolean(SURFACE_ENTRY_READS[accessCheck] || COMPOSITE_SURFACES[accessCheck]);
}
