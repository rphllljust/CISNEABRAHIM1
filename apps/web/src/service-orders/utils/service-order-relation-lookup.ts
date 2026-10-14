import { listClients } from '../../clients/api/clients-api';
import { listProposals } from '../../proposals/api/proposals-api';
import { listPurchaseOrders } from '../../purchase-orders/api/purchase-orders-api';
import type { HumanLookupOption } from '../../financial-ui/HumanLookupField';

/**
 * BUSCA HUMANA DAS RELAÇÕES DE ORIGEM DA OS.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO CORRIGE
 *
 * A criação de OS pedia a PROPOSTA, o PEDIDO DE COMPRA e o CLIENTE como TEXTO LIVRE, esperando um
 * UUID digitado. O operador não conhece UUID de nada: ele conhece o número da proposta, o número do
 * pedido e o nome do cliente. Na prática o campo era intransponível, e a origem "Proposta aceita" só
 * funcionava para quem já tinha o identificador em mãos.
 *
 * A justificativa registrada no arquivo era "inventar um seletor sem fonte autoritativa seria pior
 * que pedir o identificador". A premissa está ERRADA: as três fontes existem e já são usadas por
 * outras telas do produto —
 *
 *   proposta       `listProposals`        (GET /commercial/proposals, com `search` no servidor)
 *   pedido         `listPurchaseOrders`   (GET /commercial/purchase-orders, com `search`)
 *   cliente        `listClients`          (GET /clients, com `search`)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTAS FUNÇÕES FAZEM — E O QUE NÃO FAZEM
 *
 * Cada uma consulta o SERVIDOR com o termo digitado e devolve rótulo HUMANO + código de apoio. O
 * identificador técnico circula apenas internamente, entre o `value` da opção e o payload de criação:
 * ele nunca aparece como texto na tela.
 *
 * NÃO filtram no navegador. Um seletor que baixasse a primeira página e filtrasse localmente diria
 * "não existe" para uma proposta que está na página 3 — o mesmo defeito que a busca de worklist já
 * corrigiu indo ao servidor.
 *
 * NÃO inventam opção. Lista vazia significa lista vazia, e o `HumanLookupField` diz isso em voz alta.
 */

/** Um limite baixo é suficiente: o operador busca pelo código antes de escolher. */
const LOOKUP_LIMIT = 20;

/** Código do pedido dentro do snapshot do cliente — rótulo de apoio, nunca identificador. */
function supportFromSnapshot(snapshot: Record<string, unknown> | null): string | undefined {
  if (!snapshot) {
    return undefined;
  }
  for (const key of ['tradeName', 'legalName', 'documentNumber']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * PROPOSTAS ACEITAS E VIGENTES.
 *
 * O recorte de situação NÃO é aplicado aqui: `listProposals` aceita filtros, mas decidir quais
 * situações são "aceitas" é regra do domínio comercial, não da tela de OS. A tela mostra o que o
 * servidor devolve com a situação PUBLICADA ao lado, e o servidor valida o vínculo na criação.
 */
export async function searchProposalsForLookup(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const response = await listProposals(
    { limit: LOOKUP_LIMIT, offset: 0, search: term.trim() || undefined },
    signal,
  );
  return response.items.map((proposal) => ({
    id: proposal.id,
    label: proposal.proposalCode,
    support: proposal.title || proposal.currentVersionStatus || undefined,
  }));
}

export async function searchPurchaseOrdersForLookup(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const response = await listPurchaseOrders(
    { limit: LOOKUP_LIMIT, offset: 0, search: term.trim() || undefined },
    signal,
  );
  return response.items.map((order) => ({
    id: order.id,
    label: order.poNumber,
    support: order.rcNumber ? `RC ${order.rcNumber}` : supportFromSnapshot(order.clientSnapshot),
  }));
}

export async function searchClientsForLookup(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  /*
   * `q`, e NAO `search`: o contrato de `/clients` publica o termo como `q`
   * (`buildListClientsQuery`). Proposta e pedido usam `search`. A diferenca e do servidor, e passá-la
   * errada faria a busca do cliente ignorar o termo em silencio — devolvendo a primeira pagina como
   * se fosse o resultado procurado.
   */
  const response = await listClients(
    { limit: LOOKUP_LIMIT, offset: 0, q: term.trim() || undefined },
    signal,
  );
  return response.items.map((client) => ({
    id: client.id,
    label: client.tradeName || client.legalName,
    support: client.tradeName ? client.legalName : undefined,
  }));
}
