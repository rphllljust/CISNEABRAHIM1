import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import { orderByCreatedAtDesc } from '../../infrastructure/database/sql';
import {
  PROPOSAL_VERSION_STATUSES,
  assertTransition,
  canCreateRevision,
  canEditDraft,
  isProposalVersionStatus,
  type ProposalVersionStatus,
} from '../domain/proposal';
import type {
  ClientSnapshotSource,
  CreateProposalPersistenceInput,
  ProposalClientLabelRow,
  ProposalDocumentLinkRow,
  ProposalItemRow,
  ProposalLinkedRow,
  ProposalListVersionRow,
  ProposalRow,
  ProposalVersionRow,
  ProposalWorkbenchRow,
  ServiceSnapshotSource,
  UpdateProposalDraftPersistenceInput,
} from './proposals.repository.types';
import { PROPOSAL_WORKBENCH_SELECT } from './proposal-list-sql';
import {
  copyProposalItemsFromVersion,
  replaceProposalItems,
} from './proposals-version-child-rows';

const PROPOSAL_SELECT = `
  SELECT
    id,
    proposal_code,
    client_id,
    unit_id,
    title,
    current_version_number,
    row_version,
    created_at,
    updated_at
  FROM com.proposals
`;

const VERSION_SELECT = `
  SELECT
    id,
    proposal_id,
    version_number,
    status::text AS status,
    pricing_structure::text AS pricing_structure,
    currency_code,
    global_sale_price_amount::text AS global_sale_price_amount,
    global_internal_cost_amount::text AS global_internal_cost_amount,
    items_sale_total_amount::text AS items_sale_total_amount,
    items_internal_cost_total_amount::text AS items_internal_cost_total_amount,
    commercial_terms,
    client_snapshot,
    valid_until,
    notes,
    issued_at,
    issued_by_identity_id,
    superseded_at,
    accepted_at,
    accepted_by_identity_id,
    acceptance_origin_code,
    acceptance_evidence_document_id,
    rejected_at,
    rejected_by_identity_id,
    rejection_reason,
    expired_at,
    cancelled_at,
    cancelled_by_identity_id,
    cancellation_reason,
    row_version,
    created_at,
    updated_at
  FROM com.proposal_versions
`;

@Injectable()
export class ProposalsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async isUnitRegistered(unitId: string): Promise<boolean> {
    return queryIsUnitRegistered(this.pool(), unitId);
  }

  async findClientById(clientId: string): Promise<ClientSnapshotSource | null> {
    const result = await this.pool().query<ClientSnapshotSource>(
      `SELECT id, legal_name, trade_name, normalized_tax_id, status::text AS status
       FROM pty.clients WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async findDocumentById(documentId: string): Promise<{ id: string; unit_id: string } | null> {
    const result = await this.pool().query<{ id: string; unit_id: string }>(
      `SELECT id, unit_id FROM rpt.read_documents WHERE id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async findServiceSnapshot(
    serviceDefinitionId: string,
    serviceDefinitionVersionId?: string,
  ): Promise<ServiceSnapshotSource | null> {
    const result = await this.pool().query<ServiceSnapshotSource>(
      `SELECT
         sd.id AS service_definition_id,
         sdv.id AS service_definition_version_id,
         sd.code,
         sdv.name,
         sdv.version,
         sdv.status::text AS version_status
       FROM rpt.read_service_definitions sd
       INNER JOIN rpt.read_service_definition_versions sdv ON sdv.service_definition_id = sd.id
       WHERE sd.id = $1
         AND ($2::uuid IS NULL OR sdv.id = $2::uuid)
       ORDER BY sdv.version DESC
       LIMIT 1`,
      [serviceDefinitionId, serviceDefinitionVersionId ?? null],
    );
    return result.rows[0] ?? null;
  }

  async findProposalById(proposalId: string): Promise<ProposalRow | null> {
    const result = await this.pool().query<ProposalRow>(
      `${PROPOSAL_SELECT} WHERE id = $1`,
      [proposalId],
    );
    return result.rows[0] ?? null;
  }

  async findVersion(
    proposalId: string,
    versionNumber: number,
  ): Promise<ProposalVersionRow | null> {
    const result = await this.pool().query<ProposalVersionRow>(
      `${VERSION_SELECT} WHERE proposal_id = $1 AND version_number = $2`,
      [proposalId, versionNumber],
    );
    return result.rows[0] ?? null;
  }

  async listProposals(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<ProposalRow[]> {
    const result = await this.pool().query<ProposalRow>(
      `${PROPOSAL_SELECT}
       WHERE ${whereClause}
       ORDER BY ${orderByCreatedAtDesc()}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  /**
   * Versao corrente de VARIAS propostas em UMA consulta.
   *
   * Enriquecimento de leitura da listagem: `current_version_number` e os campos da versao
   * (status, valid_until, totais, moeda) ja existem em `com.proposal_versions`. A busca e feita
   * por pagina — `WHERE proposal_id = ANY(...)` — e nao uma consulta por linha (sem N+1).
   * Nao altera `listProposals` nem qualquer query ja em uso.
   */
  async findCurrentVersionsForProposals(proposalIds: string[]): Promise<ProposalListVersionRow[]> {
    if (proposalIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalListVersionRow>(
      `SELECT
         v.proposal_id,
         v.status::text AS status,
         v.currency_code,
         v.pricing_structure::text AS pricing_structure,
         v.global_sale_price_amount::text AS global_sale_price_amount,
         v.items_sale_total_amount::text AS items_sale_total_amount,
         v.valid_until
       FROM com.proposal_versions v
       INNER JOIN com.proposals p
         ON p.id = v.proposal_id
        AND p.current_version_number = v.version_number
       WHERE v.proposal_id = ANY($1::uuid[])`,
      [proposalIds],
    );
    return result.rows;
  }

  async listVersions(proposalId: string): Promise<ProposalVersionRow[]> {
    const result = await this.pool().query<ProposalVersionRow>(
      `${VERSION_SELECT}
       WHERE proposal_id = $1
       ORDER BY version_number DESC`,
      [proposalId],
    );
    return result.rows;
  }

  /**
   * Fila comercial: proposta + versao corrente + contagem de revisoes em UMA consulta.
   *
   * Substitui a listagem simples apenas para a superficie de trabalho; `listProposals` continua
   * existindo e intacta para quem ja a usa. A ordenacao vem por allowlist (ver `proposal-list-sql`).
   */
  async listProposalsForWorkbench(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
    orderClause: string,
  ): Promise<ProposalWorkbenchRow[]> {
    const result = await this.pool().query<ProposalWorkbenchRow>(
      `${PROPOSAL_WORKBENCH_SELECT}
       WHERE ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  /** Nomes de cliente da pagina em UMA consulta, apenas para os ids ja autorizados. */
  async listClientLabels(clientIds: string[]): Promise<ProposalClientLabelRow[]> {
    if (clientIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalClientLabelRow>(
      `SELECT id, legal_name, trade_name
       FROM rpt.read_clients
       WHERE id = ANY($1::uuid[])`,
      [clientIds],
    );
    return result.rows;
  }

  /** Rotulos de servico da pagina em UMA consulta (nome da versao + codigo da definicao). */
  async listServiceLabels(
    items: Array<{ serviceDefinitionId: string; serviceDefinitionVersionId: string | null }>,
  ): Promise<Map<string, string>> {
    const definitionIds = [...new Set(items.map((item) => item.serviceDefinitionId))];
    const versionIds = [
      ...new Set(
        items
          .map((item) => item.serviceDefinitionVersionId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const labels = new Map<string, string>();
    if (definitionIds.length === 0) {
      return labels;
    }
    const [versions, definitions] = await Promise.all([
      versionIds.length === 0
        ? Promise.resolve({ rows: [] as Array<{ id: string; name: string }> })
        : this.pool().query<{ id: string; name: string }>(
            `SELECT id, name FROM rpt.read_service_definition_versions WHERE id = ANY($1::uuid[])`,
            [versionIds],
          ),
      this.pool().query<{ id: string; code: string }>(
        `SELECT id, code FROM rpt.read_service_definitions WHERE id = ANY($1::uuid[])`,
        [definitionIds],
      ),
    ]);
    const nameByVersion = new Map(versions.rows.map((row) => [row.id, row.name]));
    const codeById = new Map(definitions.rows.map((row) => [row.id, row.code]));
    for (const item of items) {
      const label =
        (item.serviceDefinitionVersionId
          ? nameByVersion.get(item.serviceDefinitionVersionId)
          : undefined) ?? codeById.get(item.serviceDefinitionId);
      if (label) {
        labels.set(item.serviceDefinitionId, label);
      }
    }
    return labels;
  }

  /** Solicitacoes que referenciam a proposta (origem comercial real). */
  async listOriginRequests(proposalIds: string[]): Promise<ProposalLinkedRow[]> {
    if (proposalIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalLinkedRow>(
      `SELECT 'REQUEST'::text AS kind, sr.id, sr.request_code::text AS label,
              sr.status::text AS status, sr.created_at AS occurred_at,
              sr.unit_id, sr.client_id, NULL::text AS via_label, sr.proposal_id
       FROM rpt.read_service_requests sr
       WHERE sr.proposal_id = ANY($1::uuid[])
       ORDER BY sr.created_at ASC, sr.id ASC`,
      [proposalIds],
    );
    return result.rows;
  }

  /**
   * Destinos comerciais da proposta. UMA consulta.
   *
   * Ordem de servico referencia a proposta direto (`so.proposal_id`). Pedido de compra NAO tem
   * vinculo com proposta no modelo: ele aparece quando a OS gerada o referencia
   * (`so.purchase_order_id`) e por isso carrega `via_label` com o numero da OS — a relacao e
   * declarada como indireta, nunca apresentada como vinculo direto inexistente.
   */
  async findLinkedChain(proposalId: string): Promise<ProposalLinkedRow[]> {
    const result = await this.pool().query<ProposalLinkedRow>(
      `SELECT kind, id, label, status, occurred_at, unit_id, client_id, via_label, proposal_id
       FROM (
         SELECT 'REQUEST'::text AS kind, sr.id, sr.request_code::text AS label,
                sr.status::text AS status, sr.created_at AS occurred_at,
                sr.unit_id, sr.client_id, NULL::text AS via_label, sr.proposal_id
         FROM rpt.read_service_requests sr
         WHERE sr.proposal_id = $1::uuid
         UNION ALL
         SELECT 'SERVICE_ORDER'::text AS kind, so.id, so.order_number::text AS label,
                so.status::text AS status, so.created_at AS occurred_at,
                so.unit_id, so.client_id, NULL::text AS via_label, NULL::uuid AS proposal_id
         FROM rpt.read_service_orders so
         WHERE so.proposal_id = $1::uuid
         UNION ALL
         SELECT 'PURCHASE_ORDER'::text, po.id, po.internal_code::text,
                po.status::text, po.created_at, po.unit_id, po.client_id,
                so.order_number::text AS via_label, NULL::uuid AS proposal_id
         FROM rpt.read_service_orders so
         INNER JOIN rpt.read_purchase_orders po ON po.id = so.purchase_order_id
         WHERE so.proposal_id = $1::uuid
       ) chain
       ORDER BY occurred_at ASC, id ASC`,
      [proposalId],
    );
    return result.rows;
  }

  /**
   * Itens de VARIAS versoes da mesma proposta em UMA consulta — insumo do diff entre revisoes.
   */
  async listItemsForVersionNumbers(
    proposalId: string,
    versionNumbers: number[],
  ): Promise<Array<ProposalItemRow & { version_number: number }>> {
    if (versionNumbers.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalItemRow & { version_number: number }>(
      `SELECT i.id, i.proposal_version_id, i.line_number, i.item_kind::text AS item_kind,
              i.description, i.service_definition_id, i.service_definition_version_id,
              i.service_snapshot, i.commercial_snapshot,
              i.quantity::text AS quantity, i.unit_code,
              i.unit_sale_price_amount::text AS unit_sale_price_amount,
              i.unit_internal_cost_amount::text AS unit_internal_cost_amount,
              i.line_sale_amount::text AS line_sale_amount,
              i.line_internal_cost_amount::text AS line_internal_cost_amount,
              v.version_number
       FROM com.proposal_items i
       INNER JOIN com.proposal_versions v ON v.id = i.proposal_version_id
       WHERE v.proposal_id = $1 AND v.version_number = ANY($2::int[])
       ORDER BY v.version_number ASC, i.line_number ASC`,
      [proposalId, versionNumbers],
    );
    return result.rows;
  }

  async listItems(proposalVersionId: string): Promise<ProposalItemRow[]> {
    return this.listItemsForVersions([proposalVersionId]);
  }

  async listDocumentLinks(proposalVersionId: string): Promise<ProposalDocumentLinkRow[]> {
    return this.listDocumentLinksForVersions([proposalVersionId]);
  }

  async listItemsForVersions(proposalVersionIds: string[]): Promise<ProposalItemRow[]> {
    if (proposalVersionIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalItemRow>(
      `SELECT
         id,
         proposal_version_id,
         line_number,
         item_kind::text AS item_kind,
         description,
         service_definition_id,
         service_definition_version_id,
         service_snapshot,
         commercial_snapshot,
         quantity::text AS quantity,
         unit_code,
         unit_sale_price_amount::text AS unit_sale_price_amount,
         unit_internal_cost_amount::text AS unit_internal_cost_amount,
         line_sale_amount::text AS line_sale_amount,
         line_internal_cost_amount::text AS line_internal_cost_amount
       FROM com.proposal_items
       WHERE proposal_version_id = ANY($1::uuid[])
       ORDER BY proposal_version_id, line_number ASC`,
      [proposalVersionIds],
    );
    return result.rows;
  }

  async listDocumentLinksForVersions(
    proposalVersionIds: string[],
  ): Promise<ProposalDocumentLinkRow[]> {
    if (proposalVersionIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<ProposalDocumentLinkRow>(
      `SELECT id, proposal_version_id, document_id, link_purpose, created_at
       FROM com.proposal_document_links
       WHERE proposal_version_id = ANY($1::uuid[])
       ORDER BY proposal_version_id, created_at ASC, id ASC`,
      [proposalVersionIds],
    );
    return result.rows;
  }

  async hasDraftVersion(proposalId: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM com.proposal_versions
         WHERE proposal_id = $1 AND status = 'DRAFT'
       ) AS exists`,
      [proposalId],
    );
    return result.rows[0]?.exists === true;
  }

  async createProposal(input: CreateProposalPersistenceInput): Promise<{
    proposal: ProposalRow;
    version: ProposalVersionRow;
    items: ProposalItemRow[];
  }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const proposalResult = await client.query<ProposalRow>(
        `INSERT INTO com.proposals (
           proposal_code, client_id, unit_id, title, current_version_number,
           created_by_identity_id, updated_by_identity_id
         )
         VALUES ($1, $2, $3, $4, 1, $5, $5)
         RETURNING
           id, proposal_code, client_id, unit_id, title, current_version_number,
           row_version, created_at, updated_at`,
        [
          input.proposalCode,
          input.clientId,
          input.unitId,
          input.title,
          input.actorIdentityId,
        ],
      );
      const proposal = proposalResult.rows[0];
      if (!proposal) {
        throw new Error('PROPOSAL_CREATE_FAILED');
      }

      const versionResult = await client.query<{ id: string }>(
        `INSERT INTO com.proposal_versions (
           proposal_id, version_number, pricing_structure, currency_code,
           global_sale_price_amount, global_internal_cost_amount,
           commercial_terms, valid_until, notes
         )
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
         RETURNING id`,
        [
          proposal.id,
          input.pricingStructure,
          input.currencyCode,
          input.globalSalePrice,
          input.globalInternalCost,
          JSON.stringify(input.commercialTerms ?? {}),
          input.validUntil ?? null,
          input.notes ?? null,
        ],
      );
      const versionId = versionResult.rows[0]?.id;
      if (!versionId) {
        throw new Error('PROPOSAL_VERSION_CREATE_FAILED');
      }

      await replaceProposalItems(client, versionId, input.items);
      await client.query('COMMIT');

      const version = await this.findVersion(proposal.id, 1);
      if (!version) {
        throw new Error('PROPOSAL_VERSION_LOAD_FAILED');
      }
      const loadedItems = await this.listItems(versionId);
      return { proposal, version, items: loadedItems };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraft(input: UpdateProposalDraftPersistenceInput): Promise<
    | { proposal: ProposalRow; version: ProposalVersionRow; items: ProposalItemRow[] }
    | 'VERSION_CONFLICT'
    | 'INVALID_STATE'
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const versionLock = await client.query<ProposalVersionRow>(
        `${VERSION_SELECT}
         WHERE proposal_id = $1 AND version_number = $2
         FOR UPDATE`,
        [input.proposalId, input.versionNumber],
      );
      const current = versionLock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (!canEditDraft(current.status as ProposalVersionStatus)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      if (input.title) {
        await client.query(
          `UPDATE com.proposals
           SET title = $2, updated_by_identity_id = $3, updated_at = NOW(), row_version = row_version + 1
           WHERE id = $1`,
          [input.proposalId, input.title, input.actorIdentityId],
        );
      }

      await client.query(
        `UPDATE com.proposal_versions
         SET
           pricing_structure = COALESCE($3::com.proposal_pricing_structure, pricing_structure),
           currency_code = COALESCE($4, currency_code),
           global_sale_price_amount = COALESCE($5::numeric, global_sale_price_amount),
           global_internal_cost_amount = COALESCE($6::numeric, global_internal_cost_amount),
           commercial_terms = COALESCE($7::jsonb, commercial_terms),
           valid_until = CASE WHEN $8::text = '__UNSET__' THEN valid_until WHEN $8 IS NULL THEN NULL ELSE $8::timestamptz END,
           notes = CASE WHEN $9::text = '__UNSET__' THEN notes ELSE $9 END,
           row_version = row_version + 1,
           updated_at = NOW()
         WHERE id = $1 AND row_version = $2`,
        [
          current.id,
          input.rowVersion,
          input.pricingStructure ?? null,
          input.currencyCode ?? null,
          input.globalSalePrice ?? null,
          input.globalInternalCost ?? null,
          input.commercialTerms ? JSON.stringify(input.commercialTerms) : null,
          input.validUntil === undefined ? '__UNSET__' : input.validUntil,
          input.notes === undefined ? '__UNSET__' : input.notes,
        ],
      );

      let items: ProposalItemRow[] = [];
      if (input.items) {
        await replaceProposalItems(client, current.id, input.items);
        items = await this.listItems(current.id);
      } else {
        items = await this.listItems(current.id);
      }

      await client.query('COMMIT');

      const proposal = await this.findProposalById(input.proposalId);
      const version = await this.findVersion(input.proposalId, input.versionNumber);
      if (!proposal || !version) {
        throw new Error('PROPOSAL_LOAD_FAILED');
      }
      return { proposal, version, items };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createRevision(
    proposalId: string,
    actorIdentityId: string,
  ): Promise<
    | { proposal: ProposalRow; version: ProposalVersionRow; items: ProposalItemRow[] }
    | 'DRAFT_EXISTS'
    | 'REVISION_NOT_ALLOWED'
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const proposal = await client.query<ProposalRow>(
        `${PROPOSAL_SELECT} WHERE id = $1 FOR UPDATE`,
        [proposalId],
      );
      const proposalRow = proposal.rows[0];
      if (!proposalRow?.current_version_number) {
        await client.query('ROLLBACK');
        return 'REVISION_NOT_ALLOWED';
      }

      const draftExists = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM com.proposal_versions
           WHERE proposal_id = $1 AND status = 'DRAFT'
         ) AS exists`,
        [proposalId],
      );
      if (draftExists.rows[0]?.exists) {
        await client.query('ROLLBACK');
        return 'DRAFT_EXISTS';
      }

      const currentVersion = await client.query<ProposalVersionRow>(
        `${VERSION_SELECT}
         WHERE proposal_id = $1 AND version_number = $2`,
        [proposalId, proposalRow.current_version_number],
      );
      const source = currentVersion.rows[0];
      if (!source || !canCreateRevision(source.status as ProposalVersionStatus)) {
        await client.query('ROLLBACK');
        return 'REVISION_NOT_ALLOWED';
      }

      const nextVersion = source.version_number + 1;
      const versionResult = await client.query<{ id: string }>(
        `INSERT INTO com.proposal_versions (
           proposal_id, version_number, pricing_structure, currency_code,
           global_sale_price_amount, global_internal_cost_amount,
           commercial_terms, valid_until, notes
         )
         VALUES ($1, $2, $3::com.proposal_pricing_structure, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          proposalId,
          nextVersion,
          source.pricing_structure,
          source.currency_code,
          source.global_sale_price_amount,
          source.global_internal_cost_amount,
          JSON.stringify(source.commercial_terms ?? {}),
          source.valid_until,
          source.notes,
        ],
      );
      const newVersionId = versionResult.rows[0]?.id;
      if (!newVersionId) {
        throw new Error('REVISION_CREATE_FAILED');
      }

      const sourceItems = await this.listItems(source.id);
      await copyProposalItemsFromVersion(client, newVersionId, sourceItems);

      await client.query(
        `UPDATE com.proposals
         SET current_version_number = $2, updated_by_identity_id = $3, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1`,
        [proposalId, nextVersion, actorIdentityId],
      );

      await client.query('COMMIT');

      const updatedProposal = await this.findProposalById(proposalId);
      const version = await this.findVersion(proposalId, nextVersion);
      if (!updatedProposal || !version) {
        throw new Error('REVISION_LOAD_FAILED');
      }
      const items = await this.listItems(version.id);
      return { proposal: updatedProposal, version, items };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async issueVersion(
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
    actorIdentityId: string,
    clientSnapshot: Record<string, unknown>,
    itemSnapshots: Array<{
      itemId: string;
      serviceSnapshot: Record<string, unknown> | null;
      commercialSnapshot: Record<string, unknown>;
    }>,
    versionTotals: {
      itemsSaleTotal: string | null;
      itemsInternalCostTotal: string | null;
    },
  ): Promise<ProposalVersionRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const locked = await client.query<ProposalVersionRow>(
        `${VERSION_SELECT}
         WHERE proposal_id = $1 AND version_number = $2
         FOR UPDATE`,
        [proposalId, versionNumber],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.status !== PROPOSAL_VERSION_STATUSES.Draft || current.row_version !== rowVersion) {
        await client.query('ROLLBACK');
        return current.status !== PROPOSAL_VERSION_STATUSES.Draft ? 'INVALID_STATE' : 'VERSION_CONFLICT';
      }
      if (!isProposalVersionStatus(current.status)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      try {
        assertTransition(current.status, PROPOSAL_VERSION_STATUSES.Issued);
      } catch {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      await client.query(
        `UPDATE com.proposal_versions
         SET superseded_at = NOW()
         WHERE proposal_id = $1
           AND status = 'ISSUED'
           AND version_number <> $2
           AND superseded_at IS NULL`,
        [proposalId, versionNumber],
      );

      for (const snapshot of itemSnapshots) {
        await client.query(
          `UPDATE com.proposal_items
           SET
             service_snapshot = COALESCE($2::jsonb, service_snapshot),
             commercial_snapshot = $3::jsonb
           WHERE id = $1`,
          [
            snapshot.itemId,
            snapshot.serviceSnapshot ? JSON.stringify(snapshot.serviceSnapshot) : null,
            JSON.stringify(snapshot.commercialSnapshot),
          ],
        );
      }

      const updated = await client.query<ProposalVersionRow>(
        `UPDATE com.proposal_versions
         SET
           status = 'ISSUED',
           client_snapshot = $3::jsonb,
           items_sale_total_amount = $5::numeric,
           items_internal_cost_total_amount = $6::numeric,
           issued_at = NOW(),
           issued_by_identity_id = $4,
           row_version = row_version + 1,
           updated_at = NOW()
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, proposal_id, version_number, status::text AS status,
           pricing_structure::text AS pricing_structure, currency_code,
           global_sale_price_amount::text AS global_sale_price_amount,
           global_internal_cost_amount::text AS global_internal_cost_amount,
           items_sale_total_amount::text AS items_sale_total_amount,
           items_internal_cost_total_amount::text AS items_internal_cost_total_amount,
           commercial_terms, client_snapshot, valid_until, notes,
           issued_at, issued_by_identity_id, superseded_at,
           accepted_at, accepted_by_identity_id, acceptance_origin_code,
           acceptance_evidence_document_id, rejected_at, rejected_by_identity_id,
           rejection_reason, expired_at, cancelled_at, cancelled_by_identity_id,
           cancellation_reason, row_version, created_at, updated_at`,
        [
          current.id,
          rowVersion,
          JSON.stringify(clientSnapshot),
          actorIdentityId,
          versionTotals.itemsSaleTotal,
          versionTotals.itemsInternalCostTotal,
        ],
      );

      await client.query(
        `UPDATE com.proposals
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1`,
        [proposalId, actorIdentityId],
      );

      await client.query('COMMIT');
      return updated.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelVersion(
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
    actorIdentityId: string,
    cancellationReason: string | null,
  ): Promise<ProposalVersionRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ProposalVersionRow>(
        `${VERSION_SELECT}
         WHERE proposal_id = $1 AND version_number = $2
         FOR UPDATE`,
        [proposalId, versionNumber],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (!isProposalVersionStatus(current.status)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      try {
        assertTransition(current.status, PROPOSAL_VERSION_STATUSES.Cancelled);
      } catch {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const updated = await client.query<ProposalVersionRow>(
        `UPDATE com.proposal_versions
         SET
           status = 'CANCELLED',
           cancelled_at = NOW(),
           cancelled_by_identity_id = $3,
           cancellation_reason = $4,
           row_version = row_version + 1,
           updated_at = NOW()
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, proposal_id, version_number, status::text AS status,
           pricing_structure::text AS pricing_structure, currency_code,
           global_sale_price_amount::text AS global_sale_price_amount,
           global_internal_cost_amount::text AS global_internal_cost_amount,
           items_sale_total_amount::text AS items_sale_total_amount,
           items_internal_cost_total_amount::text AS items_internal_cost_total_amount,
           commercial_terms, client_snapshot, valid_until, notes,
           issued_at, issued_by_identity_id, superseded_at,
           accepted_at, accepted_by_identity_id, acceptance_origin_code,
           acceptance_evidence_document_id, rejected_at, rejected_by_identity_id,
           rejection_reason, expired_at, cancelled_at, cancelled_by_identity_id,
           cancellation_reason, row_version, created_at, updated_at`,
        [current.id, rowVersion, actorIdentityId, cancellationReason],
      );

      await client.query(
        `UPDATE com.proposals
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1`,
        [proposalId, actorIdentityId],
      );

      await client.query('COMMIT');
      return updated.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionVersion(
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
    targetStatus: string,
    actorIdentityId: string,
    fields: Record<string, unknown>,
  ): Promise<ProposalVersionRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ProposalVersionRow>(
        `${VERSION_SELECT}
         WHERE proposal_id = $1 AND version_number = $2
         FOR UPDATE`,
        [proposalId, versionNumber],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (!isProposalVersionStatus(current.status) || !isProposalVersionStatus(targetStatus)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      try {
        assertTransition(current.status, targetStatus);
      } catch {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const updated = await client.query<ProposalVersionRow>(
        `UPDATE com.proposal_versions
         SET
           status = $3::com.proposal_version_status,
           accepted_at = COALESCE($4::timestamptz, accepted_at),
           accepted_by_identity_id = COALESCE($5::uuid, accepted_by_identity_id),
           acceptance_origin_code = COALESCE($6, acceptance_origin_code),
           acceptance_evidence_document_id = COALESCE($7::uuid, acceptance_evidence_document_id),
           rejected_at = COALESCE($8::timestamptz, rejected_at),
           rejected_by_identity_id = COALESCE($9::uuid, rejected_by_identity_id),
           rejection_reason = COALESCE($10, rejection_reason),
           expired_at = COALESCE($11::timestamptz, expired_at),
           cancelled_at = COALESCE($12::timestamptz, cancelled_at),
           cancelled_by_identity_id = COALESCE($13::uuid, cancelled_by_identity_id),
           cancellation_reason = COALESCE($14, cancellation_reason),
           row_version = row_version + 1,
           updated_at = NOW()
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, proposal_id, version_number, status::text AS status,
           pricing_structure::text AS pricing_structure, currency_code,
           global_sale_price_amount::text AS global_sale_price_amount,
           global_internal_cost_amount::text AS global_internal_cost_amount,
           items_sale_total_amount::text AS items_sale_total_amount,
           items_internal_cost_total_amount::text AS items_internal_cost_total_amount,
           commercial_terms, client_snapshot, valid_until, notes,
           issued_at, issued_by_identity_id, superseded_at,
           accepted_at, accepted_by_identity_id, acceptance_origin_code,
           acceptance_evidence_document_id, rejected_at, rejected_by_identity_id,
           rejection_reason, expired_at, cancelled_at, cancelled_by_identity_id,
           cancellation_reason, row_version, created_at, updated_at`,
        [
          current.id,
          rowVersion,
          targetStatus,
          fields['acceptedAt'] ?? null,
          fields['acceptedByIdentityId'] ?? null,
          fields['acceptanceOriginCode'] ?? null,
          fields['acceptanceEvidenceDocumentId'] ?? null,
          fields['rejectedAt'] ?? null,
          fields['rejectedByIdentityId'] ?? null,
          fields['rejectionReason'] ?? null,
          fields['expiredAt'] ?? null,
          fields['cancelledAt'] ?? null,
          fields['cancelledByIdentityId'] ?? null,
          fields['cancellationReason'] ?? null,
        ],
      );

      await client.query(
        `UPDATE com.proposals
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1`,
        [proposalId, actorIdentityId],
      );

      await client.query('COMMIT');
      return updated.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async linkDocument(
    proposalVersionId: string,
    documentId: string,
    linkPurpose: string,
    actorIdentityId: string,
  ): Promise<ProposalDocumentLinkRow> {
    const result = await this.pool().query<ProposalDocumentLinkRow>(
      `INSERT INTO com.proposal_document_links (
         proposal_version_id, document_id, link_purpose, created_by_identity_id
       )
       VALUES ($1, $2, $3, $4)
       RETURNING id, proposal_version_id, document_id, link_purpose, created_at`,
      [proposalVersionId, documentId, linkPurpose, actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DOCUMENT_LINK_FAILED');
    }
    return row;
  }
}
