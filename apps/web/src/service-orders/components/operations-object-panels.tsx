import { Link } from 'react-router-dom';
import { STAGE_MARK, STAGE_TONE, type OperationalStageStep } from '../types/operations.types';

/**
 * BARRA DE PROCESSO — onde a ordem está, sem reduzir o processo a um status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA BARRA EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Antes, o operador via `status = IN_EXECUTION` e nada mais. Esse único valor não
 * distingue "despachada e ainda não chegou" de "em execução com realizado parcial"
 * de "concluída mas com execução não fechada" — e cada uma dessas situações exige
 * uma ação DIFERENTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não calcula estágio. Recebe `process` já derivado pelo backend (de fatos
 * persistidos) e apenas desenha. Um estágio "pronto" na tela que o backend não
 * conhece seria uma segunda verdade — e esta capability existe justamente para
 * eliminar isso.
 */
export function ProcessBar({
  steps,
  title = 'Service to cash',
}: {
  steps: readonly OperationalStageStep[];
  title?: string;
}) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <nav aria-label={title} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </span>
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {steps.map((step) => (
          <li key={step.stage} className="flex items-center gap-1">
            <span aria-hidden="true" className={`text-xs ${STAGE_TONE[step.state]}`}>
              {STAGE_MARK[step.state]}
            </span>
            {step.href ? (
              <Link
                to={step.href}
                className={`text-xs ${STAGE_TONE[step.state]} hover:underline`}
                title={step.detail ?? step.label}
              >
                {step.label}
              </Link>
            ) : (
              <span
                className={`text-xs ${STAGE_TONE[step.state]}`}
                title={step.detail ?? step.label}
              >
                {step.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * EIXOS DE ESTADO INDEPENDENTES.
 *
 * A object page não reduz o processo a `status`. Cada eixo declara sua própria
 * verdade — e quando o domínio dono não publicou fato, o valor diz isso
 * (`NOT_APPLICABLE`, `NOT_ELIGIBLE`) em vez de mostrar um verde falso.
 */
export function StatusAxes({ statuses }: { statuses: Record<string, string> }) {
  const order = [
    ['operational', 'Operacional'],
    ['planning', 'Planejamento'],
    ['reservation', 'Reserva'],
    ['dispatch', 'Despacho'],
    ['execution', 'Execução'],
    ['actuals', 'Realizado'],
    ['measurement', 'Medição'],
    ['billing', 'Faturamento'],
    ['accounting', 'Contabilidade'],
  ] as const;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3 lg:grid-cols-5">
      {order.map(([key, label]) => {
        const value = statuses[key];
        if (!value) {
          return null;
        }
        return (
          <div key={key} className="flex items-baseline justify-between gap-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              {label}
            </dt>
            <dd className="truncate font-semibold text-gray-800">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * PAINEL DE PRÓXIMA AÇÃO.
 *
 * A explicação e a lista de consequências vêm do BACKEND (`decisionExplanation`).
 * A tela não as monta — se um dia a conclusão deixar de congelar os realizados, o
 * texto muda na origem e esta superfície muda junto.
 */
export function NextActionPanel({
  title = 'Próxima ação',
  actionLabel,
  explanation,
  checklist,
  consequences,
  disabled,
  busy,
  onRun,
  href,
}: {
  title?: string;
  actionLabel: string | null;
  explanation: string | null;
  checklist?: Array<{ label: string; done: boolean }>;
  consequences?: readonly { code: string; label: string }[];
  disabled?: boolean;
  busy?: boolean;
  onRun?: () => void;
  href?: string;
}) {
  const hasAction = Boolean(actionLabel);

  return (
    <section aria-label={title} className="rounded border border-gray-200 bg-white p-3 text-xs">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>

      {hasAction ? (
        <p className="text-sm font-semibold text-gray-900">{actionLabel}</p>
      ) : (
        <p className="text-sm text-gray-600">Nenhuma ação pendente.</p>
      )}

      {explanation ? <p className="mt-1 text-gray-600">{explanation}</p> : null}

      {checklist && checklist.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={item.done ? 'text-emerald-600' : 'text-amber-600'}
              >
                {item.done ? '✓' : '!'}
              </span>
              <span className={item.done ? 'text-gray-600' : 'font-medium text-gray-900'}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasAction && onRun ? (
        <button
          type="button"
          onClick={onRun}
          disabled={disabled || busy}
          className="mt-2 rounded bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Executando…' : actionLabel}
        </button>
      ) : null}

      {hasAction && !onRun && href ? (
        <Link
          to={href}
          className="mt-2 inline-block rounded bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white"
        >
          {actionLabel}
        </Link>
      ) : null}

      {consequences && consequences.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Ao concluir
          </p>
          <ul className="space-y-0.5 text-gray-600">
            {consequences.map((item) => (
              <li key={item.code}>→ {item.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
