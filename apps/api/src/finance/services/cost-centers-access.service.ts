import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { PayablesAccessAuthz } from './payables-access.authz';
import { mapPayableDomainError } from './payables-access.errors';
import { COST_CENTER_STATUSES, isCostCenterStatus } from '../domain/payable';
import { PayableError } from '../domain/payable';
import {
  validateCreateCostCenterInput,
  type CreateCostCenterInput,
} from '../domain/payable.validation';
import {
  CostCentersRepository,
  type CostCenterRow,
} from '../repositories/cost-centers.repository';
import type { FinanceListQuery } from '../dto/finance-list.dto';

/**
 * CENTRO DE CUSTO — servico de acesso.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE SERVICO FECHA
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Era o ultimo consumidor bloqueado por `PARK: HUMAN_LOOKUP_API_GAP` sem qualquer via de
 * leitura. Quatro fluxos do ERP exigiam um centro de custo que ninguem podia consultar:
 * conferencia de compra, nota de fornecedor, apuracao fiscal e despesa.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * REGRAS QUE ESTE SERVICO APLICA
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. AUTORIZACAO pelo caminho do dominio: a capability `finance:cost-center:list` passa pelo
 *      MESMO `PayablesAccessAuthz` das demais listagens do Financeiro — nenhum caminho de
 *      autorizacao paralelo e criado para um cadastro.
 *   2. RECUSA EXPLICITA de status desconhecido. Converter valor invalido em "sem filtro" faria
 *      o operador receber a lista inteira acreditando ter aplicado um recorte.
 *   3. AUDITORIA na criacao, com o mesmo `SecurityAuditService` e a mesma classificacao usada
 *      para categoria de despesa.
 *   4. NENHUM dado de negocio e semeado. A taxonomia de centro de custo e decisao empresarial.
 */

export type CostCenterResponse = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export type CostCenterListResponse = {
  items: CostCenterResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function toCostCenterResponse(row: CostCenterRow): CostCenterResponse {
  return { id: row.id, code: row.code, name: row.name, status: row.status };
}

@Injectable()
export class CostCentersAccessService {
  constructor(
    private readonly repository: CostCentersRepository,
    private readonly authz: PayablesAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  /**
   * LISTAGEM — referencia humana para os quatro consumidores bloqueados.
   *
   * O recorte usa o `FinanceListQuery` canonico do modulo: mesma paginacao, mesmos nomes de
   * parametro, mesmo shape de resposta que categoria de despesa, contas a pagar e orcamento.
   */
  async list(
    actor: IdentityAuthzContext,
    query: FinanceListQuery,
  ): Promise<CostCenterListResponse> {
    await this.authz.assertCostCenterList(actor);

    const statusCandidate = query.status?.toUpperCase();
    if (statusCandidate !== undefined && !isCostCenterStatus(statusCandidate)) {
      throw mapPayableDomainError(new PayableError('COST_CENTER_STATUS_INVALID'));
    }

    const filter = { search: query.q, status: statusCandidate };
    const total = await this.repository.count(filter);
    const rows = await this.repository.list({
      ...filter,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: rows.map(toCostCenterResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: query.limit > 0 ? Math.ceil(total / query.limit) : 0,
    };
  }

  async get(actor: IdentityAuthzContext, costCenterId: string): Promise<CostCenterResponse> {
    await this.authz.assertCostCenterList(actor);
    const row = await this.repository.findById(costCenterId);
    if (!row) {
      throw mapPayableDomainError(new PayableError('COST_CENTER_NOT_FOUND'));
    }
    return toCostCenterResponse(row);
  }

  async create(
    actor: IdentityAuthzContext,
    input: CreateCostCenterInput,
  ): Promise<CostCenterResponse> {
    await this.authz.assertCostCenterCreate(actor);
    try {
      const validated = validateCreateCostCenterInput(input);
      const row = await this.repository.create({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceCostCenterCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
        resourceId: row.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { code: row.code },
      });
      return toCostCenterResponse(row);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  /**
   * EXISTENCIA — usado pela validacao de referencia antes de gravar um titulo.
   *
   * Chamado somente pelo dominio Financeiro. Nao e endpoint: expor "existe ou nao" na borda HTTP
   * daria a qualquer ator um oraculo de existencia sobre registros que ele talvez nao leia.
   */
  async assertExists(costCenterId: string): Promise<void> {
    if (!(await this.repository.exists(costCenterId))) {
      throw mapPayableDomainError(new PayableError('COST_CENTER_NOT_FOUND'));
    }
  }

  /** Status validos do cadastro — expostos para a borda sem duplicar o conjunto. */
  get statuses(): readonly string[] {
    return Object.values(COST_CENTER_STATUSES);
  }
}
