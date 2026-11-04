import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { toResourceContextFromPerson } from '../../authorization/scope/scope-matcher';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  assertCreatePersonInput,
  assertDeactivationReason,
  assertUpdatePersonInput,
  PersonValidationError,
  type CreatePersonInput,
  type UpdatePersonInput,
} from '../domain/person.validation';
import { PERSON_ERROR_CODES } from '../errors/person-error-codes';
import { PersonHttpException } from '../errors/person-http.exception';
import { mapPersonValidationCodeToStatus } from '../errors/person-validation-status';
import { PeopleRepository } from '../repositories/people.repository';
import {
  toPersonHistoryEventResponse,
  toPersonResponse,
  type PersonHistoryEventResponse,
  type PersonResponse,
} from '../serializers/person-response.serializer';

@Injectable()
export class PersonAccessService {
  constructor(
    private readonly peopleRepository: PeopleRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(actor: IdentityAuthzContext, input: CreatePersonInput): Promise<PersonResponse> {
    await this.assertAction(actor, AUTHZ_ACTIONS.PeoplePersonCreate, undefined, AUTHZ_SCOPES.Global);

    let normalized: CreatePersonInput;
    try {
      normalized = assertCreatePersonInput(input);
    } catch (error) {
      if (error instanceof PersonValidationError) {
        throw new PersonHttpException(
          mapPersonValidationCodeToStatus(error.code),
          PERSON_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    try {
      const created = await this.peopleRepository.create(normalized, actor.identityId);

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PeoplePersonCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PeoplePerson,
        resourceId: created.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      return toPersonResponse(created);
    } catch (error) {
      if (this.isUniqueExternalIdViolation(error)) {
        throw new PersonHttpException(
          HttpStatus.CONFLICT,
          PERSON_ERROR_CODES.EXTERNAL_ID_CONFLICT,
          'Person with this external reference already exists.',
        );
      }
      if (this.isLaborTypeViolation(error)) {
        throw new PersonHttpException(
          HttpStatus.BAD_REQUEST,
          PERSON_ERROR_CODES.LABOR_TYPE_NOT_FOUND,
          'Operational labor type not found.',
        );
      }
      throw error;
    }
  }

  async getById(actor: IdentityAuthzContext, personId: string): Promise<PersonResponse> {
    this.assertValidPersonId(personId);
    const person = await this.peopleRepository.findById(personId);
    if (!person) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.PeoplePersonRead,
      toResourceContextFromPerson(person),
      undefined,
    );
    return toPersonResponse(person);
  }

  async list(
    actor: IdentityAuthzContext,
    query: {
      limit: number;
      offset: number;
      status?: 'ACTIVE' | 'INACTIVE';
      q?: string;
      defaultLaborTypeCode?: string;
    },
  ): Promise<{ items: PersonResponse[]; limit: number; offset: number; total: number; asOf: string }> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.PeoplePersonList,
      AUTHZ_RESOURCE_TYPES.PeoplePerson,
    );
    if (grants.length === 0) {
      throw this.denied();
    }

    const scopeFilter = this.scopeEnforcement.buildPersonListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw this.denied();
    }

    // Authorization predicate must accompany both page and count.
    const whereParts: string[] = [scopeFilter.clause];
    const params: unknown[] = [...scopeFilter.params];

    if (query.status) {
      whereParts.push(`m.status = $${params.length + 1}::wrk.workforce_member_status`);
      params.push(query.status);
    }
    if (query.defaultLaborTypeCode) {
      whereParts.push(`m.default_labor_type_code = $${params.length + 1}`);
      params.push(query.defaultLaborTypeCode);
    }
    if (query.q) {
      whereParts.push(
        `(m.legal_name ILIKE $${params.length + 1} OR m.preferred_name ILIKE $${params.length + 1} OR m.member_code ILIKE $${params.length + 1})`,
      );
      params.push(`%${query.q.trim()}%`);
    }

    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const [rows, total] = await Promise.all([
      this.peopleRepository.list(whereClause, params, query.limit, query.offset),
      this.peopleRepository.count(whereClause, params),
    ]);

    return {
      items: rows.map(toPersonResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      asOf: new Date().toISOString(),
    };
  }

  async update(
    actor: IdentityAuthzContext,
    personId: string,
    input: UpdatePersonInput,
  ): Promise<PersonResponse> {
    this.assertValidPersonId(personId);

    let normalized: UpdatePersonInput;
    try {
      normalized = assertUpdatePersonInput(input);
    } catch (error) {
      if (error instanceof PersonValidationError) {
        throw new PersonHttpException(
          mapPersonValidationCodeToStatus(error.code),
          PERSON_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.peopleRepository.findById(personId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.PeoplePersonUpdate,
      toResourceContextFromPerson(existing),
      undefined,
    );

    try {
      const updated = await this.peopleRepository.update(
        {
          personId,
          expectedVersion: normalized.version,
          legalName: normalized.legalName,
          preferredName: normalized.preferredName,
          defaultLaborTypeCode: normalized.defaultLaborTypeCode,
          externalErpId: normalized.externalErpId,
        },
        actor.identityId,
      );

      if (updated === null) {
        throw this.notFound();
      }
      if (updated === 'VERSION_CONFLICT') {
        throw new PersonHttpException(
          HttpStatus.CONFLICT,
          PERSON_ERROR_CODES.VERSION_CONFLICT,
          'Person was modified by another request.',
        );
      }

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.PeoplePersonUpdate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PeoplePerson,
        resourceId: personId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      return toPersonResponse(updated);
    } catch (error) {
      if (this.isUniqueExternalIdViolation(error)) {
        throw new PersonHttpException(
          HttpStatus.CONFLICT,
          PERSON_ERROR_CODES.EXTERNAL_ID_CONFLICT,
          'Person with this external reference already exists.',
        );
      }
      if (this.isLaborTypeViolation(error)) {
        throw new PersonHttpException(
          HttpStatus.BAD_REQUEST,
          PERSON_ERROR_CODES.LABOR_TYPE_NOT_FOUND,
          'Operational labor type not found.',
        );
      }
      throw error;
    }
  }

  async deactivate(
    actor: IdentityAuthzContext,
    personId: string,
    version: number,
    reason: string,
  ): Promise<PersonResponse> {
    this.assertValidPersonId(personId);

    try {
      assertDeactivationReason(reason);
    } catch (error) {
      if (error instanceof PersonValidationError) {
        throw new PersonHttpException(
          mapPersonValidationCodeToStatus(error.code),
          PERSON_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.peopleRepository.findById(personId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.PeoplePersonDeactivate,
      toResourceContextFromPerson(existing),
      undefined,
    );

    const updated = await this.peopleRepository.setStatus(
      personId,
      version,
      'INACTIVE',
      actor.identityId,
      reason,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new PersonHttpException(
        HttpStatus.CONFLICT,
        PERSON_ERROR_CODES.VERSION_CONFLICT,
        'Person was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new PersonHttpException(
        HttpStatus.CONFLICT,
        PERSON_ERROR_CODES.INVALID_STATE,
        'Person is already inactive.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.PeoplePersonDeactivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PeoplePerson,
      resourceId: personId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { reason },
    });

    return toPersonResponse(updated);
  }

  async activate(
    actor: IdentityAuthzContext,
    personId: string,
    version: number,
  ): Promise<PersonResponse> {
    this.assertValidPersonId(personId);

    const existing = await this.peopleRepository.findById(personId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.PeoplePersonActivate,
      toResourceContextFromPerson(existing),
      undefined,
    );

    const updated = await this.peopleRepository.setStatus(
      personId,
      version,
      'ACTIVE',
      actor.identityId,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new PersonHttpException(
        HttpStatus.CONFLICT,
        PERSON_ERROR_CODES.VERSION_CONFLICT,
        'Person was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new PersonHttpException(
        HttpStatus.CONFLICT,
        PERSON_ERROR_CODES.INVALID_STATE,
        'Person is already active.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.PeoplePersonActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.PeoplePerson,
      resourceId: personId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toPersonResponse(updated);
  }

  async listHistory(
    actor: IdentityAuthzContext,
    personId: string,
  ): Promise<{ items: PersonHistoryEventResponse[] }> {
    this.assertValidPersonId(personId);
    const person = await this.peopleRepository.findById(personId);
    if (!person) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.PeoplePersonRead,
      toResourceContextFromPerson(person),
      undefined,
    );

    const rows = await this.peopleRepository.listHistory(personId);
    return { items: rows.map(toPersonHistoryEventResponse) };
  }

  private async assertAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    context: ReturnType<typeof toResourceContextFromPerson> | undefined,
    requiredScope: typeof AUTHZ_SCOPES.Global | undefined,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.PeoplePerson,
        context,
      },
      { audit: true },
    );

    if (decision.result === 'DENY') {
      throw this.denied();
    }

    if (requiredScope === AUTHZ_SCOPES.Global) {
      const grants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        action,
        AUTHZ_RESOURCE_TYPES.PeoplePerson,
      );
      const hasGlobal = grants.some(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
      );
      if (!hasGlobal) {
        throw this.denied();
      }
    }
  }

  private assertValidPersonId(personId: string): void {
    try {
      this.scopeEnforcement.assertValidPersonResourceId(personId);
    } catch {
      throw this.notFound();
    }
  }

  private denied(): PersonHttpException {
    return new PersonHttpException(
      HttpStatus.FORBIDDEN,
      PERSON_ERROR_CODES.DENIED,
      'Access denied.',
    );
  }

  private notFound(): PersonHttpException {
    return new PersonHttpException(
      HttpStatus.NOT_FOUND,
      PERSON_ERROR_CODES.NOT_FOUND,
      'Person not found.',
    );
  }

  private isUniqueExternalIdViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23505' &&
      (pgError.constraint?.includes('external_erp_id') ?? false)
    );
  }

  private isLaborTypeViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23503' &&
      (pgError.constraint?.includes('labor_type') ?? false)
    );
  }
}
