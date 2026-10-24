import { HttpStatus, Injectable } from '@nestjs/common';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../platform/kernel/uuid';
import type {
  EconomicTraceView,
  EconomicWorklistView,
} from '../../platform/bounded-contexts/economic-trace.contract';
import { AccountingAccessAuthz } from './accounting-access.authz';
import { AccountingHttpException } from '../errors/accounting-http.exception';
import { ACCOUNTING_ERROR_CODES } from '../errors/accounting-error-codes';
import { EconomicTraceReadModelService } from '../repositories/economic-trace.read-model';

/**
 * F1.1 — SUPERFÍCIE DE LEITURA DA TRILHA ECONÔMICA (ACCOUNTING).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA SUPERFÍCIE É DE ACCOUNTING
 *
 * A trilha termina no JOURNAL, e journal é de ACCOUNTING. A leitura atravessa três
 * contexts, então quem monta a leitura é o contexto autorizado a ler os três
 * contratos publicados: ACCOUNTING (FINANCE → ACCOUNTING → PLATFORM está no grafo).
 * Pôr isto em FINANCE exigiria ler `acc.*` e `evt.*` — exatamente o que o gate de
 * fronteira proíbe, e ele estava certo: um título não deve inferir contabilidade por
 * conta própria.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * AUTORIZAÇÃO
 *
 * Ver o FATO financeiro (`finance:receivable:read` / `finance:payable:read`) é o que
 * autoriza ver a trilha: é o fato dele que está sendo rastreado. O journal aparece
 * como CONSEQUÊNCIA do fato que o ator já pode ver, não como porta de entrada para o
 * razão contábil.
 *
 * A worklist é de EXCEÇÕES CONTÁBEIS e exige a capability contábil.
 *
 * `availableCommands` é filtrado com as capabilities REAIS do ator antes de sair; a
 * tela nunca recebe um comando que não pode executar.
 */
@Injectable()
export class EconomicTraceAccessService {
  constructor(
    private readonly readModel: EconomicTraceReadModelService,
    private readonly authz: AccountingAccessAuthz,
  ) {}

  async forSettlement(actor: IdentityAuthzContext, settlementId: string): Promise<EconomicTraceView> {
    assertUuid(settlementId, 'settlementId');
    const owner = await this.readModel.settlementOwner(settlementId);
    if (!owner) {
      throw this.notFound();
    }
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.FinanceReceivableRead, {
      id: owner.receivableId,
      unitId: owner.unitId,
    });
    const trace = await this.readModel.forSettlement(settlementId);
    if (!trace) {
      throw this.notFound();
    }
    return this.filterCommands(actor, trace);
  }

  /**
   * TRILHA DE FATO NÃO FINANCEIRO (INVENTORY, FISCAL, PAYROLL, FIXED_ASSET).
   *
   * A trilha é a MESMA cadeia (fato → evento → posting → journal), então a autorização
   * usa `AccountingJournalRead`: quem pode ler o diário contábil pode ler a trilha de um
   * fato que ele contabiliza. Não há ampliação de acesso — é a mesma capability que a
   * worklist já exige para listar as exceções.
   */
  async forFact(
    actor: IdentityAuthzContext,
    factKind: string,
    factId: string,
  ): Promise<EconomicTraceView> {
    assertUuid(factId, 'factId');
    const trace = await this.readModel.forFact(factId);
    if (!trace) {
      throw this.notFound();
    }
    // O rótulo do caminho precisa descrever o fato REAL: um pedido de `settlement/...`
    // para um fato de INVENTORY é rota errada, não sinônimo. Recusar mantém a URL honesta.
    if (trace.factKind !== factKind.trim().toUpperCase()) {
      throw this.notFound();
    }
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalRead, {
      id: factId,
      unitId: trace.unitId,
    });
    return this.filterCommands(actor, trace);
  }

  async forPayment(actor: IdentityAuthzContext, paymentId: string): Promise<EconomicTraceView> {
    assertUuid(paymentId, 'paymentId');
    const owner = await this.readModel.paymentOwner(paymentId);
    if (!owner) {
      throw this.notFound();
    }
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.FinancePayableRead, {
      id: owner.payableId,
      unitId: owner.unitId,
    });
    const trace = await this.readModel.forPayment(paymentId);
    if (!trace) {
      throw this.notFound();
    }
    return this.filterCommands(actor, trace);
  }

  async worklist(
    actor: IdentityAuthzContext,
    query: { unitId: string; limit: number; offset: number; situation?: string },
  ): Promise<EconomicWorklistView> {
    if (!query.unitId.trim()) {
      throw new AccountingHttpException(
        HttpStatus.BAD_REQUEST,
        ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
        'unitId is required.',
      );
    }
    await this.authz.assertAccountingAction(actor, AUTHZ_ACTIONS.AccountingJournalRead, {
      id: actor.identityId,
      unitId: query.unitId,
    });
    return this.readModel.worklist(query.unitId, query.limit, query.offset, query.situation);
  }

  /**
   * Remove comandos que o ator não pode executar.
   *
   * O read model declara o conjunto ELEGÍVEL (o que faz sentido para o estado); aqui
   * aplicamos a AUTORIZAÇÃO. Sem isto, a tela desenharia "Reprocessar contabilização"
   * para quem receberia 403 — e o operador descobriria depois de clicar.
   */
  private async filterCommands(
    actor: IdentityAuthzContext,
    trace: EconomicTraceView,
  ): Promise<EconomicTraceView> {
    const canRetry = await this.authz.hasAccountingAction(
      actor,
      AUTHZ_ACTIONS.AccountingPostingRequest,
    );
    return {
      ...trace,
      availableCommands: trace.availableCommands.filter(
        (command) => command !== 'RETRY_POSTING' || canRetry,
      ),
    };
  }

  private notFound(): AccountingHttpException {
    return new AccountingHttpException(
      HttpStatus.NOT_FOUND,
      ACCOUNTING_ERROR_CODES.NOT_FOUND,
      'Economic fact not found.',
    );
  }
}

export type { EconomicTraceView, EconomicWorklistView };
