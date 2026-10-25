import type {
  DetectedVariance,
  MeasurementWorkbenchReadModel,
  WorkbenchItem,
} from '../types/measurement-workbench.types';
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  severityTone,
  stateLabel,
} from '../utils/measurement-workbench-format';
import { cn } from '../../ui/utils/cn';

/**
 * MEDIÇÃO ATIVA — o objeto que está sendo decidido.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * PLANEJADO ≠ REALIZADO ≠ MEDIDO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * São três verdades e cada uma tem sua coluna. A tabela NÃO deriva nenhuma das
 * três: `planned`, `actual` e `measured` chegam separados do backend, e `null`
 * significa "não informado" — nunca zero.
 *
 * Comparar as três num único número é o atalho que apaga a decisão comercial: se
 * `actual = measured` fosse assumido, a diferença entre o que aconteceu e o que
 * foi reconhecido deixaria de existir como problema, e o ajuste — que é uma
 * DECISÃO com autoridade — perderia o objeto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE COMPONENTE NÃO FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não calcula delta nem percentual: ambos vêm em `DetectedVariance`, já com a
 * tolerância aplicada e sua fonte declarada. A tela apresenta.
 */
export function ActiveMeasurementPanel({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  const { identity, businessContext, statuses, quantities, items, variances } = workbench;

  return (
    <div className="overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white">
      <header className="border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="cisne-type-workspace m-0">
            {identity.number ?? identity.orderNumber}
          </h2>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
            {stateLabel(statuses.measurement) ?? statuses.measurement}
          </span>
        </div>
        <dl className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-600">
          <div className="flex gap-1">
            <dt className="text-gray-500">Cliente</dt>
            <dd className="m-0 font-medium text-gray-900">{businessContext.customer ?? '—'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-gray-500">Contrato</dt>
            <dd className="m-0 font-medium text-gray-900">{businessContext.contract ?? '—'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-gray-500">Unidade</dt>
            <dd className="m-0 font-medium text-gray-900">{businessContext.unit}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="measurement-truths-title" className="px-3 py-2">
        <h3 id="measurement-truths-title" className="cisne-meta-label m-0">
          Planejado · Realizado · Medido
        </h3>
        {quantities.lines.length === 0 ? (
          <p className="m-0 mt-1 text-xs text-gray-500">
            A base de medição não possui linha com realizado.
          </p>
        ) : (
          <table className="mt-1 w-full border-collapse text-xs">
            <caption className="sr-only">
              Comparação entre quantidade planejada, realizada e medida por unidade
            </caption>
            <thead>
              <tr className="border-b border-[color:var(--color-divider)] text-left">
                <th scope="col" className="py-1 pr-2 font-medium text-gray-500">
                  Dimensão
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
                  Planejado
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
                  Realizado
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
                  Medido
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-medium text-gray-500">
                  Decisão
                </th>
              </tr>
            </thead>
            <tbody>
              {quantities.lines.map((line) => {
                const variance = findVarianceForLine(variances, line.dimensionKey);
                return (
                  <tr
                    key={line.dimensionKey}
                    className="border-b border-[color:var(--color-divider)] last:border-b-0"
                  >
                    <th scope="row" className="py-1 pr-2 text-left font-medium text-gray-900">
                      {line.label}
                    </th>
                    <td className="py-1 px-2 text-right tabular-nums text-gray-700">
                      {formatQuantity(line.planned) ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-gray-700">
                      {formatQuantity(line.actual) ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-medium text-gray-900">
                      {formatQuantity(line.measured) ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {variance ? (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                            severityClass(variance.severity),
                          )}
                        >
                          {stateLabel(variance.severity) ?? variance.severity}
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-700">Conferido</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="measurement-items-title" className="border-t border-[color:var(--color-divider)] px-3 py-2">
        <h3 id="measurement-items-title" className="cisne-meta-label m-0">
          Itens de medição
        </h3>
        {items.length === 0 ? (
          <p className="m-0 mt-1 text-xs text-gray-500">A medição não possui itens.</p>
        ) : (
          <ItemsTable items={items} currency={workbench.economics.currency} />
        )}
      </section>
    </div>
  );
}

function ItemsTable({ items, currency }: { items: WorkbenchItem[]; currency: string | null }) {
  return (
    <table className="mt-1 w-full border-collapse text-xs">
      <caption className="sr-only">Itens de medição com quantidade realizada, medida e valor</caption>
      <thead>
        <tr className="border-b border-[color:var(--color-divider)] text-left">
          <th scope="col" className="py-1 pr-2 font-medium text-gray-500">
            #
          </th>
          <th scope="col" className="py-1 pr-2 font-medium text-gray-500">
            Unidade
          </th>
          <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
            Realizado
          </th>
          <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
            Medido
          </th>
          <th scope="col" className="py-1 px-2 text-right font-medium text-gray-500">
            Preço
          </th>
          <th scope="col" className="py-1 pl-2 text-right font-medium text-gray-500">
            Valor
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-[color:var(--color-divider)] last:border-b-0">
            <td className="py-1 pr-2 tabular-nums text-gray-500">{item.lineNumber}</td>
            <td className="py-1 pr-2 text-gray-900">
              {item.unitCode}
              {/*
               * ORIGEM do item. `BASIS` significa que ele veio da base publicada
               * pelo fechamento da execução — a linha autoritativa. Um item
               * `LEGACY_EXECUTION_ENTRY` nasceu antes desta capability, e a tela
               * declara isso em vez de fingir que as duas origens são iguais.
               */}
              {item.origin !== 'BASIS' ? (
                <span className="ml-1 text-[10px] text-amber-700">origem histórica</span>
              ) : null}
            </td>
            <td className="py-1 px-2 text-right tabular-nums text-gray-700">
              {formatQuantity(item.actualQuantity) ?? '—'}
            </td>
            <td className="py-1 px-2 text-right tabular-nums font-medium text-gray-900">
              {formatQuantity(item.measuredQuantity) ?? '—'}
            </td>
            <td className="py-1 px-2 text-right tabular-nums text-gray-700">
              {formatMoney(item.unitPrice, null) ?? '—'}
            </td>
            <td className="py-1 pl-2 text-right tabular-nums text-gray-900">
              {formatMoney(item.lineAmount, currency) ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Acha a variação de uma linha comparando a CHAVE da dimensão, não recalculando. */
function findVarianceForLine(variances: DetectedVariance[], dimensionKey: string): DetectedVariance | null {
  return variances.find((item) => item.dimensionKey === dimensionKey) ?? null;
}

function severityClass(severity: string): string {
  switch (severityTone(severity)) {
    case 'critical':
      return 'bg-red-100 text-red-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'info':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/**
 * PAINEL DE VARIAÇÕES — o "por que há problema".
 *
 * Cada linha apresenta exatamente o que o domínio decidiu: as três quantidades,
 * o delta, o percentual com a BASE declarada, a tolerância COM SUA FONTE, a
 * severidade, o impacto financeiro e — o que decide o trabalho — se exige
 * decisão e qual é a resolução recomendada.
 *
 * A `explanation` é publicada pelo backend: é o MESMO texto que a trilha
 * registra. Redigir outra frase aqui criaria duas descrições do mesmo desvio.
 */
export function MeasurementVariancePanel({ variances }: { variances: DetectedVariance[] }) {
  if (variances.length === 0) {
    return (
      <div className="rounded-[10px] border border-[color:var(--color-border-default)] bg-white p-3">
        <h2 className="cisne-type-workspace m-0">Variações</h2>
        <p className="m-0 mt-1 text-xs text-gray-600">
          Nenhuma divergência entre planejado, realizado e medido.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white">
      <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
        Variações
      </h2>
      <ul className="m-0 list-none p-0">
        {variances.map((variance) => (
          <li
            key={`${variance.dimension}-${variance.dimensionKey}`}
            className="border-b border-[color:var(--color-divider)] px-3 py-2 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-gray-900">{variance.dimensionKey}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  severityClass(variance.severity),
                )}
              >
                {stateLabel(variance.severity) ?? variance.severity}
              </span>
            </div>

            <dl className="m-0 mt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 text-[11px]">
              <Fact label="Planejado" value={formatQuantity(variance.plannedValue) ?? '—'} />
              <Fact label="Realizado" value={formatQuantity(variance.actualValue) ?? '—'} />
              <Fact label="Medido" value={formatQuantity(variance.measuredValue) ?? '—'} />
              <Fact label="Delta" value={formatQuantity(variance.absoluteDelta) ?? '—'} />
              <Fact label="Variação" value={formatSignedPercent(variance.percentageDelta) ?? 'sem base'} />
              <Fact
                label="Tolerância"
                value={`${variance.tolerancePercentage.toLocaleString('pt-BR')}% (${variance.toleranceSource})`}
              />
            </dl>

            {variance.financialImpact ? (
              <p className="m-0 mt-1 text-[11px] font-medium text-gray-900">
                Impacto financeiro{' '}
                {formatMoney(variance.financialImpact, variance.currencyCode) ?? variance.financialImpact}
              </p>
            ) : null}

            {/* A EXPLICAÇÃO VEM DO BACKEND. A tela não redige desvio. */}
            <p className="m-0 mt-1 text-[11px] leading-snug text-gray-600">{variance.explanation}</p>

            {variance.requiresDecision ? (
              <p className="m-0 mt-1 text-[11px] font-medium text-amber-800">
                Exige decisão
                {variance.blockingReason ? ` · ${variance.blockingReason}` : ''}
                {variance.recommendedResolution ? ` · ${variance.recommendedResolution}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="m-0 truncate font-medium text-gray-900">{value}</dd>
    </div>
  );
}
