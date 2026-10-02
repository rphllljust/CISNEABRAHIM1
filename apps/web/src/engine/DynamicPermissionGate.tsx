import type { ReactNode } from 'react';
import type { MetaEntitySchema } from './types';

/**
 * Portão de permissão da engine.
 *
 * A decisão de AUTORIZAÇÃO é do servidor: `meta.permissions[].allowed` e
 * `workflow.transitions[].allowed` já chegam calculados a partir dos grants reais do ator.
 * Este componente NÃO autoriza nada — ele apenas decide o que desenhar, e é a segunda
 * barreira, não a primeira.
 *
 * Consequência declarada: esconder aqui não protege o dado. O campo fora do nível do ator nem
 * chega ao cliente (o servidor o removeu do schema), e o comando negado responde 403 se
 * chamado direto. Isto é UI.
 */
export type DynamicPermissionGateProps = {
  schema: MetaEntitySchema;
  /** Ação de `meta.permissions` (ex.: `update`) que o ator precisa ter. */
  action?: string;
  /** Comando de workflow (`meta.workflow_transitions`) que o ator precisa poder executar. */
  command?: string;
  /** Nível de campo (`permLevel`) que o ator precisa alcançar. */
  permLevel?: number;
  /** O que renderizar quando NÃO há permissão. Ausente = nada. */
  fallback?: ReactNode;
  children: ReactNode;
};

export function DynamicPermissionGate({
  schema,
  action,
  command,
  permLevel,
  fallback = null,
  children,
}: DynamicPermissionGateProps): React.ReactElement | null {
  if (!canRender(schema, { action, command, permLevel })) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

/**
 * Avalia as três formas de permissão declaradas pelo metadata store.
 *
 * Fail-closed: quando o critério não está declarado no schema, NEGA. Um gate que abre por
 * ausência de declaração não é gate.
 */
export function canRender(
  schema: MetaEntitySchema,
  criteria: { action?: string; command?: string; permLevel?: number },
): boolean {
  if (criteria.action !== undefined) {
    const permission = schema.permissions.find((entry) => entry.action === criteria.action);
    if (!permission || !permission.allowed) {
      return false;
    }
  }
  if (criteria.command !== undefined) {
    const transition = schema.workflow?.transitions.find(
      (entry) => entry.command === criteria.command,
    );
    if (!transition || !transition.allowed) {
      return false;
    }
  }
  if (criteria.permLevel !== undefined) {
    if (!schema.allowedPermLevels.includes(criteria.permLevel)) {
      return false;
    }
  }
  return true;
}

/** O ator pode executar este comando de workflow? */
export function canRunCommand(schema: MetaEntitySchema, command: string): boolean {
  return canRender(schema, { command });
}
