import { Link } from 'react-router-dom';
import { useServiceOrderCostEvidence } from '../hooks/useServiceOrderCostEvidence';

const REASONS: Record<string, string> = {
  COST_CURRENCY_MISMATCH:
    'Há custos em moedas diferentes. O servidor bloqueou o total e a margem sem conversão homologada.',
  APPROVED_MEASUREMENT_REVENUE_UNAVAILABLE:
    'Ainda não há receita de medição aprovada para esta ordem. Não presumir faturamento ou recebimento.',
  ACTUAL_COST_EVIDENCE_MISSING:
    'Ainda não há custo realizado registrado. Ausência de custo não é custo zero.',
  REVENUE_CURRENCY_UNVERIFIED:
    'A medição aprovada contém moedas diferentes ou sem identificação. A receita não foi totalizada.',
  APPROVED_MEASUREMENT_AMOUNT_INCOMPLETE:
    'Há linhas de medição sem valor comercial confirmado. O total de receita não foi presumido.',
};

/**
 * Enterprise Object Page decision surface. The backend owns each amount and
 * the operator can drill into the original operational work. This is not a
 * separate CRUD or a local calculation of economic facts.
 */
export function ServiceOrderCostToServePanel({ serviceOrderId }: { serviceOrderId: string }) {
  const { state, reload } = useServiceOrderCostEvidence(serviceOrderId);

  return (
    <section aria-label="Cost-to-Serve da ordem" className="service-order-record-canvas border-b border-gray-200 pb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Posição econômica · controladoria
          </p>
          <h2 className="m-0 text-base font-semibold text-gray-900">Cost-to-Serve</h2>
        </div>
        {state.phase === 'ready' ? (
          <span className="text-xs text-gray-600">
            Fonte: custos operacionais e medição aprovada · {new Date(state.data.summary.capturedAt).toLocaleString('pt-BR')}
          </span>
        ) : null}
      </div>

      {state.phase === 'loading' ? (
        <p role="status" className="text-sm text-gray-600">
          Consultando os fatos de custo autorizados…
        </p>
      ) : null}
      {state.phase === 'denied' ? (
        <p role="alert" className="text-sm text-gray-600">
          Consulta econômica não autorizada. Acesso à OS não concede acesso aos seus custos.
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Falha ao consultar os custos. Não foi presumido saldo zero.</p>
          <button
            type="button"
            onClick={reload}
            className="underline"
          >
            Reconsultar fatos econômicos
          </button>
        </div>
      ) : null}
      {state.phase === 'ready' ? (
        <>
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: 'Custo estimado', value: state.data.summary.totalEstimatedCost },
              { label: 'Custo realizado', value: state.data.summary.totalActualCost },
              { label: 'Desvio realizado − estimado', value: state.data.summary.estimatedToActualVariance },
              { label: 'Desvio percentual', value: state.data.summary.estimatedToActualVariancePercent },
              { label: 'Receita de medição aprovada (indicativa)', value: state.data.summary.revenue },
              { label: 'Margem operacional indicativa', value: state.data.summary.actualMargin },
            ].map((position) => (
              <div key={position.label} className="min-w-0 border-t border-gray-200 pt-2">
                <dt className="text-xs text-gray-600">{position.label}</dt>
                <dd className="m-0 text-sm font-semibold text-gray-900">
                  {position.value === null
                    ? 'Sem evidência suficiente'
                    : position.label === 'Desvio percentual'
                      ? `${position.value}%`
                      : `${state.data.summary.currencyCode} ${position.value}`}
                </dd>
              </div>
            ))}
          </dl>
          {state.data.summary.blockingReasons.length > 0 ? (
            <div aria-label="Pendências de apuração" className="mt-4 border-l-2 border-gray-300 pl-3">
              <h3 className="text-sm font-semibold">Situações que impedem apuração completa</h3>
              <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-gray-700">
                {state.data.summary.blockingReasons.map((reason) => (
                  <li key={reason}>{REASONS[reason] ?? reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-gray-600">
            Posições de custo planejado, comprometido, apropriado, faturado,
            recebido e contabilizado não são intercambiáveis com custo estimado
            ou receita medida. Esta leitura não as presume.
            {' '}
            <Link
              to={`/app/service-orders/${serviceOrderId}/measurement`}
              className="text-brand-700 underline"
            >
              Examinar medição
            </Link>
          </p>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-900">
              Documentos e registros que compõem os custos ({state.data.entries.length})
            </summary>
            {state.data.entries.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">
                Nenhuma apropriação operacional registrada nesta ordem.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-600">
                      <th scope="col" className="py-2 pr-3">Natureza</th>
                      <th scope="col" className="py-2 pr-3">Origem</th>
                      <th scope="col" className="py-2 pr-3">Perspectiva</th>
                      <th scope="col" className="py-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-gray-100">
                        <td className="py-2 pr-3">
                          {entry.description || entry.category}
                        </td>
                        <td className="py-2 pr-3">
                          {entry.sourceExecutionEntryId ? (
                            <Link
                              to={`/app/service-orders/${serviceOrderId}/execution`}
                              className="text-brand-700 underline"
                            >
                              Registro de execução
                            </Link>
                          ) : 'Ordem de serviço'}
                        </td>
                        <td className="py-2 pr-3">
                          {entry.costKind === 'ACTUAL' ? 'Realizado' : 'Estimado'}
                        </td>
                        <td className="py-2 tabular-nums">{entry.currencyCode} {entry.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          <p className="mt-3 text-xs text-gray-600">
            Apuração gerencial indicativa. Medição aprovada não comprova aceite,
            faturamento, liquidação ou lançamento no razão.
          </p>
        </>
      ) : null}
    </section>
  );
}
