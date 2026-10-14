import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../../audit/audit.service';
import { AuditTrailReadService } from '../../audit/services/audit-trail-read.service';
import {
  AUDIT_ACTIONS,
  type AuditSnapshot,
} from '../../audit/audit-trail.types';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { CLIENT_ERROR_CODES } from '../errors/client-error-codes';
import { ClientHttpException } from '../errors/client-http.exception';
import type { ClientDetailRow } from '../serializers/client-response.serializer';

/**
 * TRILHA DE AUDITORIA DO CADASTRO DE CLIENTES.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE SERVIÇO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O canal AUDIT_TRAIL (`audit.audit_logs`, migration 0082) já existia e já registrava mudança de
 * valor — mas NENHUM módulo de Clientes escrevia nele. O cadastro de Clientes registrava apenas
 * `security_audit_events` (ação/resultado): "fulano executou client:client:update com SUCESSO".
 * Isso responde QUEM agiu e QUANDO, e não responde a pergunta que a governança de cadastro de fato
 * faz — "o que mudou, de qual valor para qual valor".
 *
 * As duas trilhas são COMPLEMENTARES e as duas continuam sendo escritas:
 *
 *   security_audit  — ação + resultado + ator + sessão. Prova de que a operação ocorreu.
 *   audit_trail     — par (valor anterior, valor novo) por registro. Prova do que a operação mudou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRAS DE HONESTIDADE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. A trilha roda DENTRO da transação do chamador (`AuditService.registrar` recebe o `PoolClient`).
 *    Uma mutação que sofre rollback não deixa rastro — a trilha nunca afirma mudança que não
 *    persistiu.
 * 2. NENHUM SEGREDO ENTRA. O `AuditService` aplica `redactAuditMetadata` como segunda barreira, e
 *    este serviço só publica campos de ESTADO do cadastro (nomes, situação, contagens) — jamais o
 *    snapshot de domínio inteiro nem dado financeiro.
 * 3. A trilha é APPEND-ONLY no banco (gatilho criado na migration 0097). Nada aqui atualiza ou
 *    apaga; este arquivo só insere e lê.
 */

/** Nome da tabela auditada. É a chave de correlação com `audit_logs.tabela`. */
export const CLIENT_AUDIT_TABLE = 'pty.clients';

/**
 * CONTEXTO DE AUDITORIA — quem agiu e sob qual correlação.
 *
 * `correlationId` é opcional no tipo porque a trilha consegue gerar um. O `sessionId` do ator NÃO
 * entra aqui: a trilha de VALOR registra o AUTOR da mudança (`usuario_id`), e a sessão pertence ao
 * canal de segurança, que já a grava. Duplicá-la aqui não acrescentaria informação.
 */
export type ClientAuditContext = {
  identityId: string;
  /** UUID da requisição. Sem ele a trilha não pode ser correlacionada com o log de acesso. */
  correlationId?: string;
};

/**
 * Correlação a partir do header da requisição.
 *
 * `audit_logs.correlation_id` é `NOT NULL uuid`. O header `x-correlation-id` é TEXTO LIVRE
 * (`resolveCorrelationId` aceita até 64 caracteres), então ele NÃO é usado como uuid diretamente:
 * converter texto arbitrário em uuid produziria erro de tipo no banco e a escrita da trilha
 * falharia por causa do formato de um header de observabilidade — inaceitável.
 *
 * A ordem é: header válido como uuid vence (correlaciona com o log de acesso); caso contrário, um
 * uuid NOVO é gerado. A trilha nunca fica sem correlação nem falha por formato.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveAuditCorrelationId(raw: string | undefined): string {
  if (raw && UUID_PATTERN.test(raw)) {
    return raw;
  }
  return randomUUID();
}

@Injectable()
export class ClientAuditService {
  constructor(
    private readonly auditService: AuditService,
    private readonly auditTrailRead: AuditTrailReadService,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Registra a leitura do cadastro. NÃO grava na trilha de valor.
   *
   * Leitura não altera valor, então não pertence a `audit_logs` — quem registra leitura é o canal
   * de segurança, no ponto de decisão de autorização. Este método existe apenas para deixar
   * explícita a ausência, em vez de sugerir que a leitura ficou sem registro.
   */
  async recordTransition(
    tx: PoolClient,
    actor: ClientAuditContext,
    clientId: string,
    before: ClientDetailRow | null,
    after: ClientDetailRow | null,
  ): Promise<void> {
    const acao =
      before === null
        ? AUDIT_ACTIONS.Create
        : after !== null && before.status !== after.status
          ? AUDIT_ACTIONS.Transition
          : AUDIT_ACTIONS.Update;

    await this.auditService.registrar(
      {
        tabela: CLIENT_AUDIT_TABLE,
        registroId: clientId,
        acao,
        dadosAntigos: before === null ? null : toAuditableSnapshot(before),
        dadosNovos: after === null ? null : toAuditableSnapshot(after),
        usuarioId: actor.identityId,
        correlationId: resolveAuditCorrelationId(actor.correlationId),
      },
      tx,
    );
  }

  /**
   * Trilha de um Cliente, paginada, já traduzida para leitura humana.
   *
   * A leitura vive no `AuditTrailReadService`, dono do schema `audit` — SQL direto contra schema de
   * outro contexto é proibido pelo gate de fronteira. Aqui só se adapta o resultado.
   */
  async listForClient(
    clientId: string,
    limit: number,
    offset: number,
  ): Promise<ClientAuditTrailResponse> {
    const page = await this.auditTrailRead.listByRecord(
      CLIENT_AUDIT_TABLE,
      clientId,
      limit,
      offset,
    );
    return {
      items: page.rows.map((row) => ({
        id: row.id,
        action: row.acao,
        actorIdentityId: row.usuario_id,
        correlationId: row.correlation_id,
        occurredAt: row.created_at,
        before: row.dados_antigos,
        after: row.dados_novos,
      })),
      limit,
      offset,
      total: page.total,
      totalPages: Math.ceil(page.total / limit),
    };
  }
}

/**
 * SNAPSHOT AUDITÁVEL — somente campos de ESTADO do cadastro.
 *
 * A lista é um ALLOW-LIST fechada, e não um espalhamento do registro. É o que garante que um campo
 * novo e sensível adicionado ao Cliente no futuro NÃO passe a ser auditado por acidente: ele só
 * entra na trilha quando alguém o acrescentar aqui, de forma deliberada.
 *
 * Ficam de fora, de propósito: contatos e endereços completos (dado pessoal de terceiros — a
 * trilha registra a mudança de estrutura, não a ficha de cada pessoa), e qualquer valor financeiro.
 */
function toAuditableSnapshot(row: ClientDetailRow): AuditSnapshot {
  return {
    legalName: row.legal_name,
    tradeName: row.trade_name,
    status: row.status,
    externalErpId: row.external_erp_id,
    purchaseOrderRequirement: row.purchase_order_requirement,
    groupId: row.group_id,
    parentClientId: row.parent_client_id,
    version: row.version,
  };
}

export type ClientAuditTrailEntry = {
  id: string;
  action: string;
  /**
   * Identidade do autor. O identificador é publicado porque é o que permite a OUTRA tela
   * (administração de acesso) resolver o nome; resolver aqui exigiria acoplar Clientes ao
   * repositório de identidades.
   */
  actorIdentityId: string;
  correlationId: string;
  occurredAt: string;
  before: AuditSnapshot;
  after: AuditSnapshot;
};

export type ClientAuditTrailResponse = {
  items: ClientAuditTrailEntry[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

/**
 * Erro de leitura da trilha quando o banco não está configurado.
 *
 * Existe para que a ausência seja um 503 explícito em vez de uma lista vazia — "não há alterações
 * registradas" e "não consegui consultar" são fatos diferentes e não podem compartilhar resposta.
 */
export function assertAuditReadAvailable(databaseService: DatabaseService): void {
  if (!databaseService.getConnection()) {
    throw new ClientHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      CLIENT_ERROR_CODES.VALIDATION_FAILED,
      'Database is not configured.',
    );
  }
}
