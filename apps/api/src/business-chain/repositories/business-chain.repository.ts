import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { BusinessChainNodeKind } from '../contracts/business-chain.contract';

/**
 * BUSINESS CHAIN — READ MODEL SERVER-SIDE.
 *
 * DUAS idas ao banco, CONSTANTES, independentemente do tamanho da cadeia:
 *
 *   1. `resolveSpine`  — percorre as FKs reais a partir do anchor e devolve os pares
 *                        (kind, entity_id) de TODA a linhagem, em uma unica instrucao SQL.
 *   2. `loadNodeFacts` — carrega os fatos de todos os nos de uma vez, em lote, tambem em uma
 *                        unica instrucao SQL.
 *
 * Nao existe consulta por no (sem N+1). Nao existe cache: a cadeia nunca e servida a partir de
 * copia — o read model e sempre derivado do estado persistido atual.
 *
 * Toda leitura atravessa o contrato de leitura entre contextos (`rpt.read_*`), que e a fronteira
 * publicada pelos dominios donos. Este modulo NAO escreve, NAO reimplementa regra de dominio e
 * NAO cria segunda fonte de verdade: ele apenas segue as FKs que os dominios ja mantem.
 *
 * PROVENIENCIA: a ligacao entre dois nos e sempre uma FK real
 * (`service_requests.proposal_id`, `measurements.service_order_id`,
 * `receivables.origin_billing_document_id`, `fiscal_documents.billing_document_id`,
 * `journal_entries.source_kind/source_id`, ...). NAO existe ligacao por valor, por data
 * proxima, por texto ou por qualquer heuristica.
 */

export type ChainAnchorKind = BusinessChainNodeKind;

export type ChainSpineEntry = {
  kind: BusinessChainNodeKind;
  entityId: string;
};

export type ChainNodeFactRow = {
  kind: BusinessChainNodeKind;
  entity_id: string;
  business_reference: string;
  status: string;
  occurred_at: string;
  unit_id: string | null;
  client_id: string | null;
  /** Id do objeto pai usado para compor rotas de sub-tela (medicao, faturamento). */
  context_id: string | null;
  summary: string;
};

/**
 * Passo 1 — espinha da cadeia.
 *
 * Cada CTE segue EXCLUSIVAMENTE uma coluna de FK/`source_id` declarada. O anchor CLIENT e a
 * raiz: a partir dele a cadeia nao e enumerada (a object page do cliente apresenta as relacoes
 * acionaveis com recorte), exatamente para nao virar um dump de registros.
 */
const SPINE_SQL = `
WITH input AS (
  SELECT $1::text AS kind, $2::uuid AS id
),
so_set AS (
  SELECT s.id, s.client_id, s.service_request_id, s.proposal_id, s.purchase_order_id
  FROM rpt.read_service_orders s, input i
  WHERE (i.kind = 'SERVICE_ORDER' AND s.id = i.id)
     OR (i.kind = 'SERVICE_REQUEST' AND s.service_request_id = i.id)
     OR (i.kind = 'PROPOSAL' AND s.proposal_id = i.id)
     OR (i.kind = 'PURCHASE_ORDER' AND s.purchase_order_id = i.id)
     OR (i.kind = 'MEASUREMENT' AND s.id = (SELECT m.service_order_id FROM rpt.read_measurements m WHERE m.id = i.id))
     OR (i.kind = 'BILLING_DOCUMENT' AND s.id = (SELECT d.service_order_id FROM rpt.read_billing_documents d WHERE d.id = i.id))
     OR (i.kind = 'RECEIVABLE' AND s.id = (SELECT r.origin_service_order_id FROM fin.receivables r WHERE r.id = i.id))
),
client_ids AS (
  SELECT c.id FROM rpt.read_clients c, input i WHERE i.kind = 'CLIENT' AND c.id = i.id
  UNION SELECT so.client_id FROM so_set so WHERE so.client_id IS NOT NULL
  UNION SELECT sr.client_id FROM rpt.read_service_requests sr, input i
        WHERE i.kind = 'SERVICE_REQUEST' AND sr.id = i.id AND sr.client_id IS NOT NULL
  UNION SELECT p.client_id FROM rpt.read_proposals p, input i WHERE i.kind = 'PROPOSAL' AND p.id = i.id
  UNION SELECT po.client_id FROM rpt.read_purchase_orders po, input i WHERE i.kind = 'PURCHASE_ORDER' AND po.id = i.id
  UNION SELECT d.client_id FROM rpt.read_billing_documents d, input i WHERE i.kind = 'BILLING_DOCUMENT' AND d.id = i.id
  UNION SELECT r.client_id FROM fin.receivables r, input i WHERE i.kind = 'RECEIVABLE' AND r.id = i.id
),
request_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'SERVICE_REQUEST'
  UNION SELECT so.service_request_id FROM so_set so WHERE so.service_request_id IS NOT NULL
  UNION SELECT sr.id FROM rpt.read_service_requests sr, input i WHERE i.kind = 'PROPOSAL' AND sr.proposal_id = i.id
  UNION SELECT sr.id FROM rpt.read_service_requests sr, input i WHERE i.kind = 'PURCHASE_ORDER' AND sr.purchase_order_id = i.id
),
proposal_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'PROPOSAL'
  UNION SELECT so.proposal_id FROM so_set so WHERE so.proposal_id IS NOT NULL
  UNION SELECT sr.proposal_id FROM rpt.read_service_requests sr, input i
        WHERE i.kind = 'SERVICE_REQUEST' AND sr.id = i.id AND sr.proposal_id IS NOT NULL
  UNION SELECT d.proposal_id FROM rpt.read_billing_documents d, input i
        WHERE i.kind = 'BILLING_DOCUMENT' AND d.id = i.id AND d.proposal_id IS NOT NULL
  UNION SELECT d.proposal_id FROM rpt.read_billing_documents d, input i
        WHERE i.kind = 'RECEIVABLE' AND d.id = (SELECT r.origin_billing_document_id FROM fin.receivables r WHERE r.id = i.id)
          AND d.proposal_id IS NOT NULL
),
purchase_order_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'PURCHASE_ORDER'
  UNION SELECT so.purchase_order_id FROM so_set so WHERE so.purchase_order_id IS NOT NULL
  UNION SELECT sr.purchase_order_id FROM rpt.read_service_requests sr, input i
        WHERE i.kind = 'SERVICE_REQUEST' AND sr.id = i.id AND sr.purchase_order_id IS NOT NULL
  UNION SELECT d.purchase_order_id FROM rpt.read_billing_documents d, input i
        WHERE i.kind = 'BILLING_DOCUMENT' AND d.id = i.id AND d.purchase_order_id IS NOT NULL
  UNION SELECT d.purchase_order_id FROM rpt.read_billing_documents d, input i
        WHERE i.kind = 'RECEIVABLE' AND d.id = (SELECT r.origin_billing_document_id FROM fin.receivables r WHERE r.id = i.id)
          AND d.purchase_order_id IS NOT NULL
),
measurement_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'MEASUREMENT'
  UNION SELECT m.id FROM rpt.read_measurements m WHERE m.service_order_id IN (SELECT id FROM so_set)
),
billing_record_ids AS (
  SELECT br.id FROM rpt.read_billing_records br WHERE br.measurement_id IN (SELECT id FROM measurement_ids)
  UNION SELECT r.origin_billing_record_id FROM fin.receivables r, input i WHERE i.kind = 'RECEIVABLE' AND r.id = i.id
),
billing_document_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'BILLING_DOCUMENT'
  UNION SELECT d.id FROM rpt.read_billing_documents d WHERE d.billing_record_id IN (SELECT id FROM billing_record_ids)
),
receivable_ids AS (
  SELECT i.id FROM input i WHERE i.kind = 'RECEIVABLE'
  UNION SELECT r.id FROM fin.receivables r WHERE r.origin_billing_document_id IN (SELECT id FROM billing_document_ids)
),
settlement_ids AS (
  SELECT s.id FROM fin.settlements s WHERE s.receivable_id IN (SELECT id FROM receivable_ids)
),
fiscal_document_ids AS (
  SELECT f.id FROM fis.fiscal_documents f
  WHERE f.billing_document_id IN (SELECT id FROM billing_document_ids)
     OR (f.source_kind IN ('BILLING_DOCUMENT', 'RECEIVABLE') AND f.source_id IN (
          SELECT id FROM billing_document_ids UNION SELECT id FROM receivable_ids
        ))
),
accounting_entry_ids AS (
  SELECT j.id FROM acc.journal_entries j
  WHERE (j.source_kind = 'BILLING' AND j.source_id IN (SELECT id FROM billing_document_ids))
     OR (j.source_kind = 'SETTLEMENT' AND j.source_id IN (SELECT id FROM settlement_ids))
)
SELECT 'CLIENT'::text AS kind, id FROM client_ids
UNION SELECT 'SERVICE_REQUEST', id FROM request_ids
UNION SELECT 'PROPOSAL', id FROM proposal_ids
UNION SELECT 'PURCHASE_ORDER', id FROM purchase_order_ids
UNION SELECT 'SERVICE_ORDER', id FROM so_set
UNION SELECT 'MEASUREMENT', id FROM measurement_ids
UNION SELECT 'BILLING_DOCUMENT', id FROM billing_document_ids
UNION SELECT 'RECEIVABLE', id FROM receivable_ids
UNION SELECT 'SETTLEMENT', id FROM settlement_ids
UNION SELECT 'FISCAL_DOCUMENT', id FROM fiscal_document_ids
UNION SELECT 'ACCOUNTING_ENTRY', id FROM accounting_entry_ids
`;

/**
 * Passo 2 — fatos dos nos, em LOTE.
 *
 * `business_reference` e SEMPRE uma referencia humana persistida. Quando o dominio nao possui
 * codigo proprio (medicao, liquidacao, recebivel, lancamento), a referencia e COMPOSTA de campos
 * persistidos do proprio registro e do pai real — nunca de um uuid e nunca de um codigo inventado.
 */
const NODE_FACTS_SQL = `
WITH ids AS (SELECT unnest($1::uuid[]) AS id)
SELECT 'CLIENT'::text AS kind, c.id AS entity_id,
       COALESCE(NULLIF(trim(c.trade_name), ''), c.legal_name) AS business_reference,
       c.status::text AS status, to_jsonb(c.created_at) #>> '{}' AS occurred_at,
       NULL::text AS unit_id, c.id AS client_id, NULL::uuid AS context_id,
       c.legal_name || ' · ' || c.normalized_tax_id AS summary
FROM rpt.read_clients c WHERE c.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'SERVICE_REQUEST', r.id, r.request_code, r.status::text, to_jsonb(r.created_at) #>> '{}',
       r.unit_id, r.client_id, NULL::uuid,
       COALESCE(NULLIF(trim(r.description), ''), 'Solicitação registrada') || ' · origem ' || r.origin_source::text
FROM rpt.read_service_requests r WHERE r.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'PROPOSAL', p.id, p.proposal_code,
       COALESCE(v.status::text, 'DRAFT'), to_jsonb(p.created_at) #>> '{}',
       p.unit_id, p.client_id, NULL::uuid,
       p.title || CASE WHEN p.current_version_number IS NULL THEN ' · sem versão emitida'
                       ELSE ' · revisão ' || p.current_version_number::text END
FROM rpt.read_proposals p
LEFT JOIN rpt.read_proposal_versions v
       ON v.proposal_id = p.id AND v.version_number = p.current_version_number
WHERE p.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'PURCHASE_ORDER', o.id, o.internal_code, o.status::text, to_jsonb(o.created_at) #>> '{}',
       o.unit_id, o.client_id, NULL::uuid,
       'PO do cliente ' || o.po_number ||
       CASE WHEN o.total_amount IS NULL THEN '' ELSE ' · ' || o.currency_code || ' ' || o.total_amount::text END
FROM rpt.read_purchase_orders o WHERE o.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'SERVICE_ORDER', s.id, s.order_number, s.status::text, to_jsonb(s.created_at) #>> '{}',
       s.unit_id, s.client_id, NULL::uuid,
       'Origem ' || s.origin::text || CASE WHEN s.rc_number IS NULL THEN '' ELSE ' · RC ' || s.rc_number END
FROM rpt.read_service_orders s WHERE s.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'MEASUREMENT', m.id, 'Medição de ' || so.order_number, m.status::text, to_jsonb(m.created_at) #>> '{}',
       m.unit_id, so.client_id, m.service_order_id,
       'Medição da OS ' || so.order_number
FROM rpt.read_measurements m
JOIN rpt.read_service_orders so ON so.id = m.service_order_id
WHERE m.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'BILLING_DOCUMENT', d.id, d.document_number, d.status::text, to_jsonb(d.issued_at) #>> '{}',
       d.unit_id, d.client_id, d.service_order_id,
       'Nota/Fatura interna · ' || d.currency_code || ' ' || d.total_amount::text ||
       CASE WHEN d.purchase_order_number_snapshot IS NULL THEN ''
            ELSE ' · PO ' || d.purchase_order_number_snapshot END
FROM rpt.read_billing_documents d WHERE d.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'RECEIVABLE', r.id,
       -- Referencia humana do titulo. A referencia persistida vale quando ela DISTINGUE o
       -- titulo do documento que o originou: dois nos da cadeia nao podem carregar o mesmo
       -- rotulo, porque "um clique abre um conjunto", nao um item ambiguo. Sem referencia
       -- externa propria, a referencia e composta do documento de origem REAL (document_number).
       CASE WHEN NULLIF(trim(r.external_reference), '') IS NULL
                 OR trim(r.external_reference) = d.document_number
            THEN 'Cobrança da ' || d.document_number
            ELSE trim(r.external_reference) END,
       CASE WHEN r.lifecycle = 'CANCELLED' THEN 'CANCELLED'
            WHEN COALESCE(sl.settled, 0) >= r.principal THEN 'SETTLED'
            WHEN COALESCE(sl.settled, 0) > 0 THEN 'PARTIALLY_SETTLED'
            WHEN r.due_date < CURRENT_DATE THEN 'OVERDUE'
            ELSE 'OPEN' END,
       to_jsonb(r.created_at) #>> '{}', r.unit_id, r.client_id, d.service_order_id,
       r.currency_code || ' ' || r.principal::text || ' · vencimento ' || r.due_date::text ||
       ' · saldo ' || (r.principal - COALESCE(sl.settled, 0))::text
FROM fin.receivables r
JOIN rpt.read_billing_documents d ON d.id = r.origin_billing_document_id
LEFT JOIN LATERAL (
  SELECT SUM(s.amount) AS settled FROM fin.settlements s
  WHERE s.receivable_id = r.id AND s.status = 'POSTED'
) sl ON TRUE
WHERE r.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'SETTLEMENT', s.id,
       CASE WHEN s.status = 'REVERSED' THEN 'Estorno da liquidação de ' || rc.document_number
            ELSE 'Liquidação de ' || rc.document_number END,
       s.status::text, to_jsonb(s.settled_at) #>> '{}', NULL::text, NULL::uuid, s.receivable_id,
       s.currency_code || ' ' || s.amount::text ||
       CASE WHEN s.status = 'REVERSED' THEN ' · estornada em ' || COALESCE(to_jsonb(s.reversed_at) #>> '{}', '')
            ELSE '' END
FROM fin.settlements s
JOIN (
  SELECT r.id, d.document_number FROM fin.receivables r
  JOIN rpt.read_billing_documents d ON d.id = r.origin_billing_document_id
) rc ON rc.id = s.receivable_id
WHERE s.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'FISCAL_DOCUMENT', f.id, f.description, f.status::text, f.issued_on::text,
       f.unit_id, NULL::uuid, NULL::uuid,
       'Documento fiscal oficial · origem ' || f.source_kind::text
FROM fis.fiscal_documents f WHERE f.id IN (SELECT id FROM ids)

UNION ALL
SELECT 'ACCOUNTING_ENTRY', j.id,
       CASE WHEN j.entry_number IS NULL THEN 'Lançamento ' || j.kind::text
            ELSE 'Lançamento ' || j.entry_number::text END,
       j.status::text, j.occurred_on::text, j.unit_id, NULL::uuid, NULL::uuid,
       j.description || ' · origem ' || j.source_kind::text || ' · ' || j.source_reference
FROM acc.journal_entries j WHERE j.id IN (SELECT id FROM ids)
`;

/** Rota autorizada de cada no. Todas existem no shell; nenhuma e inventada. */
export function businessChainRoute(
  kind: BusinessChainNodeKind,
  entityId: string,
  contextId: string | null,
): string {
  switch (kind) {
    case 'CLIENT':
      return `/app/clients/${entityId}`;
    case 'SERVICE_REQUEST':
      return `/app/requests/${entityId}`;
    case 'PROPOSAL':
      return `/app/proposals/${entityId}`;
    case 'PURCHASE_ORDER':
      return `/app/purchase-orders/${entityId}`;
    case 'SERVICE_ORDER':
      return `/app/service-orders/${entityId}/planning`;
    case 'MEASUREMENT':
      return `/app/service-orders/${contextId ?? entityId}/measurement`;
    case 'BILLING_DOCUMENT':
      return `/app/service-orders/${contextId ?? entityId}/billing/document`;
    case 'RECEIVABLE':
      return `/app/finance/receivables/${entityId}`;
    case 'SETTLEMENT':
      return `/app/finance/receivables/${contextId ?? entityId}`;
    case 'FISCAL_DOCUMENT':
      return `/app/fiscal/documents/${entityId}`;
    case 'ACCOUNTING_ENTRY':
      return `/app/accounting/journals/${entityId}`;
  }
}

@Injectable()
export class BusinessChainRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /** Passo 1: linhagem completa a partir do anchor, em uma unica instrucao. */
  async resolveSpine(kind: ChainAnchorKind, entityId: string): Promise<ChainSpineEntry[]> {
    const result = await this.pool().query<{ kind: BusinessChainNodeKind; id: string }>(
      SPINE_SQL,
      [kind, entityId],
    );
    return result.rows.map((row) => ({ kind: row.kind, entityId: row.id }));
  }

  /** Passo 2: fatos de todos os nos da linhagem, em LOTE. */
  async loadNodeFacts(entityIds: string[]): Promise<ChainNodeFactRow[]> {
    if (entityIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ChainNodeFactRow>(NODE_FACTS_SQL, [entityIds]);
    return result.rows;
  }
}
