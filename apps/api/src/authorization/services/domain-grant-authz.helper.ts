import { AuthorizationRepository } from '../repositories/authorization.repository';
import { grantMatchesResourceContext } from '../scope/scope-matcher';
import { PolicyDecisionPointService } from './policy-decision-point.service';
import type { AuthzAction } from '../types/authz-actions';
import type { IdentityAuthzContext } from '../types/authz-decision';
import type { AuthzResourceType } from '../types/authz-resources';
import type { AuthzResourceContext } from '../types/authz-scopes';

export type DomainGrantAuthzDeps = {
  authorizationRepository: AuthorizationRepository;
  policyDecisionPoint: PolicyDecisionPointService;
};

/**
 * Avaliacao NAO lancante da mesma decisao usada por `assertPolicyAndGrantScope`.
 *
 * Existe para quem precisa FILTRAR uma lista (por exemplo, os elos da cadeia relacionada de um
 * pedido de compra) em vez de negar a operacao inteira. E o mesmo caminho autoritativo —
 * decisao do PDP + grants ativos casados contra o contexto do recurso — sem uma segunda regra.
 */
export async function hasPolicyAndGrantScope(
  deps: DomainGrantAuthzDeps,
  input: {
    actor: IdentityAuthzContext;
    action: AuthzAction;
    resourceType: AuthzResourceType;
    context?: AuthzResourceContext;
  },
): Promise<boolean> {
  const decision = await deps.policyDecisionPoint.decide(
    input.actor,
    {
      action: input.action,
      resourceType: input.resourceType,
      context: input.context,
    },
    { audit: true },
  );
  if (decision.result === 'DENY') {
    return false;
  }

  const grants = await deps.authorizationRepository.findActiveGrants(
    input.actor.identityId,
    input.action,
    input.resourceType,
  );
  return grants.some((grant) =>
    grantMatchesResourceContext({
      grant,
      identityId: input.actor.identityId,
      context: input.context,
    }),
  );
}

export async function assertPolicyAndGrantScope(
  deps: DomainGrantAuthzDeps,
  input: {
    actor: IdentityAuthzContext;
    action: AuthzAction;
    resourceType: AuthzResourceType;
    context?: AuthzResourceContext;
    onDenied: () => Error;
  },
): Promise<void> {
  if (!(await hasPolicyAndGrantScope(deps, input))) {
    throw input.onDenied();
  }
}