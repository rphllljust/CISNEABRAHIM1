import { HttpException, Injectable } from '@nestjs/common';
import {
  AuthorizationRepository,
  type GrantRow,
} from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS, type AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import {
  PURCHASE_REQUEST_STATUSES,
  SUPPLIER_PURCHASE_ORDER_STATUSES,
} from '../../procurement/domain/procurement';
import type {
  PurchaseRequestSummaryResponse,
  SupplierPurchaseOrderSummaryResponse,
} from '../../procurement/serializers/procurement-response.serializer';
import { ProcurementAccessService } from '../../procurement/services/procurement-access.service';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE SUPRIMENTOS — compra pendente de pessoa e recebimento pendente de mercadoria.
 *
 * Entram APENAS estados com trabalho real e proximo passo REAL declarado pelo dominio:
 * - `PENDING_APPROVAL` (solicitacao de compra enviada e sem decisao) — `assertRequestCanApprove` so
 *   aceita esse estado, e a tela de detalhe so habilita aprovar/rejeitar nele;
 * - `ISSUED` e `PARTIALLY_RECEIVED` (pedido ao fornecedor com recebimento pendente) —
 *   `assertOrderCanReceive` aceita exatamente esses dois estados e o detalhe habilita o recebimento
 *   neles. `ISSUED` nao e "pedido parado": e o pedido emitido cuja mercadoria ainda nao foi recebida
 *   (quantidade recebida = 0 pelo proprio `deriveSupplierPurchaseOrderStatus`), e o recebimento e a
 *   proxima etapa persistivel do dominio. `RECEIVED` e `CANCELLED` sao terminais e nao entram.
 *
 * Autorizacao: `ProcurementAccessService.listRequests` / `listOrders` sao a autoridade do modulo
 * SUPRIMENTOS. Sem concessao de lista o dominio responde 403 e a fonte devolve lista VAZIA (nunca
 * contagem, nunca item anonimizado, nunca sinal de existencia).
 *
 * ESCOPO DE UNIDADE (corrigido aqui, de proposito): a listagem de compras aplica apenas a presenca
 * de concessao (`assertList`) e monta o predicado SQL sem nenhum filtro de unidade
 * (`ProcurementAccessService.listRequests/listOrders` + `ProcurementRepository.listRequestPage/
 * listOrderPage`), enquanto a autorizacao por registro exige a ANCORA de escopo
 * (`procurement:request:read` / `procurement:order:read` casam `unit_id` com a concessao). No
 * caminho de leitura por identificador isso e decidido pelo dominio; na LISTA, nao. Herdar essa
 * ausencia faria a fila mostrar trabalho de unidade sem escopo — exatamente o que a Work Inbox nao
 * pode fazer. Por isso a fonte NAO aceita a linha sem antes aplicar a restricao de unidade com o
 * MESMO vocabulario do modulo de autorizacao: as concessoes da acao de lista sao lidas UMA vez por
 * coleta (`AuthorizationRepository.findActiveGrants`) e cada linha e avaliada em memoria por
 * `ScopeEnforcementService.canAccessRecord(grants, identidade, { resourceId, unitId })` — a mesma
 * decisao de escopo (`grantMatchesResourceContext`) usada pelo PDP, com `UNIT` casando somente a
 * unidade concedida e `GLOBAL` sem ancora enxergando todas. Nenhuma regra de acesso nova e escrita
 * aqui: a fonte apenas NAO emite o item, nunca um item parcial ou anonimizado.
 *
 * LEITURA EM LOTE: pagina no teto do contrato de lista do dominio, sem consulta por linha. Os
 * contextos (concessoes e paginas) sao lidos em lote; nada e consultado por item da fila.
 *
 * NENHUM PRAZO E INVENTADO: nem `prc.purchase_requests` nem `prc.supplier_purchase_orders` persistem
 * data de entrega/limite de recebimento (`payment_terms` e condicao de pagamento, nao prazo de
 * recebimento), portanto `dueAt` e sempre `null`.
 *
 * DEDUPLICACAO: chaves logicas `SUPRIMENTOS:PURCHASE_REQUEST:<id>` e `SUPRIMENTOS:SUPPLIER_ORDER:<id>`
 * — uma por obrigacao persistida, estavel entre leituras.
 */
@Injectable()
export class ProcurementWorkSource implements WorkItemSource {
  readonly domain = 'SUPRIMENTOS';

  constructor(
    private readonly procurement: ProcurementAccessService,
    private readonly authorization: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const [requests, orders] = await Promise.all([
      this.collectRequests(actor),
      this.collectOrders(actor),
    ]);
    // O id logico ja e unico por obrigacao; a guarda apenas mantem o invariante do contrato
    // ("a mesma obrigacao nunca entra duas vezes") caso a paginacao por offset repita uma linha
    // quando um registro muda de estado durante a leitura.
    return deduplicateById([...requests, ...orders]);
  }

  private async collectRequests(actor: WorkItemActor): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    try {
      const grants = await this.listGrants(actor, AUTHZ_ACTIONS.ProcurementRequestList);
      for (let offset = 0; ; offset += PROCUREMENT_READ_PAGE_SIZE) {
        const page = await this.procurement.listRequests(actor, {
          status: PURCHASE_REQUEST_STATUSES.PendingApproval,
          limit: PROCUREMENT_READ_PAGE_SIZE,
          offset,
        });
        items.push(
          ...page.items
            .filter((row) => this.isWithinUnitScope(grants, actor, row))
            .map(toPurchaseRequestWorkItem)
            .filter(isWorkItem),
        );
        if (page.items.length < PROCUREMENT_READ_PAGE_SIZE) {
          break;
        }
      }
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }
    return items;
  }

  private async collectOrders(actor: WorkItemActor): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    try {
      const grants = await this.listGrants(actor, AUTHZ_ACTIONS.ProcurementOrderList);
      for (const status of ORDER_STATES_WITH_PENDING_RECEIPT) {
        for (let offset = 0; ; offset += PROCUREMENT_READ_PAGE_SIZE) {
          const page = await this.procurement.listOrders(actor, {
            status,
            limit: PROCUREMENT_READ_PAGE_SIZE,
            offset,
          });
          items.push(
            ...page.items
              .filter((row) => this.isWithinUnitScope(grants, actor, row))
              .map(toSupplierOrderWorkItem)
              .filter(isWorkItem),
          );
          if (page.items.length < PROCUREMENT_READ_PAGE_SIZE) {
            break;
          }
        }
      }
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }
    return items;
  }

  /** Concessoes do ator para a acao de LISTA do dominio — uma leitura por coleta, nunca por linha. */
  private async listGrants(actor: WorkItemActor, action: AuthzAction): Promise<GrantRow[]> {
    return this.authorization.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.Procurement,
    );
  }

  /**
   * A linha so entra na fila quando a UNIDADE dela esta coberta pelas concessoes do ator. Sem
   * concessao utilizavel a avaliacao nega — fail-closed, nunca fail-open.
   */
  private isWithinUnitScope(
    grants: GrantRow[],
    actor: WorkItemActor,
    row: { id: string; unitId: string },
  ): boolean {
    return this.scopeEnforcement.canAccessRecord(grants, actor.identityId, {
      resourceId: row.id,
      unitId: row.unitId,
    });
  }
}

/**
 * Teto de leitura desta fonte.
 *
 * O contrato de lista de compras aceita `limit` de 1 a 100 (o dominio responde 400 fora dessa faixa)
 * e nao oferece paginacao por cursor. Ler no teto e o maximo que o contrato vigente permite; ler
 * menos seria truncar trabalho por escolha propria. A fonte avanca de pagina ate a ultima — nunca le
 * "quase tudo" em silencio.
 */
export const PROCUREMENT_READ_PAGE_SIZE = 100;

/** Estados do pedido ao fornecedor em que o dominio aceita recebimento (`assertOrderCanReceive`). */
const ORDER_STATES_WITH_PENDING_RECEIPT: readonly string[] = [
  SUPPLIER_PURCHASE_ORDER_STATUSES.Issued,
  SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived,
];

/**
 * Normaliza UMA solicitacao de compra em item de trabalho. Puro. Devolve `null` para qualquer estado
 * que nao seja o de decisao pendente: `DRAFT` e de quem redigiu, `APPROVED` espera emissao do pedido,
 * `REJECTED` e `CANCELLED` sao terminais.
 *
 * `businessReference`: a solicitacao nao tem codigo humano publicado; a referencia humana REAL e a
 * `justification` persistida (NOT NULL, com CHECK de conteudo), que e como o proprio serializer da
 * listagem declara que a linha se identifica. O UUID nunca vira referencia.
 *
 * `occurredAt` e o fato persistido que colocou a solicitacao na fila: o envio para aprovacao, que o
 * repositorio grava junto com o estado (`submitted_at`/`updated_at`); sem timestamp legivel o item e
 * OMITIDO.
 */
export function toPurchaseRequestWorkItem(row: PurchaseRequestSummaryResponse): WorkItem | null {
  if (row.status !== PURCHASE_REQUEST_STATUSES.PendingApproval) {
    return null;
  }
  const occurredAt = toIsoDateTime(row.updatedAt) ?? toIsoDateTime(row.createdAt);
  if (!occurredAt) {
    return null;
  }
  const justification = row.justification?.trim() ?? '';

  return {
    id: `SUPRIMENTOS:PURCHASE_REQUEST:${row.id}`,
    domain: 'SUPRIMENTOS',
    kind: 'APPROVAL',
    businessReference:
      justification !== '' ? justification : 'Solicitação de compra sem justificativa',
    title: 'Solicitação de compra aguardando aprovação',
    contextLabel: `Unidade ${row.unitId} · ${row.lineCount} linha(s) · ${row.currencyCode} ${row.totalAmount}`,
    status: row.status,
    reason: `Solicitação enviada para aprovação e ainda sem decisão registrada; o domínio só aceita aprovar ou rejeitar a partir de ${PURCHASE_REQUEST_STATUSES.PendingApproval} (assertRequestCanApprove), e a decisão segue segregação de funções em relação a quem solicitou.`,
    occurredAt,
    dueAt: null,
    actionLabel: 'Abrir a solicitação de compra para aprovação',
    targetRoute: `/app/procurement/requests/${row.id}`,
    unitId: row.unitId,
  };
}

/**
 * Normaliza UM pedido ao fornecedor em item de trabalho. Puro. Devolve `null` fora dos estados com
 * recebimento pendente: `RECEIVED` (nada mais a receber) e `CANCELLED` nao sao trabalho.
 *
 * `businessReference` e a referencia HUMANA do fornecedor ja resolvida pelo servidor (nome fantasia,
 * razao social ou CNPJ); cai para a data de emissao do pedido. Nunca usa o uuid do fornecedor nem o
 * do pedido.
 *
 * `occurredAt`: no recebimento parcial o ultimo fato persistido e o recebimento (`updated_at`); no
 * pedido apenas emitido o fato e a propria emissao (`issued_at`).
 */
export function toSupplierOrderWorkItem(
  row: SupplierPurchaseOrderSummaryResponse,
): WorkItem | null {
  if (!ORDER_STATES_WITH_PENDING_RECEIPT.includes(row.status)) {
    return null;
  }
  const issuedAt = toIsoDateTime(row.issuedAt);
  const updatedAt = toIsoDateTime(row.updatedAt);
  const occurredAt =
    row.status === SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived
      ? (updatedAt ?? issuedAt)
      : (issuedAt ?? updatedAt);
  if (!occurredAt) {
    return null;
  }

  return {
    id: `SUPRIMENTOS:SUPPLIER_ORDER:${row.id}`,
    domain: 'SUPRIMENTOS',
    kind: 'CONTINUITY',
    businessReference: supplierReference(row),
    title: 'Pedido ao fornecedor aguardando recebimento',
    contextLabel: `Unidade ${row.unitId} · ${row.lineCount} linha(s) · ${row.currencyCode} ${row.totalAmount}`,
    status: row.status,
    reason: describePendingReceipt(row),
    occurredAt,
    dueAt: null,
    actionLabel: 'Abrir o pedido ao fornecedor para recebimento',
    targetRoute: `/app/procurement/orders/${row.id}`,
    unitId: row.unitId,
  };
}

/** Referencia humana do fornecedor; sem cadastro resolvido, cai para a emissao do pedido. */
function supplierReference(row: SupplierPurchaseOrderSummaryResponse): string {
  const name = row.supplierName?.trim() ?? '';
  const taxId = row.supplierTaxId?.trim() ?? '';
  if (name !== '') {
    return name;
  }
  if (taxId !== '') {
    return `Fornecedor ${taxId}`;
  }
  return `Pedido ao fornecedor emitido em ${row.issuedAt}`;
}

/**
 * Motivo em linguagem de negocio com os fatos PERSISTIDOS da linha. A quantidade ja recebida e uma
 * QUANTIDADE de linha (nao ha unidade de medida no payload de lista) e o total do pedido e DINHEIRO:
 * os dois numeros aparecem separados de proposito, porque soma-los seria afirmar algo que o dado nao
 * diz.
 */
export function describePendingReceipt(row: SupplierPurchaseOrderSummaryResponse): string {
  if (row.status === SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived) {
    return `Recebimento parcial: quantidade já registrada nas linhas do pedido = ${row.receivedQuantity}; o pedido tem ${row.lineCount} linha(s) e valor total de ${row.currencyCode} ${row.totalAmount}. O domínio aceita registrar o restante enquanto o pedido está em ${row.status} (assertOrderCanReceive).`;
  }
  return `Pedido ao fornecedor emitido e ainda sem recebimento registrado (quantidade recebida nas linhas = ${row.receivedQuantity}) — é o estado ${SUPPLIER_PURCHASE_ORDER_STATUSES.Issued} que o domínio deriva quando nada foi recebido. Registrar o recebimento é a próxima etapa e o domínio a aceita a partir deste estado (assertOrderCanReceive).`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Converte um timestamp PERSISTIDO em ISO 8601 real; formato inesperado nao vira data. */
export function toIsoDateTime(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return null;
  }
  if (DATE_ONLY.test(text)) {
    return `${text}T00:00:00.000Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deduplicateById(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const unique: WorkItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

/** Negacao do dominio dono: 403 e a recusa de leitura desta fila. Outra falha nao vira fila vazia. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}
