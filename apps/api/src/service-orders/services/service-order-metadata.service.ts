import { Injectable } from '@nestjs/common';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from '../domain/service-order';
import {
  TRANSITIONS,
  canTransition,
  type ServiceOrderTransition,
} from '../domain/service-order.state-machine';
import {
  ServiceOrderMetadataRepository,
  AUDIT_TIMELINE_LIMIT_DEFAULT,
  AUDIT_TIMELINE_LIMIT_MAX,
  type AuditTimelineResult,
} from './service-order-metadata.repository';

/**
 * Metadados de OS para consumo do frontend (B4).
 *
 * PRINCIPIO DE EXPOSICAO: cada resposta abaixo responde uma pergunta que o
 * backend JA SABE responder. Nenhuma regra de negocio nasce aqui:
 *   - comandos e status vem integralmente da state machine (`TRANSITIONS`);
 *   - permissoes vem do `AuthorizationRepository` (mesma fonte do RBAC);
 *   - a timeline vem de `audit.audit_logs`.
 *
 * NAO existe decisao de autorizacao neste servico. O gate de acesso a OS
 * continua sendo feito pelo `ServiceOrdersAccessService` no controller.
 */

export type MeResponse = {
  usuario: {
    id: string;
    nome: string | null;
    email: string | null;
    identity_id: string;
  };
  permissoes_efetivas: string[];
  escopo_ativo: {
    tipo: string;
    resource_id: string | null;
  } | null;
  escopos_disponiveis: Array<{
    tipo: string;
    resource_id: string | null;
    label: string;
  }>;
};

export type AvailableAction = {
  comando: string;
  label: string;
  requer_permissao: string;
  usuario_tem_permissao: boolean;
};

export type AvailableActionsResponse = {
  service_order_id: string;
  status_atual: string;
  comandos_validos: AvailableAction[];
  comandos_invalidos_para_status: string[];
};

export type AuditTimelineResponse = {
  service_order_id: string;
  eventos: AuditTimelineResult['eventos'];
  total: number;
};

export type CommandCatalogEntry = {
  nome: string;
  label: string;
  status_origem: string[];
  status_destino: string;
  requer_justificativa: boolean;
};

export type CommandCatalogResponse = {
  comandos: CommandCatalogEntry[];
};

/**
 * Rotulos PT-BR dos comandos.
 *
 * Mapa LOCAL por decisao de escopo: a state machine e domínio puro e nao
 * carrega texto de interface. Nao existe catalogo previo de labels no
 * repositorio (verificado em B4/Fase 0). Este mapa NAO altera o domínio.
 */
const COMMAND_LABELS: Record<ServiceOrderTransition, string> = {
  prepare: 'Preparar',
  release: 'Liberar',
  cancel: 'Cancelar',
  start: 'Iniciar execução',
  pause: 'Pausar',
  resume: 'Retomar',
  complete: 'Concluir',
};

/**
 * Permissao exigida por comando, lida do vocabulario existente em
 * `AUTHZ_ACTIONS`. Nenhuma permissao nova e criada nesta sessao — os valores
 * abaixo sao literais ja declarados no RBAC.
 */
const COMMAND_PERMISSIONS: Record<ServiceOrderTransition, string> = {
  prepare: 'service-orders:service-order:prepare',
  release: 'service-orders:service-order:release',
  cancel: 'service-orders:service-order:cancel',
  start: 'service-orders:execution:start',
  pause: 'service-orders:execution:pause',
  resume: 'service-orders:execution:resume',
  complete: 'service-orders:execution:complete',
};

const COMMAND_NAMES = Object.keys(TRANSITIONS) as ServiceOrderTransition[];

const ALL_STATUSES = Object.values(SERVICE_ORDER_STATUSES) as ServiceOrderStatus[];

@Injectable()
export class ServiceOrderMetadataService {
  constructor(private readonly repository: ServiceOrderMetadataRepository) {}

  /**
   * Identidade + permissoes efetivas + escopo do usuario autenticado.
   *
   * LIMITACOES DE FONTE (declaradas, nao contornadas):
   *   - `nome` e `email`: `identity.identities` NAO possui essas colunas.
   *     Retornam `null` permanentemente, conforme a regra de nao inventar.
   *   - `escopo_ativo`: nao existe vinculo persistido sessao->escopo.
   *     `authorization.grants` nao tem coluna de sessao. Retorna `null`.
   */
  async getMe(actor: IdentityAuthzContext): Promise<MeResponse> {
    const grants = await this.repository.listActiveGrants(actor.identityId);

    return {
      usuario: {
        id: actor.identityId,
        nome: null,
        email: null,
        identity_id: actor.identityId,
      },
      permissoes_efetivas: toPermissionLabels(grants),
      escopo_ativo: null,
      escopos_disponiveis: toAvailableScopes(grants),
    };
  }

  /**
   * Comandos validos para o status atual, com a permissao especifica de cada um.
   *
   * `comandos_validos` vem EXCLUSIVAMENTE de `canTransition` sobre o mapa
   * `TRANSITIONS`. Os demais comandos vao para `comandos_invalidos_para_status`.
   */
  getAvailableActions(
    serviceOrderId: string,
    status: ServiceOrderStatus,
    permissions: ReadonlySet<string>,
  ): AvailableActionsResponse {
    const validos: AvailableAction[] = [];
    const invalidos: string[] = [];

    for (const comando of COMMAND_NAMES) {
      if (canTransition(status, comando)) {
        const requerPermissao = COMMAND_PERMISSIONS[comando];
        validos.push({
          comando,
          label: COMMAND_LABELS[comando],
          requer_permissao: requerPermissao,
          usuario_tem_permissao: permissions.has(requerPermissao),
        });
        continue;
      }
      invalidos.push(comando);
    }

    return {
      service_order_id: serviceOrderId,
      status_atual: status,
      comandos_validos: validos,
      comandos_invalidos_para_status: invalidos,
    };
  }

  async getAuditTimeline(
    serviceOrderId: string,
    limit?: number,
    offset?: number,
  ): Promise<AuditTimelineResponse> {
    const normalizedLimit = normalizeLimit(limit);
    const normalizedOffset = normalizeOffset(offset);
    const result = await this.repository.listAuditTimeline(
      serviceOrderId,
      normalizedLimit,
      normalizedOffset,
    );

    return {
      service_order_id: serviceOrderId,
      eventos: result.eventos,
      total: result.total,
    };
  }

  /**
   * Catalogo global de comandos. Nao depende do usuario nem de OS.
   *
   * `requer_justificativa` retorna `false` para todos: a state machine NAO
   * expoe essa informacao. O unico fluxo com justificativa obrigatoria e o
   * reopen (`assertReopenJustification`), que NAO e um comando de TRANSITIONS
   * e portanto nao aparece neste catalogo. Inventar o valor seria mentir para
   * a interface.
   */
  getCommandCatalog(): CommandCatalogResponse {
    return {
      comandos: COMMAND_NAMES.map((nome) => ({
        nome,
        label: COMMAND_LABELS[nome],
        status_origem: [...TRANSITIONS[nome].from],
        status_destino: TRANSITIONS[nome].to,
        requer_justificativa: false,
      })),
    };
  }

  /** Permissoes efetivas do ator, no mesmo formato do `/me`. */
  async getEffectivePermissions(actor: IdentityAuthzContext): Promise<Set<string>> {
    const grants = await this.repository.listActiveGrants(actor.identityId);
    return new Set(toPermissionLabels(grants));
  }
}

/**
 * Formata grants como `"recurso:acao"`. O `id` do grant nunca e exposto.
 *
 * `resource_type` no banco ja e o prefixo do recurso (ex.: `service-orders:service-order`),
 * e `action` ja e a acao qualificada (ex.: `service-orders:service-order:prepare`).
 * Usa-se a acao, que e o vocabulario efetivamente verificado pelo PDP.
 */
function toPermissionLabels(
  grants: Array<{ action: string; resource_type: string }>,
): string[] {
  const labels = new Set<string>();
  for (const grant of grants) {
    labels.add(grant.action);
  }
  return [...labels].sort();
}

/**
 * Escopos disponiveis derivados dos grants ativos.
 *
 * `label` e o proprio tipo de escopo em PT-BR quando conhecido; caso contrario
 * o valor bruto. Nao ha catalogo de labels de escopo no repositorio.
 */
function toAvailableScopes(
  grants: Array<{ scope_type: string; resource_id: string | null }>,
): Array<{ tipo: string; resource_id: string | null; label: string }> {
  const seen = new Set<string>();
  const scopes: Array<{ tipo: string; resource_id: string | null; label: string }> = [];

  for (const grant of grants) {
    const key = `${grant.scope_type}:${grant.resource_id ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    scopes.push({
      tipo: grant.scope_type,
      resource_id: grant.resource_id,
      label: SCOPE_LABELS[grant.scope_type] ?? grant.scope_type,
    });
  }

  return scopes;
}

const SCOPE_LABELS: Record<string, string> = {
  [AUTHZ_SCOPES.Own]: 'Próprio',
  [AUTHZ_SCOPES.Assigned]: 'Atribuído',
  [AUTHZ_SCOPES.Unit]: 'Unidade',
  [AUTHZ_SCOPES.Client]: 'Cliente',
  [AUTHZ_SCOPES.Contract]: 'Contrato',
  [AUTHZ_SCOPES.Document]: 'Documento',
  [AUTHZ_SCOPES.Financial]: 'Financeiro',
  [AUTHZ_SCOPES.Global]: 'Global',
  [AUTHZ_SCOPES.Platform]: 'Plataforma',
};

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return AUDIT_TIMELINE_LIMIT_DEFAULT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) {
    return AUDIT_TIMELINE_LIMIT_DEFAULT;
  }
  return Math.min(floored, AUDIT_TIMELINE_LIMIT_MAX);
}

function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }
  const floored = Math.floor(offset);
  return floored < 0 ? 0 : floored;
}

/** Statuses expostos para diagnostico/validacao do catalogo. */
export const SERVICE_ORDER_METADATA_STATUSES = ALL_STATUSES;
