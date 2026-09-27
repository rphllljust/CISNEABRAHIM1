import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { cn } from '../ui/utils/cn';
import { toHumanText } from './human-text';
import type { NextAction } from './types';

/**
 * 7 — PROXIMA ACAO
 *
 * Responde "o que normalmente acontece agora?" a partir de state machine + capability
 * + dado real. Sem IA, sem score, sem texto generico.
 *
 * `action === null` significa "nao ha proxima acao declarada" e a secao inteira
 * desaparece. Nao existe fallback como "Nenhuma ação disponível" — isso seria inventar
 * uma resposta de processo que o backend nao deu.
 *
 * `kind: 'waiting'` e uma resposta legitima de processo: "Aguardar aceite do cliente".
 * Ela diz de quem se espera o proximo passo, e nao oferece botao nenhum.
 */

export type NextActionPanelProps = {
  action: NextAction | null | undefined;
  className?: string;
};

export function NextActionPanel({ action, className }: NextActionPanelProps) {
  if (!action) {
    return null;
  }

  const label = toHumanText(action.label) ?? action.label;
  const description = toHumanText(action.description);
  const waitingOn = toHumanText(action.waitingOn);

  return (
    <section
      aria-label="Próxima ação"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border-l-2 bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-900/5',
        action.kind === 'waiting' ? 'border-l-gray-300' : 'border-l-brand-600',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
          {action.kind === 'waiting' ? 'Aguardando' : 'Próxima ação'}
        </p>
        <p className="m-0 text-sm font-semibold text-gray-900">{label}</p>
        {description ? <p className="m-0 text-xs text-gray-600">{description}</p> : null}
        {waitingOn ? <p className="m-0 text-xs text-gray-500">Responsável: {waitingOn}</p> : null}
      </div>

      {action.kind === 'act' && action.to ? (
        <Link
          to={action.to}
          className="inline-flex min-h-9 items-center rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-700"
        >
          {label}
        </Link>
      ) : null}
      {action.kind === 'act' && !action.to && action.onSelect ? (
        <Button type="button" onClick={action.onSelect}>
          {label}
        </Button>
      ) : null}
    </section>
  );
}
