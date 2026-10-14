import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  ClientFinancialContextRepository,
  type ClientFinancialContext,
} from '../repositories/client-financial-context.repository';
import { ReceivablesAccessAuthz } from './receivables-access.authz';

/**
 * CONTEXTO FINANCEIRO DO CLIENTE — SERVIÇO DO CONTEXTO FINANCEIRO.
 *
 * O módulo de Clientes NÃO lê `fin.receivables`: ele consome este serviço pela porta publicada.
 * Isso mantém a fronteira de contexto (o dono do schema é quem escreve SQL contra ele) e faz a
 * autorização ser decidida UMA vez, no domínio que entende de título.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DOIS NÍVEIS DE AUTORIZAÇÃO, E A DIFERENÇA IMPORTA
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. CAPABILITY (`finance:receivable:list`) — sem ela o ator não tem nada a ver com títulos, e a
 *    resposta é 403. Não há motivo para mostrar "desconhecido": ele não pode ter esse dado.
 * 2. ESCOPO (concessões) — com a capability mas sem concessão utilizável, o ator PODE ter títulos
 *    em algum recorte que não alcança este Cliente. Aqui a resposta é `authorized: false` com os
 *    valores em `null`, e NÃO um erro: a ficha continua utilizável, e a seção financeira declara
 *    que o dado não está ao alcance dele. Devolver zeros seria afirmar "este Cliente não deve
 *    nada", que é uma afirmação FALSA sobre dado que ninguém conseguiu ler.
 */
@Injectable()
export class ClientFinancialContextService {
  constructor(
    private readonly repository: ClientFinancialContextRepository,
    private readonly authz: ReceivablesAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async forClient(
    actor: IdentityAuthzContext,
    clientId: string,
  ): Promise<ClientFinancialContext> {
    // (1) CAPABILITY — negada vira 403 no filtro de exceção do módulo financeiro.
    await this.authz.assertReceivableList(actor);

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.FinanceReceivableList,
      AUTHZ_RESOURCE_TYPES.FinanceReceivable,
    );

    // O escopo de títulos é derivado das CONCESSÕES (unidade e/ou cliente), nunca de parâmetro.
    // `FALSE` significa "nenhuma concessão utilizável" — ver (2) acima.
    const scope = this.scopeEnforcement.buildFinancialTitleListFilter(grants);
    const asOf = new Date().toISOString();

    if (scope.clause === 'FALSE') {
      return { evaluated: true, authorized: false, currencies: null, asOf };
    }

    const currencies = await this.repository.summarizeForClient({ clientId, scope });

    /*
     * LISTA VAZIA É UM FATO, E É DIFERENTE DE NÃO AUTORIZADO.
     *
     * `authorized: true` com `currencies: []` significa "consultei sob o seu escopo e este Cliente
     * não tem título". A UI mostra "sem títulos" — não "R$ 0,00", que sugeriria um saldo zerado
     * medido, nem "sem acesso", que seria falso.
     */
    return { evaluated: true, authorized: true, currencies, asOf };
  }
}
