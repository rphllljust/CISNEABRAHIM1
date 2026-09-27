import type { SmartRelationSpec } from '../../enterprise-object';
import { buildServiceOrdersListHref } from '../../service-orders/utils/service-order-list-params';
import type { ClientRelatedModules, RelatedModule } from '../hooks/useClientRelatedRecords';

/**
 * RELAÇÕES REAIS DO CLIENTE — declaradas para `buildAuthorizedRelations`.
 *
 * Cada relação é composta por três fatos verificáveis:
 *
 * 1. `to` — destino real e filtrado: a lista do módulo com o parâmetro de filtro que a própria API
 *    daquele módulo publica (`clientId`). Ordens de serviço usam o montador de href do módulo, que
 *    é quem lê o parâmetro na tela.
 * 2. `count` — contagem comprovada pelo backend (`useClientRelatedRecords`). Sem contagem
 *    comprovada a relação NÃO é declarada: o contrato não aceita número estimado e não existe
 *    contagem "0" de cortesia — 0 só quando o conjunto vazio foi provado.
 * 3. `allowed` — leitura autorizada pelo servidor E contagem comprovada. Módulo negado (403) entra
 *    como não autorizado e o primitivo o descarta por inteiro: sem rótulo, sem contagem e sem a
 *    palavra "oculto". `count: 0` em relação não autorizada é apenas o preenchimento obrigatório do
 *    tipo — esse número nunca chega à barra, porque `buildAuthorizedRelations` o remove antes.
 */
export function buildClientRelationSpecs(
  modules: ClientRelatedModules,
  clientId: string,
): SmartRelationSpec[] {
  return [
    toSpec('requests', 'Solicitações', `/app/requests?clientId=${clientId}`, modules.requests),
    toSpec('proposals', 'Propostas', `/app/proposals?clientId=${clientId}`, modules.proposals),
    toSpec(
      'purchaseOrders',
      'Pedidos de compra',
      `/app/purchase-orders?clientId=${clientId}`,
      modules.purchaseOrders,
    ),
    toSpec(
      'serviceOrders',
      'Ordens de serviço',
      buildServiceOrdersListHref({ clientId }),
      modules.serviceOrders,
    ),
  ];
}

function toSpec(id: string, label: string, to: string, module: RelatedModule): SmartRelationSpec {
  return {
    id,
    label,
    to,
    count: module.count ?? 0,
    allowed: module.allowed && module.count !== null,
  };
}
