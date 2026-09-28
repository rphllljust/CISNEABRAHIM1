import { Injectable } from '@nestjs/common';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { AUTHZ_DENY_REASONS } from '../errors/authz-error-codes';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import { grantMatchesResourceContext } from '../scope/scope-matcher';
import type {
  AuthzDecision,
  AuthzEvaluationRequest,
  IdentityAuthzContext,
} from '../types/authz-decision';
import type { AuthzAction } from '../types/authz-actions';
import type { AuthzResourceType } from '../types/authz-resources';
import type { AuthzResourceContext } from '../types/authz-scopes';
import { isOperationalAuthorityAction } from '../domain/operational-authority';

@Injectable()
export class PolicyDecisionPointService {
  constructor(
    private readonly repository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async decide(
    identity: IdentityAuthzContext | null,
    request: AuthzEvaluationRequest,
    options?: { correlationId?: string; audit?: boolean },
  ): Promise<AuthzDecision> {
    if (!identity?.identityId) {
      const decision = this.deny(request, AUTHZ_DENY_REASONS.NO_IDENTITY);
      await this.maybeAudit(identity?.identityId ?? null, request, decision, options);
      return decision;
    }

    try {
      const grants = await this.repository.findActiveGrants(
        identity.identityId,
        request.action,
        request.resourceType,
      );

      // Enforcement efetivo das roles administradas (Access Administration):
      // uma capability de role igual à action pedida e atribuída à identidade
      // (role ACTIVE, assignment ativo) concede acesso com as mesmas regras de
      // escopo das grants. Nada é decidido pelo frontend — só o backend avalia.
      const roleDerived = await this.repository.findRoleDerivedActionRows(
        identity.identityId,
        request.action,
      );
      const matchedDerived = roleDerived.some((row) =>
        grantMatchesResourceContext({
          grant: {
            scope_type: row.scope_type,
            resource_id: row.scope_anchor,
            resource_type: request.resourceType,
          },
          identityId: identity.identityId,
          context: request.context,
        }),
      );

      if (grants.length === 0 && !matchedDerived) {
        const decision = this.deny(request, AUTHZ_DENY_REASONS.NO_ACTIVE_GRANT);
        await this.maybeAudit(identity.identityId, request, decision, options);
        return decision;
      }

      const matchedDirect = grants.some((grant) =>
        grantMatchesResourceContext({
          grant,
          identityId: identity.identityId,
          context: request.context,
        }),
      );

      if (!matchedDirect && !matchedDerived) {
        const decision = this.deny(request, AUTHZ_DENY_REASONS.SCOPE_MISMATCH);
        await this.maybeAudit(identity.identityId, request, decision, options);
        return decision;
      }

      const decision = this.allow(request);
      await this.maybeAudit(identity.identityId, request, decision, options);
      return decision;
    } catch {
      const decision = this.deny(request, AUTHZ_DENY_REASONS.FAIL_CLOSED);
      await this.maybeAudit(identity.identityId, request, decision, options);
      return decision;
    }
  }

  /**
   * AVALIACAO EM LOTE — mesmo veredito de `decide`, com as leituras de grants hoisted.
   *
   * Existe para FILTRAR listagens: `decide` por linha custava 2 leituras + 1 insert de auditoria
   * POR LINHA (medido: 1.525 queries para 50 recebiveis). Aqui as mesmas fontes sao lidas UMA vez
   * e cada contexto e avaliado com os MESMOS helpers (`grantMatchesResourceContext`), portanto o
   * veredito por linha e identico ao de `decide` — nenhuma regra de escopo nova e inventada.
   *
   * AUDITORIA: a avaliacao em lote e um unico acesso. A auditoria da decisao passa a ser UMA por
   * lote (`options.audit !== false`) em vez de uma por linha; quem ja audita a leitura no nivel da
   * lista (ex.: `assertReceivableList`) passa `audit: false` para nao duplicar o mesmo evento.
   */
  async decideBatch(
    identity: IdentityAuthzContext | null,
    request: { action: AuthzAction; resourceType: AuthzResourceType },
    contexts: Array<AuthzResourceContext | undefined>,
    options?: { correlationId?: string; audit?: boolean },
  ): Promise<AuthzDecision[]> {
    if (contexts.length === 0) {
      return [];
    }

    const batchRequest: AuthzEvaluationRequest = {
      action: request.action,
      resourceType: request.resourceType,
      context: contexts[0],
    };

    if (!identity?.identityId) {
      await this.maybeAudit(null, batchRequest, this.deny(batchRequest, AUTHZ_DENY_REASONS.NO_IDENTITY), options);
      return contexts.map(() => this.deny(batchRequest, AUTHZ_DENY_REASONS.NO_IDENTITY));
    }

    try {
      const grants = await this.repository.findActiveGrants(
        identity.identityId,
        request.action,
        request.resourceType,
      );
      const roleDerived = await this.repository.findRoleDerivedActionRows(
        identity.identityId,
        request.action,
      );

      const decideContext = (context: AuthzResourceContext | undefined): AuthzDecision => {
        const evaluated: AuthzEvaluationRequest = {
          action: request.action,
          resourceType: request.resourceType,
          context,
        };
        const matchedDerived = roleDerived.some((row) =>
          grantMatchesResourceContext({
            grant: {
              scope_type: row.scope_type,
              resource_id: row.scope_anchor,
              resource_type: request.resourceType,
            },
            identityId: identity.identityId,
            context,
          }),
        );
        if (grants.length === 0 && !matchedDerived) {
          return this.deny(evaluated, AUTHZ_DENY_REASONS.NO_ACTIVE_GRANT);
        }
        const matchedDirect = grants.some((grant) =>
          grantMatchesResourceContext({ grant, identityId: identity.identityId, context }),
        );
        if (!matchedDirect && !matchedDerived) {
          return this.deny(evaluated, AUTHZ_DENY_REASONS.SCOPE_MISMATCH);
        }
        return this.allow(evaluated);
      };

      const decisions = contexts.map(decideContext);
      const denied = decisions.find((decision) => decision.result === 'DENY');
      if (options?.audit !== false) {
        await this.repository.insertDecisionAudit({
          identityId: identity.identityId,
          action: request.action,
          resourceType: request.resourceType,
          resourceId: batchRequest.context?.resourceId,
          decision: denied ? 'DENY' : 'ALLOW',
          reasonCode: denied?.reasonCode ?? 'ALLOW',
          correlationId: options?.correlationId,
        });
      }
      return decisions;
    } catch {
      const decision = this.deny(batchRequest, AUTHZ_DENY_REASONS.FAIL_CLOSED);
      await this.maybeAudit(identity.identityId, batchRequest, decision, options);
      return contexts.map(() => decision);
    }
  }

  private allow(request: AuthzEvaluationRequest): AuthzDecision {
    return {
      result: 'ALLOW',
      reasonCode: 'ALLOW',
      action: request.action,
      resourceType: request.resourceType,
    };
  }

  private deny(request: AuthzEvaluationRequest, reasonCode: string): AuthzDecision {
    return {
      result: 'DENY',
      reasonCode,
      action: request.action,
      resourceType: request.resourceType,
    };
  }

  private async maybeAudit(
    identityId: string | null,
    request: AuthzEvaluationRequest,
    decision: AuthzDecision,
    options?: { correlationId?: string; audit?: boolean },
  ): Promise<void> {
    if (options?.audit === false) {
      return;
    }

    await this.repository.insertDecisionAudit({
      identityId,
      action: request.action,
      resourceType: request.resourceType,
      resourceId: request.context?.resourceId,
      decision: decision.result,
      reasonCode: decision.reasonCode,
      correlationId: options?.correlationId,
    });

    if (decision.result === 'DENY') {
      await this.securityAudit.record({
        actorIdentityId: identityId,
        action: SECURITY_AUDIT_ACTIONS.AuthzDenied,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.AuthzDecision,
        resourceId: request.context?.resourceId ?? null,
        outcome: SECURITY_AUDIT_OUTCOMES.Denied,
        correlationId: options?.correlationId,
        reasonCode: decision.reasonCode,
        classification: isOperationalAuthorityAction(request.action)
          ? SECURITY_AUDIT_CLASSIFICATIONS.Critical
          : SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          evaluated_action: request.action,
          evaluated_resource_type: request.resourceType,
        },
      });
    }
  }
}
