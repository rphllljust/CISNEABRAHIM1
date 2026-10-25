import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ModulePage, ModulePageHeader } from '../../ui';
import { useRevenueLeakage } from '../hooks/useMeasurementWorkbench';
import {
  formatDuration,
  formatMoney,
  severityTone,
  stageLabel,
} from '../utils/measurement-workbench-format';
import { cn } from '../../ui/utils/cn';

/**
 * REVENUE LEAKAGE — a lacuna de receita por estágio da cadeia.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * NÃO É UM SEGUNDO SISTEMA DE FATURAMENTO
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * É uma PROJEÇÃO sobre a cadeia: para cada valor de serviço criado, em que
 * estágio ele parou e quanto está parado ali. O sistema de faturamento continua
 * sendo o existente; esta tela mede o que NÃO chegou até ele.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O TOTAL É DO BACKEND, E O DRILL-DOWN RECONSTRÓI O MESMO NÚMERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O total NÃO é somado no navegador: uma soma local sobre listas paginadas seria
 * falsa por construção, porque a página não contém todos os registros. `total`
 * vem calculado sobre o conjunto inteiro, e `positions` é literalmente a lista
 * que produz aquele total.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NÚMERO SEM DRILL-DOWN NÃO TEM VALOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada posição carrega cliente, contrato, estágio, idade, valor, dono,
 * impeditivo e próxima ação. Um total de "R$ 1.120.000 em risco" sem a lista de
 * QUAIS ordens e QUEM responde é um número que ninguém consegue agir sobre.
 */
export function RevenueLeakagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const unitId = searchParams.get('unitId') ?? '';
  const stageFilter = searchParams.get('stage');

  const leakage = useRevenueLeakage(unitId, { limit: 500 });

  const data = leakage.state.phase === 'ready' ? leakage.state.data : null;

  /**
   * O FILTRO É DE APRESENTAÇÃO.
   *
   * Ele reduz a lista JÁ DEVOLVIDA pelo backend; não altera o total, que é
   * calculado sobre o conjunto inteiro. Filtrar e somar reduziria o total e o
   * operador leria um número menor que a realidade.
   */
  const positions = useMemo(() => {
    if (!data) {
      return [];
    }
    return stageFilter
      ? data.positions.filter((position) => position.stage === stageFilter)
      : data.positions;
  }, [data, stageFilter]);

  const selectStage = useCallback(
    (stage: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (stage) {
        next.set('stage', stage);
      } else {
        next.delete('stage');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <ModulePage className="revenue-leakage">
      <ModulePageHeader title="Lacuna de receita" />

      {!unitId ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Informe a unidade (<code>unitId</code>) para calcular a lacuna de receita desta operação.
        </p>
      ) : null}

      {leakage.state.phase === 'denied' ? (
        <p className="text-xs text-gray-600">Sem acesso à lacuna de receita desta unidade.</p>
      ) : null}

      {leakage.state.phase === 'error' ? (
        <p className="text-xs text-red-700">Não foi possível calcular a lacuna de receita.</p>
      ) : null}

      {leakage.state.phase === 'loading' ? (
        <p className="text-xs text-gray-500">Calculando lacuna de receita…</p>
      ) : null}

      {data ? (
        <>
          {/* TOTAIS POR ESTÁGIO — o número que abre a conversa. */}
          <section
            aria-label="Lacuna de receita por estágio"
            className="mb-2 overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white"
          >
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">
                Valor de serviço parado por estágio da cadeia, com total
              </caption>
              <thead>
                <tr className="border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] text-left">
                  <th scope="col" className="px-3 py-1.5 font-medium text-gray-500">
                    Estágio
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium text-gray-500">
                    Ordens
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium text-gray-500">
                    Valor
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium text-gray-500">
                    Sem valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((stage) => {
                  const selected = stageFilter === stage.stage;
                  return (
                    <tr
                      key={stage.stage}
                      className={cn(
                        'border-b border-[color:var(--color-divider)]',
                        selected && 'bg-brand-50',
                      )}
                    >
                      <th scope="row" className="px-3 py-1 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => selectStage(selected ? null : stage.stage)}
                          className="text-left font-medium text-brand-700 underline decoration-dotted"
                          aria-pressed={selected}
                        >
                          {stage.label}
                        </button>
                      </th>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-700">
                        {stage.count}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums font-medium text-gray-900">
                        {formatMoney(stage.amount, stage.currencyCode) ?? (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-500">
                        {stage.unknownAmountCount > 0 ? stage.unknownAmountCount : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-[color:var(--color-surface-header)]">
                  <th scope="row" className="px-3 py-1.5 text-left font-semibold text-gray-900">
                    Total
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900">
                    {data.total.count}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900">
                    {formatMoney(data.total.amount, data.total.currencyCode) ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                    {data.total.unknownAmountCount > 0 ? data.total.unknownAmountCount : ''}
                  </td>
                </tr>
              </tfoot>
            </table>
            {/*
             * O AVISO DE VALOR DESCONHECIDO NÃO É DETALHE.
             *
             * Somar "sem valor" como zero afirmaria que não há dinheiro parado
             * naquelas ordens. O total declara a contagem em separado para que o
             * número nunca seja lido como completo quando não é.
             */}
            {data.total.unknownAmountCount > 0 ? (
              <p className="m-0 border-t border-[color:var(--color-divider)] px-3 py-1 text-[10px] text-amber-900">
                {data.total.unknownAmountCount} ordem(ns) sem valor apurado não entram na soma. O total
                acima NÃO inclui essas ordens.
              </p>
            ) : null}
          </section>

          {/* DRILL-DOWN — o mesmo conjunto que produz o total. */}
          <section className="overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white">
            <h2 className="cisne-type-workspace m-0 border-b border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-3 py-1.5">
              Ordens{stageFilter ? ` · ${stageLabel(stageFilter)}` : ''}
            </h2>
            {positions.length === 0 ? (
              <p className="m-0 px-3 py-2 text-xs text-gray-500">
                Nenhuma ordem neste estágio.
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <caption className="sr-only">
                  Ordens com valor de serviço parado, com dono, impeditivo e próxima ação
                </caption>
                <thead>
                  <tr className="border-b border-[color:var(--color-divider)] text-left">
                    <th scope="col" className="px-3 py-1 font-medium text-gray-500">
                      Cliente
                    </th>
                    <th scope="col" className="px-3 py-1 font-medium text-gray-500">
                      Ordem
                    </th>
                    <th scope="col" className="px-3 py-1 font-medium text-gray-500">
                      Estágio
                    </th>
                    <th scope="col" className="px-3 py-1 text-right font-medium text-gray-500">
                      Idade
                    </th>
                    <th scope="col" className="px-3 py-1 text-right font-medium text-gray-500">
                      Valor
                    </th>
                    <th scope="col" className="px-3 py-1 font-medium text-gray-500">
                      Dono
                    </th>
                    <th scope="col" className="px-3 py-1 font-medium text-gray-500">
                      Próxima ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr
                      key={position.serviceOrderId}
                      className="border-b border-[color:var(--color-divider)] last:border-b-0"
                    >
                      <td className="px-3 py-1 text-gray-900">
                        {position.clientLabel ?? '—'}
                      </td>
                      <td className="px-3 py-1">
                        <Link
                          to={`/app/service-orders/${position.serviceOrderId}/measurement`}
                          className="font-medium text-brand-700 underline"
                        >
                          {position.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-1">
                        <span className="inline-flex items-center gap-1">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'inline-block h-1.5 w-1.5 rounded-full',
                              severityTone(position.severity) === 'critical'
                                ? 'bg-red-600'
                                : severityTone(position.severity) === 'warning'
                                  ? 'bg-amber-500'
                                  : 'bg-blue-500',
                            )}
                          />
                          {position.stageLabel}
                        </span>
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-700">
                        {formatDuration(position.ageSeconds) ?? '—'}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums font-medium text-gray-900">
                        {formatMoney(position.amount, position.currencyCode) ?? (
                          <span className="text-amber-800">sem valor</span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-gray-700">{position.ownerRole}</td>
                      <td className="px-3 py-1">
                        <span className="text-gray-800">{position.nextAction.label}</span>
                        {position.blockerCode ? (
                          <span className="block text-[10px] text-gray-500">
                            {position.blockerCode}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
