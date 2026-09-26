import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { LINEAGE_STATUSES } from '../domain/service-catalog-status';
import type {
  CreateServiceDefinitionInput,
  CreateServiceDefinitionVersionInput,
  UpdateDraftServiceDefinitionInput,
} from '../dto/service-catalog.dto';
import { CATALOG_ERROR_CODES } from '../errors/catalog-error-codes';
import { CatalogHttpException } from '../errors/catalog-http.exception';
import { ServiceCatalogRepository } from '../repositories/service-catalog.repository';
import {
  toServiceDefinitionResponse,
  toServiceDefinitionVersionResponse,
  type ServiceDefinitionResponse,
  type ServiceDefinitionVersionResponse,
} from '../serializers/service-catalog-response.serializer';
import { ServiceCatalogAccessAuthz } from './service-catalog-access.authz';
import {
  catalogAccessNotFound,
  catalogVersionConflict,
  isUniqueCatalogCodeViolation,
} from './service-catalog-access.errors';
import {
  assertValidCatalogDefinitionId,
  resolveCommercialCatalogAccessInput,
  resolveExecutionRequirementsCatalogAccess,
} from './service-catalog-input-resolution';
import { ServiceCatalogReferenceValidationService } from './service-catalog-reference-validation.service';

@Injectable()
export class ServiceCatalogAccessService {
  constructor(
    private readonly repository: ServiceCatalogRepository,
    private readonly authz: ServiceCatalogAccessAuthz,
    private readonly referenceValidation: ServiceCatalogReferenceValidationService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateServiceDefinitionInput,
  ): Promise<ServiceDefinitionVersionResponse> {
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceCreate);

    if (!(await this.repository.categoryExists(input.categoryId))) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    await this.referenceValidation.assertActiveUnitReferences(
      input.allowedUnits.map((unit) => unit.unitCode),
      input.defaultUnitCode,
    );
    await this.referenceValidation.assertActiveResourceTypeReferences(
      (input.resourceRequirements ?? []).map((requirement) => requirement.resourceTypeCode),
    );
    await this.referenceValidation.assertActiveLaborTypeReferences(
      (input.laborRequirements ?? []).map((requirement) => requirement.laborTypeCode),
    );
    const commercial = resolveCommercialCatalogAccessInput(input);

    try {
      const created = await this.repository.createDefinitionWithDraft({
        ...input,
        ...commercial,
        resourceRequirements: input.resourceRequirements ?? [],
        laborRequirements: input.laborRequirements ?? [],
        executionRequirements: resolveExecutionRequirementsCatalogAccess(input.executionRequirements),
        actorIdentityId: actor.identityId,
      });

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.CatalogServiceCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
        resourceId: created.service_definition_id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { code: created.code, version: created.version },
      });

      return toServiceDefinitionVersionResponse(created);
    } catch (error) {
      if (isUniqueCatalogCodeViolation(error)) {
        throw new CatalogHttpException(
          HttpStatus.CONFLICT,
          CATALOG_ERROR_CODES.CODE_CONFLICT,
          'Service definition code already exists.',
        );
      }
      throw error;
    }
  }

  async getDefinition(actor: IdentityAuthzContext, definitionId: string): Promise<ServiceDefinitionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    const definition = await this.repository.findDefinitionSummary(definitionId);
    if (!definition) {
      throw catalogAccessNotFound();
    }
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceRead);
    return toServiceDefinitionResponse(definition);
  }

  async listCategories(
    actor: IdentityAuthzContext,
  ): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
    await this.authz.assertListAction(actor);
    return { items: await this.repository.listActiveCategories() };
  }

  async listDefinitions(
    actor: IdentityAuthzContext,
    query: { limit: number; offset: number; status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<{ items: ServiceDefinitionResponse[]; limit: number; offset: number }> {
    await this.authz.assertListAction(actor);

    const clauses = ['TRUE'];
    const params: unknown[] = [];
    if (query.status) {
      clauses.push(`d.status = $${params.length + 1}`);
      params.push(query.status);
    }

    const rows = await this.repository.listDefinitions(clauses.join(' AND '), params, query.limit, query.offset);
    return {
      items: rows.map(toServiceDefinitionResponse),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createVersion(
    actor: IdentityAuthzContext,
    definitionId: string,
    input: CreateServiceDefinitionVersionInput,
  ): Promise<ServiceDefinitionVersionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceUpdate);

    const definition = await this.repository.findDefinitionSummary(definitionId);
    if (!definition) {
      throw catalogAccessNotFound();
    }
    if (definition.status !== LINEAGE_STATUSES.Active) {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Service definition is inactive.',
      );
    }
    if (!(await this.repository.categoryExists(input.categoryId))) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    if (input.sourceVersion !== undefined) {
      const source = await this.repository.findVersionDetail(definitionId, input.sourceVersion);
      if (!source) {
        throw catalogAccessNotFound();
      }
    }
    await this.referenceValidation.assertActiveUnitReferences(
      input.allowedUnits.map((unit) => unit.unitCode),
      input.defaultUnitCode,
    );
    await this.referenceValidation.assertActiveResourceTypeReferences(
      (input.resourceRequirements ?? []).map((requirement) => requirement.resourceTypeCode),
    );
    await this.referenceValidation.assertActiveLaborTypeReferences(
      (input.laborRequirements ?? []).map((requirement) => requirement.laborTypeCode),
    );
    const commercial =
      input.pricingModels.length === 0 && input.sourceVersion !== undefined
        ? { measurementBasis: input.measurementBasis, pricingModels: [] as const }
        : resolveCommercialCatalogAccessInput(input);

    const created = await this.repository.createDraftVersion({
      definitionId,
      ...input,
      measurementBasis: commercial.measurementBasis,
      pricingModels: [...commercial.pricingModels],
      resourceRequirements: input.resourceRequirements ?? [],
      laborRequirements: input.laborRequirements ?? [],
      executionRequirements: resolveExecutionRequirementsCatalogAccess(
        input.executionRequirements,
        input.sourceVersion,
      ),
      actorIdentityId: actor.identityId,
    });

    if (created === 'DRAFT_EXISTS') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'A draft version already exists for this service definition.',
      );
    }
    if (created === 'SOURCE_NOT_FOUND') {
      throw catalogAccessNotFound();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CatalogServiceCreateVersion,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
      resourceId: definitionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { version: created.version },
    });

    return toServiceDefinitionVersionResponse(created);
  }

  async getVersion(
    actor: IdentityAuthzContext,
    definitionId: string,
    versionNumber: number,
  ): Promise<ServiceDefinitionVersionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceRead);

    const version = await this.repository.findVersionDetail(definitionId, versionNumber);
    if (!version) {
      throw catalogAccessNotFound();
    }
    return toServiceDefinitionVersionResponse(version);
  }

  async listVersions(
    actor: IdentityAuthzContext,
    definitionId: string,
  ): Promise<ServiceDefinitionVersionResponse[]> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceRead);

    const definition = await this.repository.findDefinitionSummary(definitionId);
    if (!definition) {
      throw catalogAccessNotFound();
    }

    const rows = await this.repository.listVersions(definitionId);
    const items: ServiceDefinitionVersionResponse[] = [];
    for (const row of rows) {
      const detail = await this.repository.findVersionDetail(definitionId, row.version);
      if (detail) {
        items.push(toServiceDefinitionVersionResponse(detail));
      }
    }
    return items;
  }

  async updateDraft(
    actor: IdentityAuthzContext,
    definitionId: string,
    versionNumber: number,
    input: UpdateDraftServiceDefinitionInput,
  ): Promise<ServiceDefinitionVersionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceUpdate);

    if (!(await this.repository.categoryExists(input.categoryId))) {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
    await this.referenceValidation.assertActiveUnitReferences(
      input.allowedUnits.map((unit) => unit.unitCode),
      input.defaultUnitCode ?? undefined,
    );
    await this.referenceValidation.assertActiveResourceTypeReferences(
      (input.resourceRequirements ?? []).map((requirement) => requirement.resourceTypeCode),
    );
    await this.referenceValidation.assertActiveLaborTypeReferences(
      (input.laborRequirements ?? []).map((requirement) => requirement.laborTypeCode),
    );
    const commercial = resolveCommercialCatalogAccessInput(input);

    const updated = await this.repository.updateDraftVersion({
      definitionId,
      versionNumber,
      expectedLineageVersion: input.lineageVersion,
      name: input.name,
      categoryId: input.categoryId,
      archetype: input.archetype,
      measurementMode: input.measurementMode,
      measurementBasis: commercial.measurementBasis,
      description: input.description,
      defaultUnitCode: input.defaultUnitCode,
      allowedUnits: input.allowedUnits,
      resourceRequirements: input.resourceRequirements ?? [],
      laborRequirements: input.laborRequirements ?? [],
      pricingModels: commercial.pricingModels,
      executionRequirements: resolveExecutionRequirementsCatalogAccess(input.executionRequirements),
      billingEntitlementPolicy: input.billingEntitlementPolicy ?? null,
      requiresPurchaseOrder: input.requiresPurchaseOrder ?? null,
      actorIdentityId: actor.identityId,
    });

    if (updated === null) {
      throw catalogAccessNotFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw catalogVersionConflict();
    }
    if (updated === 'NOT_DRAFT') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Only draft versions can be updated.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Service definition is inactive.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CatalogServiceUpdateDraft,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
      resourceId: definitionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { version: versionNumber },
    });

    return toServiceDefinitionVersionResponse(updated);
  }

  async publishVersion(
    actor: IdentityAuthzContext,
    definitionId: string,
    versionNumber: number,
    lineageVersion: number,
  ): Promise<ServiceDefinitionVersionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServicePublish);

    const draft = await this.repository.findVersionDetail(definitionId, versionNumber);
    if (!draft) {
      throw catalogAccessNotFound();
    }
    await this.referenceValidation.assertActiveUnitReferences(
      draft.allowed_units.map((unit) => unit.unit_code),
      draft.default_unit_code,
    );
    await this.referenceValidation.assertActiveResourceTypeReferences(
      draft.resource_requirements.map((requirement) => requirement.physical_resource_type_code),
    );
    await this.referenceValidation.assertActiveLaborTypeReferences(
      draft.labor_requirements.map((requirement) => requirement.labor_type_code),
    );

    const result = await this.repository.publishVersion(
      definitionId,
      versionNumber,
      lineageVersion,
      actor.identityId,
    );

    if (result === null) {
      throw catalogAccessNotFound();
    }
    if (result === 'VERSION_CONFLICT') {
      throw catalogVersionConflict();
    }
    if (result === 'NOT_DRAFT') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Only draft versions can be published.',
      );
    }
    if (result === 'INVALID_STATE') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Service definition is inactive.',
      );
    }
    if (result === 'PUBLISH_INVALID') {
      throw new CatalogHttpException(
        HttpStatus.BAD_REQUEST,
        CATALOG_ERROR_CODES.PUBLISH_INVALID,
        'Service definition version is not ready for publication.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CatalogServicePublish,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
      resourceId: definitionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { version: versionNumber },
    });

    return toServiceDefinitionVersionResponse(result);
  }

  async deactivate(
    actor: IdentityAuthzContext,
    definitionId: string,
    lineageVersion: number,
    reason: string,
  ): Promise<ServiceDefinitionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceDeactivate);

    const updated = await this.repository.setDefinitionStatus(
      definitionId,
      lineageVersion,
      LINEAGE_STATUSES.Inactive,
      actor.identityId,
      reason,
    );

    if (updated === null) {
      throw catalogAccessNotFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw catalogVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Service definition is already inactive.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CatalogServiceDeactivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
      resourceId: definitionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { reason },
    });

    return toServiceDefinitionResponse(updated);
  }

  async activate(
    actor: IdentityAuthzContext,
    definitionId: string,
    lineageVersion: number,
  ): Promise<ServiceDefinitionResponse> {
    assertValidCatalogDefinitionId(definitionId);
    await this.authz.assertGlobalAction(actor, AUTHZ_ACTIONS.CatalogServiceActivate);

    const updated = await this.repository.setDefinitionStatus(
      definitionId,
      lineageVersion,
      LINEAGE_STATUSES.Active,
      actor.identityId,
    );

    if (updated === null) {
      throw catalogAccessNotFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw catalogVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw new CatalogHttpException(
        HttpStatus.CONFLICT,
        CATALOG_ERROR_CODES.INVALID_STATE,
        'Service definition is already active.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CatalogServiceActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CatalogService,
      resourceId: definitionId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toServiceDefinitionResponse(updated);
  }
}
