import type { MetaEntitySchema, MetaTransition } from './types';

/**
 * Barra de ações dirigida pelo WORKFLOW.
 *
 * Os botões são as transições válidas para o estado atual, filtradas pela permissão que o
 * SERVIDOR já avaliou (`allowed`). A engine não conhece comando algum: `prepare`, `activate`
 * e `void` são apenas linhas de `meta.workflow_transitions`.
 *
 * Adicionar um estado novo ao workflow faz o botão aparecer aqui sem nenhuma alteração de
 * código — é a prova ao vivo 2.
 */
export type ActionBarProps = {
  schema: MetaEntitySchema;
  /** Estado atual do registro. */
  currentState: string;
  onCommand: (command: string, transition: MetaTransition) => void;
  busy?: boolean;
};

export function ActionBar({
  schema,
  currentState,
  onCommand,
  busy = false,
}: ActionBarProps): React.ReactElement | null {
  const workflow = schema.workflow;
  if (!workflow) {
    return null;
  }

  const available = workflow.transitions
    .filter((transition) => transition.fromStates.includes(currentState))
    .filter((transition) => transition.allowed)
    .slice()
    .sort((left, right) => left.buttonOrder - right.buttonOrder);

  if (available.length === 0) {
    return (
      <p className="text-sm text-gray-600" data-testid="action-bar-empty">
        Nenhuma ação disponível para o estado atual.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2" data-testid="action-bar" data-state={currentState}>
      {available.map((transition) => (
        <li key={transition.command}>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            data-command={transition.command}
            title={`Permissão exigida: ${transition.permission}`}
            onClick={() => onCommand(transition.command, transition)}
          >
            {transition.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Transições que EXISTEM no workflow mas não valem agora.
 *
 * A engine expõe isso em vez de esconder: a tela de detalhe usa para explicar por que um
 * comando não está disponível (estado errado vs. permissão faltando), que é a diferença
 * entre "não posso" e "não agora".
 */
export function describeUnavailableTransitions(
  schema: MetaEntitySchema,
  currentState: string,
): Array<{ transition: MetaTransition; reason: 'wrong_state' | 'missing_permission' }> {
  const workflow = schema.workflow;
  if (!workflow) {
    return [];
  }
  return workflow.transitions
    .filter((transition) => !transition.fromStates.includes(currentState) || !transition.allowed)
    .map((transition) => ({
      transition,
      reason: transition.fromStates.includes(currentState)
        ? ('missing_permission' as const)
        : ('wrong_state' as const),
    }));
}
