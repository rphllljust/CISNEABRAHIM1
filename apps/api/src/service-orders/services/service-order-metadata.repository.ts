import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import {
  AuditTrailReadService,
  type AuditTimelineRow,
} from '../../audit/services/audit-trail-read.service';

/**
 * Leitura de metadados do service-orders para consumo do frontend.
 *
 * Escopo de B4: EXPOSICAO. Este servico nao cria regra de negocio, nao cria
 * estado, nao cria comando e nao altera nenhuma decisao existente — apenas
 * projeta, em contrato fixo, o que o backend ja sabe (trilha de auditoria e
 * catalogo de comandos da state machine).
 *
 * Nenhuma query aqui autoriza nada: a autorizacao continua sendo do
 * `ServiceOrdersAccessService` (RBAC/PDP/scope enforcement).
 */
export type AuditTimelineEvent = {
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

export type AuditTimelineResult = {
  eventos: AuditTimelineEvent[];
  total: number;
};

/**
 * Campos RESTRICTED/FINANCIAL que NUNCA podem sair na timeline.
 *
 * Defesa em profundidade: o `AuditService` ja aplica `redactAuditMetadata`
 * antes de persistir, e a gravacao so inclui a grade de estado (`status`,
 * `rowVersion`, `comando`, `updatedAt`). Ainda assim a leitura reaplica a
 * filtragem, porque uma linha gravada por caminho futuro nao previsto nao
 * pode virar vazamento por heranca.
 */
const FORBIDDEN_TIMELINE_KEYS = new Set([
  'client_snapshot',
  'service_snapshot',
  'contract_snapshot',
  'tax_id',
  'cost_amount',
  'cpf',
  'cnpj',
  'x-api-key',
]);

export const AUDIT_TIMELINE_LIMIT_DEFAULT = 100;
export const AUDIT_TIMELINE_LIMIT_MAX = 500;

@Injectable()
export class ServiceOrderMetadataRepository {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly auditTrailRead: AuditTrailReadService,
  ) {}

  /**
   * Grants ativos do usuario. Delegado a `AuthorizationRepository.listGrants`
   * — nenhuma query de permissao e escrita neste arquivo.
   */
  async listActiveGrants(identityId: string) {
    return this.authorizationRepository.listGrants(identityId, false);
  }

  /**
   * Trilha de auditoria da OS, em ordem cronologica ascendente.
   *
   * A leitura e delegada ao `AuditTrailReadService` (contexto PLATFORM, dono do
   * schema `audit`). SQL direto contra `audit.*` a partir de OPERATIONS seria
   * violacao de fronteira — ver `module-boundary-rules.spec.ts`.
   */
  async listAuditTimeline(
    serviceOrderId: string,
    limit: number,
    offset: number,
  ): Promise<AuditTimelineResult> {
    const page = await this.auditTrailRead.listByRecord(
      'service_orders',
      serviceOrderId,
      limit,
      offset,
    );

    return {
      eventos: page.rows.map((row) => toTimelineEvent(row)),
      total: page.total,
    };
  }
}

/**
 * Projeta a linha de auditoria no contrato da timeline.
 *
 * Extrai SOMENTE `status` e `comando` dos JSONB — `dados_antigos` e
 * `dados_novos` crus nunca sao retornados. Leitura defensiva: um snapshot que
 * nao seja objeto simples e tratado como ausente, nunca serializado.
 */
function toTimelineEvent(row: AuditTimelineRow): AuditTimelineEvent {
  const antigos = safeSnapshot(row.dados_antigos);
  const novos = safeSnapshot(row.dados_novos);

  return {
    id: row.id,
    data: row.created_at,
    usuario_id: row.usuario_id ?? null,
    // Sem fonte de nome no modelo de identidade (identity.identities nao possui
    // coluna de nome). Retorna null em vez de inventar ou fazer join pesado.
    usuario_nome: null,
    acao: row.acao,
    status_anterior: typeof antigos?.['status'] === 'string' ? antigos['status'] : null,
    status_novo: typeof novos?.['status'] === 'string' ? novos['status'] : null,
    comando: typeof novos?.['comando'] === 'string' ? novos['comando'] : null,
    correlation_id: row.correlation_id,
  };
}

/**
 * Normaliza um snapshot JSONB, descartando chaves RESTRICTED/FINANCIAL antes
 * de qualquer leitura. Chaves desconhecidas sao preservadas apenas para nunca
 * serem serializadas — o contrato so le `status` e `comando`.
 */
function safeSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (FORBIDDEN_TIMELINE_KEYS.has(key.toLowerCase())) {
      continue;
    }
    filtered[key] = entry;
  }
  return filtered;
}
