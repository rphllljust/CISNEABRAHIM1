import { cn } from '../ui/utils/cn';
import { toHumanText } from './human-text';
import type { ObjectStateStep } from './types';

/**
 * 2 — ESTADO / FLUXO
 *
 * Representa a state machine REAL do objeto como contexto de processo, nao como badge.
 *
 * REGRAS VINCULANTES:
 * - O front SO REPRESENTA. Nao ha transicao, nao ha calculo de proximo estado e nao ha
 *   etapa inventada. Os passos chegam prontos do adaptador, derivados do backend.
 * - Fluxo exige PROGRESSAO: menos de 2 passos reais nao e fluxo. Nesse caso o componente
 *   nao renderiza nada — o estado continua visivel no cabecalho.
 * - Estado terminal e representado como terminal, nunca como proximo passo do fluxo.
 */

export type ObjectStateFlowProps = {
  steps: ObjectStateStep[];
  /** Id do estado atual. Ausente = nenhum passo e marcado como atual. */
  currentId?: string | null;
  title?: string;
  className?: string;
};

export function ObjectStateFlow({
  steps,
  currentId = null,
  title = 'Fluxo',
  className,
}: ObjectStateFlowProps) {
  const real = steps
    .map((step) => ({ ...step, label: toHumanText(step.label) ?? step.label }))
    .filter((step) => step.label.length > 0);

  if (real.length < 2) {
    return null;
  }

  const currentIndex = currentId ? real.findIndex((step) => step.id === currentId) : -1;

  return (
    <section
      aria-label={title}
      className={cn('rounded-lg bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-900/5', className)}
    >
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1 p-0">
        {real.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = currentIndex >= 0 && index < currentIndex;
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? (
                <span aria-hidden className="px-1 text-xs text-gray-300">
                  →
                </span>
              ) : null}
              <span
                aria-current={isCurrent ? 'step' : undefined}
                title={step.hint}
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  isCurrent && 'bg-brand-600 font-semibold text-white',
                  !isCurrent && isDone && 'bg-gray-100 font-medium text-gray-700',
                  !isCurrent && !isDone && 'text-gray-500',
                  step.terminal && !isCurrent && 'text-gray-600 italic',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
