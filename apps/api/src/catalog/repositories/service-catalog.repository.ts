import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { LineageStatus } from '../domain/service-catalog-status';
import { normalizePricingModelInput } from '../../commercial/domain/commercial-compatibility';
import type { NormalizedExecutionRequirementInput } from '../domain/service-catalog.validation';
import {
  replaceServiceCatalogAllowedUnits,
  replaceServiceCatalogExecutionRequirements,
  replaceServiceCatalogLaborRequirements,
  replaceServiceCatalogPricingModels,
  replaceServiceCatalogResourceRequirements,
} from './service-catalog-version-child-rows';
import type {
  CreateDefinitionWithDraftInput,
  CreateDraftVersionInput,
  UpdateDraftVersionInput,
} from './service-catalog.repository.types';

export type {
  CreateDefinitionWithDraftInput,
  CreateDraftVersionInput,
  UpdateDraftVersionInput,
} from './service-catalog.repository.types';
import { commercialCodeFromPersisted, isCommercialPricingModelCode } from '../../commercial/domain/pricing-model';
import type {
  AllowedUnitRow,
  LaborRequirementRow,
  ExecutionRequirementRow,
  PricingModelRow,
  ResourceRequirementRow,
  ServiceDefinitionRow,
  ServiceDefinitionSummary,
  ServiceDefinitionVersionDetail,
  ServiceDefinitionVersionRow,
} from '../serializers/service-catalog-response.serializer';

@Injectable()
export class ServiceCatalogRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findDefinitionSummary(definitionId: string): Promise<ServiceDefinitionSummary | null> {
    const result = await this.pool().query<ServiceDefinitionSummary>(
      `SELECT d.id,
              d.code,
              d.status,
              d.version,
              d.created_at,
              d.updated_at,
              d.deactivated_at,
              d.deactivation_reason,
              (
                SELECT MAX(v.version)
                FROM cat.service_definition_versions v
                WHERE v.service_definition_id = d.id
                  AND v.status = 'ACTIVE'
              ) AS latest_published_version,
              (
                SELECT MAX(v.version)
                FROM cat.service_definition_versions v
                WHERE v.service_definition_id = d.id
                  AND v.status = 'DRAFT'
              ) AS current_draft_version,
              version.name         AS name,
              version.status::text AS name_version_status,
              version.version      AS name_version,
              category.id          AS category_id,
              category.code        AS category_code,
              category.name        AS category_name
       FROM cat.service_definitions d
       LEFT JOIN LATERAL (
         SELECT v.id, v.name, v.status, v.version, v.category_id
         FROM cat.service_definition_versions v
         WHERE v.service_definition_id = d.id
           AND v.status IN ('ACTIVE', 'DRAFT')
         ORDER BY (v.status = 'ACTIVE') DESC, v.version DESC
         LIMIT 1
       ) AS version ON TRUE
       LEFT JOIN cat.service_categories category ON category.id = version.category_id
       WHERE d.id = $1`,
      [definitionId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * LISTA DE DEFINICOES — projecao com o nome humano da versao vigente.
   *
   * `name`/`category` sao atributos da VERSAO, nao da definicao. A regra da versao vigente e a
   * mesma que a listagem ja usa para decidir o que esta publicado:
   *
   * 1. entre as versoes ACTIVE (publicadas), a de MAIOR numero;
   * 2. se nao houver ACTIVE (nunca publicada ou apenas retirada) e existir DRAFT, o DRAFT de MAIOR
   *    numero — e o unico texto humano que existe naquele momento;
   * 3. sem ACTIVE e sem DRAFT nao ha nome: `name` e `null`, e a lista cai no `code`. Um nome de
   *    versao RETIRED seria texto de uma versao que ja nao vigora — pior que a ausencia.
   *
   * Uma CTE com `LEFT JOIN LATERAL` resolve a versao vigente para a PAGINA INTEIRA (uma consulta,
   * sem N+1). `MAX(v.version)` no subselect existente foi mantido: ele alimenta
   * `latest_published_version`/`current_draft_version` e ambos continuam com o mesmo significado.
   */
  async listDefinitions(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<ServiceDefinitionSummary[]> {
    const result = await this.pool().query<ServiceDefinitionSummary>(
      `WITH page AS (
        SELECT d.id,
               d.code,
               d.status,
               d.version,
               d.created_at,
               d.updated_at,
               d.deactivated_at,
               d.deactivation_reason,
               (
                 SELECT MAX(v.version)
                 FROM cat.service_definition_versions v
                 WHERE v.service_definition_id = d.id
                   AND v.status = 'ACTIVE'
               ) AS latest_published_version,
               (
                 SELECT MAX(v.version)
                 FROM cat.service_definition_versions v
                 WHERE v.service_definition_id = d.id
                   AND v.status = 'DRAFT'
               ) AS current_draft_version
        FROM cat.service_definitions d
        WHERE ${whereClause}
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      )
      SELECT page.*,
             version.name           AS name,
             version.status::text   AS name_version_status,
             version.version        AS name_version,
             category.id            AS category_id,
             category.code          AS category_code,
             category.name          AS category_name
      FROM page
      LEFT JOIN LATERAL (
        SELECT v.id, v.name, v.status, v.version, v.category_id
        FROM cat.service_definition_versions v
        WHERE v.service_definition_id = page.id
          AND v.status IN ('ACTIVE', 'DRAFT')
        ORDER BY (v.status = 'ACTIVE') DESC, v.version DESC
        LIMIT 1
      ) AS version ON TRUE
      LEFT JOIN cat.service_categories category ON category.id = version.category_id
      ORDER BY page.created_at ASC, page.id ASC`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async findVersionDetail(
    definitionId: string,
    versionNumber: number,
  ): Promise<ServiceDefinitionVersionDetail | null> {
    const version = await this.pool().query<ServiceDefinitionVersionRow & { code: string }>(
      `SELECT v.id,
              v.service_definition_id,
              v.version,
              v.status,
              v.category_id,
              v.archetype,
              v.name,
              v.description,
              v.default_unit_code,
              v.measurement_mode,
              v.measurement_basis,
              v.billing_entitlement_policy::text AS billing_entitlement_policy,
              v.commercial_config,
              v.published_at,
              v.created_at,
              v.updated_at,
              d.code
       FROM cat.service_definition_versions v
       INNER JOIN cat.service_definitions d ON d.id = v.service_definition_id
       WHERE v.service_definition_id = $1
         AND v.version = $2`,
      [definitionId, versionNumber],
    );
    const row = version.rows[0];
    if (!row) {
      return null;
    }
    const units = await this.pool().query<AllowedUnitRow>(
      `SELECT unit_code, is_default, sort_order
       FROM cat.service_allowed_units
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, unit_code ASC`,
      [row.id],
    );
    const resourceRequirements = await this.pool().query<ResourceRequirementRow>(
      `SELECT physical_resource_type_code, requirement_level, min_quantity, sort_order
       FROM cat.service_resource_requirements
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, physical_resource_type_code ASC`,
      [row.id],
    );
    const laborRequirements = await this.pool().query<LaborRequirementRow>(
      `SELECT labor_type_code, requirement_level, min_quantity, sort_order
       FROM cat.service_labor_requirements
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, labor_type_code ASC`,
      [row.id],
    );
    const pricingModels = await this.pool().query<PricingModelRow>(
      `SELECT pricing_model_code,
              config,
              sale_price_amount::text AS sale_price_amount,
              internal_cost_amount::text AS internal_cost_amount,
              currency_code,
              sort_order
       FROM cat.service_pricing_models
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, pricing_model_code ASC`,
      [row.id],
    );
    const executionRequirements = await this.pool().query<ExecutionRequirementRow>(
      `SELECT evidence_kind,
              requirement_level,
              config,
              sort_order
       FROM cat.service_evidence_requirements
       WHERE service_definition_version_id = $1
       ORDER BY sort_order ASC, evidence_kind ASC`,
      [row.id],
    );
    return {
      ...row,
      allowed_units: units.rows,
      resource_requirements: resourceRequirements.rows,
      labor_requirements: laborRequirements.rows,
      pricing_models: pricingModels.rows,
      execution_requirements: executionRequirements.rows,
    };
  }

  async listVersions(definitionId: string): Promise<ServiceDefinitionVersionRow[]> {
    const result = await this.pool().query<ServiceDefinitionVersionRow>(
      `SELECT id,
              service_definition_id,
              version,
              status,
              category_id,
              archetype,
              name,
              description,
              default_unit_code,
              measurement_mode,
              published_at,
              created_at,
              updated_at
       FROM cat.service_definition_versions
       WHERE service_definition_id = $1
       ORDER BY version ASC`,
      [definitionId],
    );
    return result.rows;
  }

  async createDefinitionWithDraft(
    input: CreateDefinitionWithDraftInput,
  ): Promise<ServiceDefinitionVersionDetail> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const definition = await client.query<ServiceDefinitionRow>(
        `INSERT INTO cat.service_definitions (
           code, created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $2)
         RETURNING id, code, status, version, created_at, updated_at, deactivated_at, deactivation_reason`,
        [input.code, input.actorIdentityId],
      );
      const defRow = definition.rows[0];
      if (!defRow) {
        throw new Error('Failed to create service definition.');
      }

      const version = await client.query<{ id: string }>(
        `INSERT INTO cat.service_definition_versions (
           service_definition_id,
           version,
           status,
           category_id,
           archetype,
           name,
           description,
           default_unit_code,
           measurement_mode,
           measurement_basis,
           created_by_identity_id,
           updated_by_identity_id,
           billing_entitlement_policy,
           commercial_config
         ) VALUES ($1, 1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8, $9, $9, $10::cat.billing_entitlement_policy, $11::jsonb)
         RETURNING id`,
        [
          defRow.id,
          input.categoryId,
          input.archetype,
          input.name,
          input.description ?? null,
          input.defaultUnitCode ?? null,
          input.measurementMode,
          input.measurementBasis,
          input.actorIdentityId,
          input.billingEntitlementPolicy ?? 'MEASUREMENT_APPROVED',
          JSON.stringify({
            schemaVersion: 1,
            requiresPurchaseOrder: input.requiresPurchaseOrder ?? false,
            requiresContractReference: false,
          }),
        ],
      );
      const versionId = version.rows[0]?.id;
      if (!versionId) {
        throw new Error('Failed to create service definition version.');
      }

      await replaceServiceCatalogAllowedUnits(client, versionId, input.allowedUnits);
      await replaceServiceCatalogResourceRequirements(client, versionId, input.resourceRequirements);
      await replaceServiceCatalogLaborRequirements(client, versionId, input.laborRequirements);
      await replaceServiceCatalogPricingModels(client, versionId, input.pricingModels);
      await replaceServiceCatalogExecutionRequirements(client, versionId, input.executionRequirements);
      await client.query('COMMIT');

      const detail = await this.findVersionDetail(defRow.id, 1);
      if (!detail) {
        throw new Error('Failed to load created service definition version.');
      }
      return detail;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createDraftVersion(
    input: CreateDraftVersionInput,
  ): Promise<ServiceDefinitionVersionDetail | 'DRAFT_EXISTS' | 'SOURCE_NOT_FOUND'> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingDraft = await client.query<{ version: number }>(
        `SELECT version
         FROM cat.service_definition_versions
         WHERE service_definition_id = $1
           AND status = 'DRAFT'
         LIMIT 1`,
        [input.definitionId],
      );
      if ((existingDraft.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return 'DRAFT_EXISTS';
      }

      const nextVersion = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM cat.service_definition_versions
         WHERE service_definition_id = $1`,
        [input.definitionId],
      );
      const versionNumber = nextVersion.rows[0]?.next_version ?? 1;

      let payload = input;
      if (input.sourceVersion !== undefined) {
        const source = await this.findVersionDetail(input.definitionId, input.sourceVersion);
        if (!source) {
          await client.query('ROLLBACK');
          return 'SOURCE_NOT_FOUND';
        }
        payload = {
          ...input,
          name: input.name || source.name,
          categoryId: input.categoryId || source.category_id,
          archetype: input.archetype || source.archetype,
          measurementMode: input.measurementMode || source.measurement_mode,
          measurementBasis: input.measurementBasis || source.measurement_basis,
          description: input.description ?? source.description ?? undefined,
          defaultUnitCode: input.defaultUnitCode ?? source.default_unit_code ?? undefined,
          allowedUnits:
            input.allowedUnits.length > 0
              ? input.allowedUnits
              : source.allowed_units.map((unit) => ({
                  unitCode: unit.unit_code,
                  isDefault: unit.is_default,
                  sortOrder: unit.sort_order,
                })),
          resourceRequirements:
            input.resourceRequirements.length > 0
              ? input.resourceRequirements
              : source.resource_requirements.map((requirement) => ({
                  resourceTypeCode: requirement.physical_resource_type_code,
                  requirementLevel: requirement.requirement_level,
                  minQuantity: requirement.min_quantity,
                  sortOrder: requirement.sort_order,
                })),
          laborRequirements:
            input.laborRequirements.length > 0
              ? input.laborRequirements
              : source.labor_requirements.map((requirement) => ({
                  laborTypeCode: requirement.labor_type_code,
                  requirementLevel: requirement.requirement_level,
                  minQuantity: requirement.min_quantity,
                  sortOrder: requirement.sort_order,
                })),
          pricingModels:
            input.pricingModels.length > 0
              ? input.pricingModels
              : source.pricing_models.map((model, index) => {
                  const unitCode = model.config?.unitCode ?? null;
                  const commercialCode =
                    model.config?.commercialCode ??
                    commercialCodeFromPersisted(
                      model.pricing_model_code as Parameters<typeof commercialCodeFromPersisted>[0],
                      unitCode,
                    ) ??
                    model.pricing_model_code;
                  return normalizePricingModelInput(
                    {
                      modelCode: isCommercialPricingModelCode(commercialCode)
                        ? commercialCode
                        : 'UNIT_PRICE',
                      unitCode,
                      salePrice: model.sale_price_amount,
                      internalCost: model.internal_cost_amount,
                      currencyCode: model.currency_code.trim(),
                      sortOrder: model.sort_order,
                    },
                    index,
                  );
                }),
          executionRequirements:
            input.executionRequirements.length > 0
              ? input.executionRequirements
              : source.execution_requirements.map((requirement) => ({
                  requirementType: requirement.evidence_kind as NormalizedExecutionRequirementInput['requirementType'],
                  requirementLevel: requirement.requirement_level,
                  config: requirement.config as NormalizedExecutionRequirementInput['config'],
                  sortOrder: requirement.sort_order,
                })),
        };
      }

      const version = await client.query<{ id: string }>(
        `INSERT INTO cat.service_definition_versions (
           service_definition_id,
           version,
           status,
           category_id,
           archetype,
           name,
           description,
           default_unit_code,
           measurement_mode,
           measurement_basis,
           created_by_identity_id,
           updated_by_identity_id,
           billing_entitlement_policy,
           commercial_config
         ) VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $10, $11::cat.billing_entitlement_policy, $12::jsonb)
         RETURNING id`,
        [
          input.definitionId,
          versionNumber,
          payload.categoryId,
          payload.archetype,
          payload.name,
          payload.description ?? null,
          payload.defaultUnitCode ?? null,
          payload.measurementMode,
          payload.measurementBasis,
          input.actorIdentityId,
          payload.billingEntitlementPolicy ?? 'MEASUREMENT_APPROVED',
          JSON.stringify({
            schemaVersion: 1,
            requiresPurchaseOrder: payload.requiresPurchaseOrder ?? false,
            requiresContractReference: false,
          }),
        ],
      );
      const versionId = version.rows[0]?.id;
      if (!versionId) {
        throw new Error('Failed to create draft version.');
      }

      await replaceServiceCatalogAllowedUnits(client, versionId, payload.allowedUnits);
      await replaceServiceCatalogResourceRequirements(client, versionId, payload.resourceRequirements);
      await replaceServiceCatalogLaborRequirements(client, versionId, payload.laborRequirements);
      await replaceServiceCatalogPricingModels(client, versionId, payload.pricingModels);
      await replaceServiceCatalogExecutionRequirements(client, versionId, payload.executionRequirements);
      await client.query(
        `UPDATE cat.service_definitions
         SET updated_at = now(), updated_by_identity_id = $2, version = version + 1
         WHERE id = $1`,
        [input.definitionId, input.actorIdentityId],
      );
      await client.query('COMMIT');

      const detail = await this.findVersionDetail(input.definitionId, versionNumber);
      if (!detail) {
        throw new Error('Failed to load created draft version.');
      }
      return detail;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraftVersion(
    input: UpdateDraftVersionInput,
  ): Promise<ServiceDefinitionVersionDetail | null | 'VERSION_CONFLICT' | 'NOT_DRAFT' | 'INVALID_STATE'> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lineage = await client.query<{ version: number; status: LineageStatus }>(
        `SELECT version, status FROM cat.service_definitions WHERE id = $1 FOR UPDATE`,
        [input.definitionId],
      );
      const lineageRow = lineage.rows[0];
      if (!lineageRow) {
        await client.query('ROLLBACK');
        return null;
      }
      if (lineageRow.status !== 'ACTIVE') {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (lineageRow.version !== input.expectedLineageVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const current = await client.query<{ id: string; status: string }>(
        `SELECT id, status
         FROM cat.service_definition_versions
         WHERE service_definition_id = $1
           AND version = $2
         FOR UPDATE`,
        [input.definitionId, input.versionNumber],
      );
      const currentRow = current.rows[0];
      if (!currentRow) {
        await client.query('ROLLBACK');
        return null;
      }
      if (currentRow.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return 'NOT_DRAFT';
      }

      await client.query(
        `UPDATE cat.service_definition_versions
         SET category_id = $3,
             archetype = $4,
             name = $5,
             description = $6,
             default_unit_code = $7,
             measurement_mode = $8,
             measurement_basis = $9,
             billing_entitlement_policy = $12::cat.billing_entitlement_policy,
             commercial_config = $13::jsonb,
             updated_at = now(),
             updated_by_identity_id = $10
         WHERE id = $2
           AND service_definition_id = $1
           AND version = $11
           AND status = 'DRAFT'`,
        [
          input.definitionId,
          currentRow.id,
          input.categoryId,
          input.archetype,
          input.name,
          input.description ?? null,
          input.defaultUnitCode ?? null,
          input.measurementMode,
          input.measurementBasis,
          input.actorIdentityId,
          input.versionNumber,
          input.billingEntitlementPolicy ?? 'MEASUREMENT_APPROVED',
          JSON.stringify({
            schemaVersion: 1,
            requiresPurchaseOrder: input.requiresPurchaseOrder ?? false,
            requiresContractReference: false,
          }),
        ],
      );

      await replaceServiceCatalogAllowedUnits(client, currentRow.id, input.allowedUnits);
      await replaceServiceCatalogResourceRequirements(client, currentRow.id, input.resourceRequirements);
      await replaceServiceCatalogLaborRequirements(client, currentRow.id, input.laborRequirements);
      await replaceServiceCatalogPricingModels(client, currentRow.id, input.pricingModels);
      await replaceServiceCatalogExecutionRequirements(client, currentRow.id, input.executionRequirements);

      const lineageUpdated = await client.query(
        `UPDATE cat.service_definitions
         SET updated_at = now(),
             updated_by_identity_id = $2,
             version = version + 1
         WHERE id = $1
           AND version = $3`,
        [input.definitionId, input.actorIdentityId, input.expectedLineageVersion],
      );
      if (lineageUpdated.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await client.query('COMMIT');
      return this.findVersionDetail(input.definitionId, input.versionNumber);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publishVersion(
    definitionId: string,
    versionNumber: number,
    expectedLineageVersion: number,
    actorIdentityId: string,
  ): Promise<
    ServiceDefinitionVersionDetail | null | 'VERSION_CONFLICT' | 'NOT_DRAFT' | 'INVALID_STATE' | 'PUBLISH_INVALID'
  > {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lineage = await client.query<{ version: number; status: LineageStatus; code: string }>(
        `SELECT version, status, code FROM cat.service_definitions WHERE id = $1 FOR UPDATE`,
        [definitionId],
      );
      const lineageRow = lineage.rows[0];
      if (!lineageRow) {
        await client.query('ROLLBACK');
        return null;
      }
      if (lineageRow.status !== 'ACTIVE') {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (lineageRow.version !== expectedLineageVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const draft = await client.query<{
        id: string;
        name: string;
        category_id: string;
        archetype: string;
      }>(
        `SELECT id, name, category_id, archetype
         FROM cat.service_definition_versions
         WHERE service_definition_id = $1
           AND version = $2
         FOR UPDATE`,
        [definitionId, versionNumber],
      );
      const draftRow = draft.rows[0];
      if (!draftRow) {
        await client.query('ROLLBACK');
        return null;
      }

      const units = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM cat.service_allowed_units
         WHERE service_definition_version_id = $1`,
        [draftRow.id],
      );
      const unitCount = Number(units.rows[0]?.count ?? '0');
      if (
        !lineageRow.code ||
        !draftRow.name?.trim() ||
        !draftRow.category_id ||
        !draftRow.archetype ||
        unitCount < 1
      ) {
        await client.query('ROLLBACK');
        return 'PUBLISH_INVALID';
      }

      const statusCheck = await client.query<{ status: string }>(
        `SELECT status FROM cat.service_definition_versions WHERE id = $1`,
        [draftRow.id],
      );
      if (statusCheck.rows[0]?.status !== 'DRAFT') {
        await client.query('ROLLBACK');
        return 'NOT_DRAFT';
      }

      await client.query(
        `UPDATE cat.service_definition_versions
         SET status = 'RETIRED',
             retired_at = now(),
             retired_by_identity_id = $2,
             updated_at = now(),
             updated_by_identity_id = $2
         WHERE service_definition_id = $1
           AND status = 'ACTIVE'`,
        [definitionId, actorIdentityId],
      );

      const published = await client.query(
        `UPDATE cat.service_definition_versions
         SET status = 'ACTIVE',
             published_at = now(),
             published_by_identity_id = $3,
             updated_at = now(),
             updated_by_identity_id = $3
         WHERE id = $1
           AND service_definition_id = $2
           AND status = 'DRAFT'`,
        [draftRow.id, definitionId, actorIdentityId],
      );
      if (published.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'NOT_DRAFT';
      }

      const lineageUpdated = await client.query(
        `UPDATE cat.service_definitions
         SET updated_at = now(),
             updated_by_identity_id = $2,
             version = version + 1
         WHERE id = $1
           AND version = $3`,
        [definitionId, actorIdentityId, expectedLineageVersion],
      );
      if (lineageUpdated.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await client.query('COMMIT');
      return this.findVersionDetail(definitionId, versionNumber);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setDefinitionStatus(
    definitionId: string,
    expectedVersion: number,
    status: LineageStatus,
    actorIdentityId: string,
    reason?: string,
  ): Promise<ServiceDefinitionSummary | null | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: LineageStatus }>(
        `SELECT status FROM cat.service_definitions WHERE id = $1 FOR UPDATE`,
        [definitionId],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      if (row.status === status) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const updated = await client.query(
        `UPDATE cat.service_definitions
         SET status = $3::cat.service_definition_lineage_status,
             version = version + 1,
             updated_at = now(),
             updated_by_identity_id = $4,
             deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN now() ELSE NULL END,
             deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE NULL END,
             deactivation_reason = CASE WHEN $3::text = 'INACTIVE' THEN $5 ELSE NULL END
         WHERE id = $1
           AND version = $2`,
        [definitionId, expectedVersion, status, actorIdentityId, reason ?? null],
      );
      if (updated.rowCount === 0) {
        const exists = await client.query(`SELECT 1 FROM cat.service_definitions WHERE id = $1`, [definitionId]);
        await client.query('ROLLBACK');
        if (exists.rowCount === 0) {
          return null;
        }
        return 'VERSION_CONFLICT';
      }
      await client.query('COMMIT');
      return this.findDefinitionSummary(definitionId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listActiveCategories(): Promise<Array<{ id: string; code: string; name: string }>> {
    const result = await this.pool().query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name
       FROM cat.service_categories
       WHERE status = 'ACTIVE'
       ORDER BY name`,
    );
    return result.rows;
  }

  async categoryExists(categoryId: string): Promise<boolean> {
    const result = await this.pool().query(
      `SELECT 1 FROM cat.service_categories WHERE id = $1 AND status = 'ACTIVE'`,
      [categoryId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
