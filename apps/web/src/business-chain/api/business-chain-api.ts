import { authHeaders, requestJson } from '../../financial-ui/enterprise-api';
import type { BusinessChain, BusinessChainAnchorKind } from '../types';

/**
 * BUSINESS CHAIN — UMA requisicao monta a linhagem inteira.
 *
 * A object page NAO dispara uma requisicao por no da cadeia: cliente, solicitacao, proposta,
 * pedido, OS, medicao, faturamento, recebivel, liquidacao, fiscal e contabilidade vem na mesma
 * resposta, ja autorizados e ja ordenados pelo servidor.
 */
export async function getBusinessChain(
  anchorKind: BusinessChainAnchorKind,
  anchorId: string,
  signal?: AbortSignal,
): Promise<BusinessChain> {
  return requestJson<BusinessChain>(
    `/api/v1/business-chain/${anchorKind}/${anchorId}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}
