import { Injectable } from '@nestjs/common';
import { SUPPLIER_STATUSES } from '../domain/supplier';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import {
  AuditTrailReadService,
  type AuditTimelineRow,
} from '../../audit/services/audit-trail-read.service';

/** Limites de paginação da timeline, iguais aos do domínio de OS. */
export const SUPPLIER_AUDIT_TIMELINE_LIMIT_DEFAULT = 100;
export const SUPPLIER_AUDIT_TIMELINE_LIMIT_MAX = 500;

/**
 * Contratos de resposta — declarados INLINE, seguindo a convenção do backend
 * (`service-order-metadata.service.ts` também declara os seus aqui, não em arquivo separado).
 */
export type SupplierAvailableAction = {
  comando: string;
  label: string;
  requer_permissao: string;
  usuario_tem_permissao: boolean;
};

export type SupplierAvailableActionsResponse = {
  supplier_id: string;
  status_atual: string;
  comandos_validos: SupplierAvailableAction[];
  comandos_invalidos_para_status: string[];
};

export type SupplierCommandCatalogEntry = {
  nome: string;
  label: string;
  status_origem: string[];
  status_destino: string;
  requer_justificativa: boolean;
};

export type SupplierCommandCatalogResponse = {
  comandos: SupplierCommandCatalogEntry[];
};

export type SupplierAuditTimelineEvent = {
  id: string;
  data: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  acao: string;
  status_anterior: string | null;
  status_novo: string | null;
  comando: string | null;
  correlation_id: string;
};

export type SupplierAuditTimelineResponse = {
  supplier_id: string;
  eventos: SupplierAuditTimelineEvent[];
  total: number;
};

/**
 * Mapa de comandos do Fornecedor.
 *
 * ESPECÍFICO DO DOMÍNIO, e deliberadamente NÃO importado de `service-orders/domain/`.
 * Fornecedor não é uma máquina de estados de ciclo operacional: são 3 comandos simples sobre
 * um status de 3 valores. Importar `TRANSITIONS` de OS aqui seria acoplar dois domínios que
 * não compartilham invariantes — OS tem 7 comandos, múltiplas origens e exigência de
 * planejamento/execução; Fornecedor não tem nada disso.
 *
 * O que É compartilhado (e por isso reusado, não reescrito): o FORMATO da resposta
 * (`comando`/`label`/`requer_permissao`/`usuario_tem_permissao`), o gate de autorização
 * (`SupplierAccessAuthz`), a leitura de grants (`AuthorizationRepository.listGrants`) e a
 * trilha (`AuditTrailReadService`).
 */
const SUPPLIER_COMMANDS = {
  activate: {
    from: [SUPPLIER_STATUSES.Inactive, SUPPLIER_STATUSES.Archived],
    to: SUPPLIER_STATUSES.Active,
    label: 'Ativar',
    permission: AUTHZ_ACTIONS.SupplierActivate,
  },
  deactivate: {
    from: [SUPPLIER_STATUSES.Active],
    to: SUPPLIER_STATUSES.Inactive,
    label: 'Inativar',
    permission: AUTHZ_ACTIONS.SupplierDeactivate,
  },
  archive: {
    from: [SUPPLIER_STATUSES.Inactive],
    to: SUPPLIER_STATUSES.Archived,
    label: 'Arquivar',
    /**
     * REUSO DECLARADO: o RBAC vigente tem 6 ações de fornecedor e NÃO possui
     * `supplier:supplier:archive`. Criá-la exigiria editar
     * `authorization/types/authz-actions.ts`, que é path protegido nesta sessão.
     *
     * Arquivar é uma mudança de CADASTRO, então usa a permissão de atualização já concedida —
     * em vez de inventar uma ação que nenhum grant do banco possui, o que faria o comando
     * aparecer permanentemente desabilitado para todo mundo. Ver ressalva de contrato no log.
     */
    permission: AUTHZ_ACTIONS.SupplierUpdate,
  },
} as const;

type SupplierCommandName = keyof typeof SUPPLIER_COMMANDS;

const SUPPLIER_COMMAND_NAMES = Object.keys(SUPPLIER_COMMANDS) as SupplierCommandName[];

@Injectable()
export class SupplierMetadataService {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly auditTrailRead: AuditTrailReadService,
  ) {}

  /** Permissões efetivas do ator, no mesmo formato do `/me`. */
  async getEffectivePermissions(actor: IdentityAuthzContext): Promise<Set<string>> {
    const grants = await this.authorizationRepository.listGrants(actor.identityId, false);
    return new Set(grants.map((grant) => grant.action));
  }

  getAvailableActions(
    supplierId: string,
    status: string,
    permissions: ReadonlySet<string>,
  ): SupplierAvailableActionsResponse {
    const validos: SupplierAvailableAction[] = [];
    const invalidos: string[] = [];

    for (const comando of SUPPLIER_COMMAND_NAMES) {
      const rule = SUPPLIER_COMMANDS[comando];
      if ((rule.from as readonly string[]).includes(status)) {
        validos.push({
          comando,
          label: rule.label,
          requer_permissao: rule.permission,
          // Mesma semântica do catálogo de OS: o backend resolve o veredito, a UI só renderiza.
          usuario_tem_permissao: permissions.has(rule.permission),
        });
        continue;
      }
      invalidos.push(comando);
    }

    return {
      supplier_id: supplierId,
      status_atual: status,
      comandos_validos: validos,
      comandos_invalidos_para_status: invalidos,
    };
  }

  getCommandCatalog(): SupplierCommandCatalogResponse {
    return {
      comandos: SUPPLIER_COMMAND_NAMES.map<SupplierCommandCatalogEntry>((nome) => ({
        nome,
        label: SUPPLIER_COMMANDS[nome].label,
        status_origem: [...SUPPLIER_COMMANDS[nome].from],
        status_destino: SUPPLIER_COMMANDS[nome].to,
        // `deactivate` exige motivo no serviço; o mapa não distingue por comando, então o
        // valor declara `false` como no catálogo de OS. Ver ressalva de contrato no log.
        requer_justificativa: false,
      })),
    };
  }

  /**
   * Trilha de auditoria do fornecedor.
   *
   * Reusa `AuditTrailReadService` — o dono do schema `audit` — em vez de SQL direto.
   * Leitura direta contra `audit.*` a partir do contexto COMMERCIAL violaria o gate de
   * fronteira (`module-boundary-rules.spec.ts`), exatamente como ocorreu em B4.
   */
  async getAuditTimeline(
    supplierId: string,
    limit?: number,
    offset?: number,
  ): Promise<SupplierAuditTimelineResponse> {
    const page = await this.auditTrailRead.listByRecord(
      'suppliers',
      supplierId,
      normalizeLimit(limit),
      normalizeOffset(offset),
    );

    return {
      supplier_id: supplierId,
      eventos: page.rows.map((row) => toTimelineEvent(row)),
      total: page.total,
    };
  }
}

function toTimelineEvent(row: AuditTimelineRow) {
  const antigos = asSnapshot(row.dados_antigos);
  const novos = asSnapshot(row.dados_novos);

  return {
    id: row.id,
    data: row.created_at,
    usuario_id: row.usuario_id ?? null,
    // Sem fonte de nome no modelo de identidade (mesma limitação declarada em B5).
    usuario_nome: null,
    acao: row.acao,
    status_anterior: typeof antigos?.['status'] === 'string' ? antigos['status'] : null,
    status_novo: typeof novos?.['status'] === 'string' ? novos['status'] : null,
    comando: typeof novos?.['comando'] === 'string' ? novos['comando'] : null,
    correlation_id: row.correlation_id,
  };
}

function asSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return SUPPLIER_AUDIT_TIMELINE_LIMIT_DEFAULT;
  }
  const floored = Math.floor(limit);
  return floored < 1 ? SUPPLIER_AUDIT_TIMELINE_LIMIT_DEFAULT : Math.min(floored, SUPPLIER_AUDIT_TIMELINE_LIMIT_MAX);
}

function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }
  const floored = Math.floor(offset);
  return floored < 0 ? 0 : floored;
}
