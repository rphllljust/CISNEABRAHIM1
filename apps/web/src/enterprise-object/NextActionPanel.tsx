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
        'cisne-next-action-rule flex flex-wrap items-center justify-between gap-3 px-3 py-2',
        action.kind === 'waiting' && 'cisne-next-action-rule--waiting',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="cisne-meta-label m-0">
          {action.kind === 'waiting' ? 'Aguardando' : 'Próxima ação'}
        </p>
        <p className="m-0 text-sm font-semibold text-gray-900">{label}</p>
        {description ? <p className="m-0 text-xs text-gray-600">{description}</p> : null}
        {waitingOn ? <p className="m-0 text-xs text-gray-500">Responsável: {waitingOn}</p> : null}
      </div>

      {action.kind === 'act' && action.to ? (
        <Link
          to={action.to}
          className="inline-flex min-h-9 items-center rounded-md bg-cisne-action px-3.5 py-2 text-sm font-semibold text-white no-underline hover:bg-cisne-action-hover"
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
