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

/**
 * Versao EM LOTE de `hasPolicyAndGrantScope` — um veredito por contexto, com as leituras de
 * grants feitas UMA vez.
 *
 * O veredito por contexto e EXATAMENTE o mesmo de `hasPolicyAndGrantScope`: decisao do PDP
 * (`decideBatch`) E casamento contra os grants ativos do ator. A segunda condicao e preservada de
 * proposito — e ela que hoje impede que uma capability derivada de role (sem grant direto de
 * escopo) libere uma linha. Sem essa condicao a regra de acesso ficaria MAIS AMPLA.
 */
export async function hasPolicyAndGrantScopeBatch(
  deps: DomainGrantAuthzDeps,
  input: {
    actor: IdentityAuthzContext;
    action: AuthzAction;
    resourceType: AuthzResourceType;
    contexts: Array<AuthzResourceContext | undefined>;
    audit?: boolean;
  },
): Promise<boolean[]> {
  if (input.contexts.length === 0) {
    return [];
  }

  const decisions = await deps.policyDecisionPoint.decideBatch(
    input.actor,
    { action: input.action, resourceType: input.resourceType },
    input.contexts,
    { audit: input.audit },
  );

  const grants = await deps.authorizationRepository.findActiveGrants(
    input.actor.identityId,
    input.action,
    input.resourceType,
  );

  return input.contexts.map(
    (context, index) =>
      decisions[index]?.result !== 'DENY' &&
      grants.some((grant) =>
        grantMatchesResourceContext({
          grant,
          identityId: input.actor.identityId,
          context,
        }),
      ),
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