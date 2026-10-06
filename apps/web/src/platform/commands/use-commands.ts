/**
 * COMMAND REGISTRY — LIGACAO COM REACT
 *
 * A tela declara o contexto; o registry devolve o que renderizar. Nenhuma pagina monta botao.
 *
 * O CONTEXTO E COMPARADO POR VALOR, NAO POR IDENTIDADE. Sem isso, um contexto montado inline
 * (`{ entity: 'finance.payable', state }`) recria o objeto a cada render e o `useMemo` abaixo
 * recalcularia sempre — barato aqui, mas o `execute` devolvido mudaria de identidade e quebraria
 * `useEffect` de quem depende dele. A serializacao e a chave estavel.
 */

import { useCallback, useMemo } from 'react';
import { executeCommandById, resolveCommandsForContext } from './registry';
import type {
  CommandAvailability,
  CommandContext,
  ResolvedCommand,
} from './types';

export type UseCommandsResult = {
  /** Comandos visiveis (disponiveis + desabilitados com motivo). `hidden` ja foi removido. */
  commands: ResolvedCommand[];
  /** Só os executaveis agora. */
  available: ResolvedCommand[];
  /** Executa pelo id. `false` = indisponivel, inexistente ou sem handler. */
  execute: (id: string, overrides?: Partial<CommandContext>) => Promise<boolean>;
};

/**
 * Chave estavel do contexto para memoizacao.
 *
 * `capabilities` e um Set, que nao serializa em JSON — vira lista ordenada. Ordenar e essencial:
 * dois conjuntos iguais inseridos em ordem diferente sao a MESMA permissao, e sem ordenar a chave
 * mudaria e invalidaria o memo sem motivo.
 */
function contextKey(context: CommandContext): string {
  const capabilities = context.capabilities
    ? [...context.capabilities].sort().join(',')
    : '\u0000unknown';
  const inputs = context.inputs
    ? Object.keys(context.inputs)
        .sort()
        .map((key) => `${key}=${context.inputs?.[key] ?? ''}`)
        .join('&')
    : '';
  return [
    context.entity,
    context.view ?? '',
    context.state ?? '',
    context.lifecycle ?? '',
    context.target?.id ?? '',
    capabilities,
    inputs,
  ].join('|');
}

export function useCommands(context: CommandContext): UseCommandsResult {
  const key = contextKey(context);

  /**
   * O contexto entra por REFERENCIA em `contextRef`, e o memo depende de `key` (valor). Assim a
   * lista so recalcula quando algo relevante muda de fato, e nao a cada render do pai.
   */
  const commands = useMemo(
    () => resolveCommandsForContext(context),
    [key],
  );

  const available = useMemo(
    () => commands.filter((command) => command.availability.status === 'available'),
    [commands],
  );

  const execute = useCallback(
    async (id: string, overrides?: Partial<CommandContext>): Promise<boolean> => {
      return executeCommandById(id, { ...context, ...overrides });
    },
    [key],
  );

  return { commands, available, execute };
}

/** Veredito de um comando especifico (para bloqueio de formulario, atalho, guard de rota). */
export function availabilityOf(
  commands: ResolvedCommand[],
  id: string,
): CommandAvailability | null {
  return commands.find((command) => command.definition.id === id)?.availability ?? null;
}
