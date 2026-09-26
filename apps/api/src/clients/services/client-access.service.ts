import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';

import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { toResourceContextFromClient } from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  assertCreateClientInput,
  assertDeactivationReason,
  assertUpdateClientInput,
  ClientValidationError,
  type CreateClientInput,
  type UpdateClientInput,
} from '../domain/client.validation';
import { CLIENT_ERROR_CODES } from '../errors/client-error-codes';
import { ClientHttpException } from '../errors/client-http.exception';
import { mapValidationCodeToStatus } from '../errors/client-validation-status';
import { ClientsRepository } from '../repositories/clients.repository';
import { CLIENT_STATUSES } from '../domain/client-status';
import {
  buildClientListSqlParts,
  resolveClientListQuery,
  type ClientListRequest,
} from '../domain/client-list.query';
import {
  toClientResponse,
  toClientSummaryResponse,
  type ClientListResponse,
  type ClientResponse,
} from '../serializers/client-response.serializer';
import type {
  CommercialClientPort,
  CommercialClientView,
} from '../../platform/bounded-contexts/enterprise-core-ports';

@Injectable()
export class ClientAccessService implements CommercialClientPort {
  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeContextRepository: ScopeContextRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(actor: IdentityAuthzContext, input: CreateClientInput): Promise<ClientResponse> {
    await this.assertAction(actor, AUTHZ_ACTIONS.ClientCreate, undefined, AUTHZ_SCOPES.Global);

    let normalizedTaxId: string;
    try {
      normalizedTaxId = assertCreateClientInput(input);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    try {
      const created = await this.clientsRepository.create(
        {
          legalName: input.legalName,
          tradeName: input.tradeName,
          normalizedTaxId,
          externalErpId: input.externalErpId,
          contacts: input.contacts,
          addresses: input.addresses,
          purchaseOrderRequirement: input.purchaseOrderRequirement,
        },
        async (client, clientId) => {
          await this.scopeContextRepository.insertScopeRef(client, AUTHZ_SCOPES.Client, clientId);
        },
      );

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.ClientCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
        resourceId: created.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });

      return toClientResponse(created);
    } catch (error) {
      if (this.isUniqueTaxIdViolation(error)) {
        throw new ClientHttpException(
          HttpStatus.CONFLICT,
          CLIENT_ERROR_CODES.TAX_ID_CONFLICT,
          'Client with this tax id already exists.',
        );
      }
      throw error;
    }
  }

  async getById(actor: IdentityAuthzContext, clientId: string): Promise<ClientResponse> {
    this.assertValidClientId(clientId);
    const client = await this.clientsRepository.findById(clientId);
    if (!client) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientRead,
      toResourceContextFromClient(client),
      undefined,
    );
    return toClientResponse(client);
  }

  async list(actor: IdentityAuthzContext, request: ClientListRequest): Promise<ClientListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ClientList,
      AUTHZ_RESOURCE_TYPES.Client,
    );
    if (grants.length === 0) {
      throw this.denied();
    }

    const scopeFilter = this.scopeEnforcement.buildClientListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw this.denied();
    }

    const query = resolveClientListQuery(request);
    const sqlParts = buildClientListSqlParts(query, scopeFilter);

    const items = await this.clientsRepository.listSummaries(sqlParts, query.limit, query.offset);

    /**
     * Primeira página incompleta prova que o conjunto acabou: não há linha alguma depois dela, logo
     * o total é exatamente o que foi devolvido. Evita o COUNT quando ele seria redundante, sem
     * nunca devolver um total aproximado quando a página está cheia.
     */
    const total =
      query.offset === 0 && items.length < query.limit
        ? items.length
        : await this.clientsRepository.countClientList(sqlParts.whereClause, sqlParts.params);

    return {
      items: items.map(toClientSummaryResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async update(
    actor: IdentityAuthzContext,
    clientId: string,
    input: UpdateClientInput,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    try {
      assertUpdateClientInput(input);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientUpdate,
      toResourceContextFromClient(existing),
      undefined,
    );

    const updated = await this.clientsRepository.update({
      clientId,
      expectedVersion: input.version,
      legalName: input.legalName,
      tradeName: input.tradeName,
      externalErpId: input.externalErpId,
      contacts: input.contacts,
      addresses: input.addresses,
      purchaseOrderRequirement: input.purchaseOrderRequirement,
    });

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientUpdate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toClientResponse(updated);
  }

  async deactivate(
    actor: IdentityAuthzContext,
    clientId: string,
    version: number,
    reason: string,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    try {
      assertDeactivationReason(reason);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        throw new ClientHttpException(
          mapValidationCodeToStatus(error.code),
          CLIENT_ERROR_CODES.VALIDATION_FAILED,
          'Invalid request body.',
        );
      }
      throw error;
    }

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientDeactivate,
      toResourceContextFromClient(existing),
      undefined,
    );

    const updated = await this.clientsRepository.setStatus(
      clientId,
      version,
      'INACTIVE',
      actor.identityId,
      reason,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Client is already inactive.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientDeactivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { reason },
    });

    return toClientResponse(updated);
  }

  async activate(
    actor: IdentityAuthzContext,
    clientId: string,
    version: number,
  ): Promise<ClientResponse> {
    this.assertValidClientId(clientId);

    const existing = await this.clientsRepository.findById(clientId);
    if (!existing) {
      throw this.notFound();
    }

    await this.assertAction(
      actor,
      AUTHZ_ACTIONS.ClientActivate,
      toResourceContextFromClient(existing),
      undefined,
    );

    const updated = await this.clientsRepository.setStatus(
      clientId,
      version,
      'ACTIVE',
      actor.identityId,
    );

    if (updated === null) {
      throw this.notFound();
    }
    if (updated === 'VERSION_CONFLICT') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.VERSION_CONFLICT,
        'Client was modified by another request.',
      );
    }
    if (updated === 'INVALID_STATE') {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INVALID_STATE,
        'Client is already active.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ClientActivate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Client,
      resourceId: clientId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    return toClientResponse(updated);
  }

  async findPublishedById(clientId: string): Promise<CommercialClientView | null> {
    const row = await this.clientsRepository.findPublishedById(clientId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      purchaseOrderRequirement: row.purchase_order_requirement,
    };
  }

  async requireActive(clientId: string): Promise<CommercialClientView> {
    const published = await this.findPublishedById(clientId);
    if (!published) {
      throw this.notFound();
    }
    if (published.status !== CLIENT_STATUSES.Active) {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INACTIVE,
        'Client is inactive.',
      );
    }
    return published;
  }

  async assertNotInactive(clientId: string): Promise<void> {
    const published = await this.findPublishedById(clientId);
    if (published && published.status !== CLIENT_STATUSES.Active) {
      throw new ClientHttpException(
        HttpStatus.CONFLICT,
        CLIENT_ERROR_CODES.INACTIVE,
        'Client is inactive.',
      );
    }
  }

  private async assertAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    context: ReturnType<typeof toResourceContextFromClient> | undefined,
    requiredScope: typeof AUTHZ_SCOPES.Global | undefined,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.Client,
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
        AUTHZ_RESOURCE_TYPES.Client,
      );
      const hasGlobal = grants.some(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
      );
      if (!hasGlobal) {
        throw this.denied();
      }
    }
  }

  private assertValidClientId(clientId: string): void {
    try {
      this.scopeEnforcement.assertValidClientResourceId(clientId);
    } catch {
      throw this.notFound();
    }
  }

  private denied(): ClientHttpException {
    return new ClientHttpException(
      HttpStatus.FORBIDDEN,
      CLIENT_ERROR_CODES.DENIED,
      'Access denied.',
    );
  }

  private notFound(): ClientHttpException {
    return new ClientHttpException(
      HttpStatus.NOT_FOUND,
      CLIENT_ERROR_CODES.NOT_FOUND,
      'Client not found.',
    );
  }

  private isUniqueTaxIdViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError.code === '23505' &&
      (pgError.constraint === 'clients_normalized_tax_id_uidx' ||
        (typeof pgError.constraint === 'string' && pgError.constraint.includes('tax_id')))
    );
  }
}
