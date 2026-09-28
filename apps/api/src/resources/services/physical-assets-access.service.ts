import { HttpStatus, Injectable } from '@nestjs/common';
import { buildAssetOperationalLifecycle } from '../domain/asset-operational-lifecycle';
import { AssetOperationalAuthz } from './asset-operational.authz';

/** Historico operacional limitado: o detalhe nunca carrega vida infinita do recurso. */
const ASSET_HISTORY_LIMIT = 10;
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { toResourceContextFromPhysicalAsset } from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../catalog/domain/service-catalog.validation';
import { CatalogValidationError } from '../../catalog/domain/service-catalog.validation';
import { PHYSICAL_RESOURCE_TYPE_STATUSES } from '../domain/physical-resource-type';
import {
  ASSET_LIFECYCLE_STATUSES,
  ASSET_OPERATIONAL_AVAILABILITIES,
  VEHICLE_CLASSIFICATION,
  type AssetOperationalAvailability,
} from '../domain/physical-asset';
import type {
  CreatePhysicalAssetInput,
  UpdatePhysicalAssetInput,
} from '../dto/physical-assets.dto';
import { ASSET_ERROR_CODES } from '../errors/asset-error-codes';
import { AssetHttpException } from '../errors/asset-http.exception';
import { PhysicalAssetsRepository, activeAllocationExistsClause, appendPhysicalAssetSearchClause } from '../repositories/physical-assets.repository';
import { PhysicalResourceTypesRepository } from '../repositories/physical-resource-types.repository';
import {
  toPhysicalAssetResponse,
  toPhysicalAssetListSummaryResponse,
  type PhysicalAssetListSummaryResponse,
  type PhysicalAssetResponse,
} from '../serializers/physical-assets-response.serializer';

@Injectable()
export class PhysicalAssetsAccessService {
  constructor(
    private readonly assetsRepository: PhysicalAssetsRepository,
    private readonly resourceTypesRepository: PhysicalResourceTypesRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly securityAudit: SecurityAuditService,
    private readonly assetOperationalAuthz: AssetOperationalAuthz,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreatePhysicalAssetInput,
  ): Promise<PhysicalAssetResponse> {
    await this.assertCreateAction(actor, input.unitId);

    const resourceType = await this.resourceTypesRepository.findById(input.resourceTypeId);
    if (!resourceType) {
      throw new AssetHttpException(
        HttpStatus.BAD_REQUEST,
        ASSET_ERROR_CODES.INVALID_RESOURCE_TYPE,
        'Physical resource type not found.',
      );
    }
    if (resourceType.status !== PHYSICAL_RESOURCE_TYPE_STATUSES.Active) {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INACTIVE_RESOURCE_TYPE,
        'Physical resource type is inactive.',
      );
    }

    const isVehicle = resourceType.classification === VEHICLE_CLASSIFICATION;
    if (isVehicle && !input.vehicle) {
      throw new AssetHttpException(
        HttpStatus.BAD_REQUEST,
        ASSET_ERROR_CODES.VEHICLE_PROFILE_REQUIRED,
        'Vehicle profile is required for vehicle assets.',
      );
    }
    if (!isVehicle && input.vehicle) {
      throw new AssetHttpException(
        HttpStatus.BAD_REQUEST,
        ASSET_ERROR_CODES.VEHICLE_PROFILE_FORBIDDEN,
        'Vehicle profile is not applicable for this asset type.',
      );
    }

    const unitRegistered = await this.assetsRepository.isUnitRegistered(input.unitId);
    if (!unitRegistered) {
      throw new AssetHttpException(
        HttpStatus.BAD_REQUEST,
        ASSET_ERROR_CODES.UNIT_NOT_REGISTERED,
        'Unit is not registered.',
      );
    }

    try {
      const created = await this.assetsRepository.create({
        ...input,
        actorIdentityId: actor.identityId,
      });

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.ResourcesAssetCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ResourcesAsset,
        resourceId: created.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { assetCode: created.asset_code, unitId: created.unit_id },
      });

      return toPhysicalAssetResponse(created);
    } catch (error) {
      if (this.isUniqueAssetCodeViolation(error)) {
        throw new AssetHttpException(
          HttpStatus.CONFLICT,
          ASSET_ERROR_CODES.CODE_CONFLICT,
          'Asset code already exists.',
        );
      }
      if (this.isUniquePlateViolation(error)) {
        throw new AssetHttpException(
          HttpStatus.CONFLICT,
          ASSET_ERROR_CODES.PLATE_CONFLICT,
          'Vehicle plate already exists.',
        );
      }
      throw error;
    }
  }

  async getById(actor: IdentityAuthzContext, assetId: string): Promise<PhysicalAssetResponse> {
    this.assertValidAssetId(assetId);

    const asset = await this.assetsRepository.findById(assetId);
    if (!asset) {
      throw this.notFound();
    }

    await this.assertRecordAction(actor, AUTHZ_ACTIONS.ResourcesAssetRead, asset);

    // Vida operacional: duas consultas pequenas em paralelo, historico limitado.
    const [allocations, occurrences] = await Promise.all([
      this.assetsRepository.listAllocationUsage(assetId, ASSET_HISTORY_LIMIT),
      this.assetsRepository.listOccurrences(assetId, ASSET_HISTORY_LIMIT),
    ]);
    const [authorizedAllocations, authorizedOccurrences] = await Promise.all([
      this.assetOperationalAuthz.filterAuthorizedUsage(actor, asset as never, allocations),
      this.assetOperationalAuthz.filterAuthorizedOccurrences(actor, asset as never, occurrences),
    ]);

    return toPhysicalAssetResponse(
      asset,
      buildAssetOperationalLifecycle({
        allocations: authorizedAllocations,
        occurrences: authorizedOccurrences,
      }),
    );
  }

  async list(
    actor: IdentityAuthzContext,
    query: {
      limit: number;
      offset: number;
      lifecycleStatus?: 'ACTIVE' | 'INACTIVE';
      allocationStatus?: 'AVAILABLE' | 'ALLOCATED';
      availability?: AssetOperationalAvailability;
      resourceTypeId?: string;
      classification?: typeof VEHICLE_CLASSIFICATION;
      q?: string;
    },
  ): Promise<{ items: PhysicalAssetResponse[]; limit: number; offset: number; total: number }> {
    const { whereClause, params } = await this.buildListScope(actor, query);

    const [rows, total] = await Promise.all([
      this.assetsRepository.list(whereClause, params, query.limit, query.offset),
      this.assetsRepository.count(whereClause, params),
    ]);

    return {
      items: rows.map((detail) => toPhysicalAssetResponse(detail)),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  }

  async summary(
    actor: IdentityAuthzContext,
    query: {
      resourceTypeId?: string;
      classification?: typeof VEHICLE_CLASSIFICATION;
    },
  ): Promise<PhysicalAssetListSummaryResponse> {
    const { whereClause, params } = await this.buildListScope(actor, {
      resourceTypeId: query.resourceTypeId,
      classification: query.classification,
    });
    const counts = await this.assetsRepository.countSummary(whereClause, params);
    return toPhysicalAssetListSummaryResponse(counts);
  }

  private async buildListScope(
    actor: IdentityAuthzContext,
    query: {
      lifecycleStatus?: 'ACTIVE' | 'INACTIVE';
      allocationStatus?: 'AVAILABLE' | 'ALLOCATED';
      availability?: AssetOperationalAvailability;
      resourceTypeId?: string;
      classification?: typeof VEHICLE_CLASSIFICATION;
      q?: string;
    },
  ): Promise<{ whereClause: string; params: unknown[] }> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ResourcesAssetList,
      AUTHZ_RESOURCE_TYPES.ResourcesAsset,
    );
    if (grants.length === 0) {
      throw this.denied();
    }

    const scopeFilter = this.scopeEnforcement.buildPhysicalAssetListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw this.denied();
    }

    const clauses = [scopeFilter.clause === 'TRUE' ? 'TRUE' : scopeFilter.clause];
    const params = [...scopeFilter.params];

    if (query.lifecycleStatus) {
      clauses.push(`a.lifecycle_status = $${params.length + 1}::ast.asset_lifecycle_status`);
      params.push(query.lifecycleStatus);
    }
    if (query.allocationStatus) {
      if (query.allocationStatus === 'AVAILABLE') {
        clauses.push(`NOT (${activeAllocationExistsClause()})`);
      } else {
        clauses.push(activeAllocationExistsClause());
      }
    }
    if (query.availability) {
      if (query.availability === ASSET_OPERATIONAL_AVAILABILITIES.Available) {
        clauses.push(`a.lifecycle_status = $${params.length + 1}::ast.asset_lifecycle_status`);
        params.push(ASSET_LIFECYCLE_STATUSES.Active);
        clauses.push(`NOT (${activeAllocationExistsClause()})`);
      } else if (query.availability === ASSET_OPERATIONAL_AVAILABILITIES.Allocated) {
        clauses.push(activeAllocationExistsClause());
      } else if (query.availability === ASSET_OPERATIONAL_AVAILABILITIES.Unavailable) {
        clauses.push(`a.lifecycle_status = $${params.length + 1}::ast.asset_lifecycle_status`);
        params.push(ASSET_LIFECYCLE_STATUSES.Inactive);
      }
    }
    if (query.resourceTypeId) {
      clauses.push(`a.physical_resource_type_id = $${params.length + 1}::uuid`);
      params.push(query.resourceTypeId);
    }
    if (query.classification) {
      clauses.push(`rt.classification = $${params.length + 1}::cat.physical_resource_classification`);
      params.push(query.classification);
    }
    if (query.q) {
      const searchClause = appendPhysicalAssetSearchClause(query.q, params);
      if (searchClause) {
        clauses.push(searchClause);
      }
    }

    return { whereClause: clauses.join(' AND '), params };
  }

  async update(
    actor: IdentityAuthzContext,
    assetId: string,
    input: UpdatePhysicalAssetInput,
  ): Promise<PhysicalAssetResponse> {
    this.assertValidAssetId(assetId);

    const existing = await this.assetsRepository.findById(assetId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertRecordAction(actor, AUTHZ_ACTIONS.ResourcesAssetUpdate, existing);

    if (input.vehicle !== undefined) {
      if (existing.resource_type_classification !== VEHICLE_CLASSIFICATION) {
        throw new AssetHttpException(
          HttpStatus.BAD_REQUEST,
          ASSET_ERROR_CODES.VEHICLE_PROFILE_FORBIDDEN,
          'Vehicle profile is not applicable for this asset type.',
        );
      }
    }

    try {
      const updated = await this.assetsRepository.update({
        assetId,
        expectedVersion: input.version,
        name: input.name,
        vehicle: input.vehicle,
        hasVehicleProfile: existing.vehicle !== null,
        actorIdentityId: actor.identityId,
      });

      if (updated === null) {
        throw this.notFound();
      }
      if (updated === 'VERSION_CONFLICT') {
        throw this.versionConflict();
      }

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.ResourcesAssetUpdate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ResourcesAsset,
        resourceId: assetId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      return toPhysicalAssetResponse(updated);
    } catch (error) {
      if (this.isUniquePlateViolation(error)) {
        throw new AssetHttpException(
          HttpStatus.CONFLICT,
          ASSET_ERROR_CODES.PLATE_CONFLICT,
          'Vehicle plate already exists.',
        );
      }
      throw error;
    }
  }

  async deactivate(
    actor: IdentityAuthzContext,
    assetId: string,
    version: number,
  ): Promise<PhysicalAssetResponse> {
    this.assertValidAssetId(assetId);

    const existing = await this.assetsRepository.findById(assetId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertRecordAction(actor, AUTHZ_ACTIONS.ResourcesAssetDeactivate, existing);

    const updated = await this.assetsRepository.setLifecycleStatus(
      assetId,
      version,
      ASSET_LIFECYCLE_STATUSES.Inactive,
      actor.identityId,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw this.versionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INVALID_STATE,
        'Asset is already inactive.',
      );
    }
    if (updated === 'HAS_ACTIVE_ALLOCATIONS') {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INVALID_STATE,
        'Asset cannot be deactivated while it has active allocations.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ResourcesAssetDeactivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ResourcesAsset,
      resourceId: assetId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toPhysicalAssetResponse(updated);
  }

  async activate(
    actor: IdentityAuthzContext,
    assetId: string,
    version: number,
  ): Promise<PhysicalAssetResponse> {
    this.assertValidAssetId(assetId);

    const existing = await this.assetsRepository.findById(assetId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertRecordAction(actor, AUTHZ_ACTIONS.ResourcesAssetActivate, existing);

    const resourceType = await this.resourceTypesRepository.findById(existing.physical_resource_type_id);
    if (!resourceType || resourceType.status !== PHYSICAL_RESOURCE_TYPE_STATUSES.Active) {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INACTIVE_RESOURCE_TYPE,
        'Physical resource type is inactive.',
      );
    }

    const updated = await this.assetsRepository.setLifecycleStatus(
      assetId,
      version,
      ASSET_LIFECYCLE_STATUSES.Active,
      actor.identityId,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw this.versionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INVALID_STATE,
        'Asset is already active.',
      );
    }
    if (updated === 'HAS_ACTIVE_ALLOCATIONS') {
      throw new AssetHttpException(
        HttpStatus.CONFLICT,
        ASSET_ERROR_CODES.INVALID_STATE,
        'Asset cannot be activated due to an allocation conflict.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ResourcesAssetActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ResourcesAsset,
      resourceId: assetId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toPhysicalAssetResponse(updated);
  }

  private async assertCreateAction(actor: IdentityAuthzContext, unitId: string): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      { action: AUTHZ_ACTIONS.ResourcesAssetCreate, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw this.denied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ResourcesAssetCreate,
      AUTHZ_RESOURCE_TYPES.ResourcesAsset,
    );

    const hasGlobal = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobal) {
      return;
    }

    const hasUnit = grants.some(
      (grant) =>
        grant.scope_type === AUTHZ_SCOPES.Unit &&
        grant.resource_id !== null &&
        grant.resource_id === unitId,
    );
    if (!hasUnit) {
      throw this.denied();
    }
  }

  private async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    asset: { id: string; unit_id: string },
  ): Promise<void> {
    const context = toResourceContextFromPhysicalAsset(asset);
    const decision = await this.policyDecisionPoint.decide(
      actor,
      { action, resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset, context },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw this.denied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ResourcesAsset,
    );

    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      if (
        grant.scope_type === AUTHZ_SCOPES.Unit &&
        grant.resource_id !== null &&
        grant.resource_id === asset.unit_id
      ) {
        return true;
      }
      return false;
    });

    if (!hasAccess) {
      throw this.denied();
    }
  }

  private assertValidAssetId(assetId: string): void {
    try {
      assertUuid(assetId);
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        throw this.notFound();
      }
      throw error;
    }
  }

  private denied(): AssetHttpException {
    return new AssetHttpException(HttpStatus.FORBIDDEN, ASSET_ERROR_CODES.DENIED, 'Access denied.');
  }

  private notFound(): AssetHttpException {
    return new AssetHttpException(
      HttpStatus.NOT_FOUND,
      ASSET_ERROR_CODES.NOT_FOUND,
      'Physical asset not found.',
    );
  }

  private versionConflict(): AssetHttpException {
    return new AssetHttpException(
      HttpStatus.CONFLICT,
      ASSET_ERROR_CODES.VERSION_CONFLICT,
      'Physical asset was modified by another request.',
    );
  }

  private isUniqueAssetCodeViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return pgError.code === '23505' && (pgError.constraint?.includes('asset_code') ?? false);
  }

  private isUniquePlateViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return pgError.code === '23505' && (pgError.constraint?.includes('plate') ?? false);
  }
}