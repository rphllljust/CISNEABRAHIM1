import type {
  ActualComparisonLine,
  ExecutionActualsReadModel,
  ResourceSubstitution,
} from '../types/operations.types';

/**
 * PAINEL DE PLANEJADO × REALIZADO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA TELA **NÃO** FAZ
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Não soma, não subtrai, não calcula variação e não decide se uma diferença é
 * aceitável. Tudo isso vem pronto do backend — inclusive `direction`, `variance`,
 * `explainable` e `explanation`.
 *
 * A razão é concreta: a variação é o número que o gestor usa para decidir, e duas
 * implementações (uma no servidor, outra aqui) divergem na primeira alteração de
 * regra. A tela desenha; o domínio calcula.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUSÊNCIA NÃO É ZERO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Quando `actualValue` é `null`, a linha mostra "não registrado" — NUNCA "0". Zero
 * é um valor medido; ausência significa que ninguém registrou, e confundir os dois
 * é como o sistema alega "consumiu nada" quando na verdade não sabe.
 */
export function ActualsComparisonPanel({ actuals }: { actuals: ExecutionActualsReadModel }) {
  const { comparison } = actuals;

  if (!comparison.hasActuals) {
    return (
      <section
        aria-label="Planejado versus realizado"
        className="rounded border border-amber-200 bg-amber-50 p-3 text-xs"
      >
        <p className="font-semibold text-amber-900">Nenhum realizado registrado</p>
        <p className="mt-1 text-amber-800">
          A variação ainda não pode ser medida. Registre os dados reais de execução — medidor final,
          combustível e horas — antes de concluir.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Planejado versus realizado" className="space-y-2">
      <p className="text-xs text-gray-600">{comparison.summary}</p>

      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Comparação entre planejado e realizado</caption>
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <th scope="col" className="py-1 pr-2 font-medium">
              Item
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Planejado
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Realizado
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Variação
            </th>
            <th scope="col" className="py-1 font-medium">
              Causa
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.lines.map((line) => (
            <ComparisonRow key={line.group} line={line} />
          ))}
        </tbody>
      </table>

      {comparison.substitutions.length > 0 ? (
        <Substitutions rows={comparison.substitutions} />
      ) : null}

      {actuals.meters.length > 0 ? (
        <div className="mt-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Leituras de medidor
          </h4>
          <ul className="space-y-0.5 text-xs text-gray-700">
            {actuals.meters.map((meter) => (
              <li key={meter.id} className="flex items-center justify-between gap-2">
                <span>
                  {meter.meterKind}
                  {meter.isInitial ? ' (abertura)' : meter.isFinal ? ' (fechamento)' : ''}
                </span>
                <span className="font-mono">
                  {formatQuantity(meter.readingValue)} {meter.unitOfMeasure}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actuals.fuel.length > 0 ? (
        <div className="mt-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Abastecimentos
          </h4>
          <ul className="space-y-0.5 text-xs text-gray-700">
            {actuals.fuel.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-2">
                <span>
                  {record.odometerReading
                    ? `odômetro ${formatQuantity(record.odometerReading)} km`
                    : 'sem odômetro'}
                </span>
                <span className="font-mono">{formatQuantity(record.volumeLiters)} L</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actuals.signatures.length > 0 ? (
        <div className="mt-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Assinaturas
          </h4>
          <ul className="space-y-0.5 text-xs text-gray-700">
            {actuals.signatures.map((signature) => (
              <li key={signature.id}>
                {signature.signerName} · {signature.signatureKind}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actuals.evidence.length > 0 ? (
        <div className="mt-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Evidências
          </h4>
          <ul className="space-y-0.5 text-xs">
            {actuals.evidence.map((item) => (
              <li key={item.id} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={item.status === 'VERIFIED' ? 'text-emerald-600' : 'text-amber-600'}
                >
                  {item.status === 'VERIFIED' ? '✓' : '!'}
                </span>
                <span className="text-gray-700">{item.evidenceKind}</span>
                <span className="text-gray-500">
                  {item.status === 'VERIFIED'
                    ? 'verificada'
                    : item.status === 'REJECTED'
                      ? 'recusada'
                      : 'anexada'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ComparisonRow({ line }: { line: ActualComparisonLine }) {
  const unit = line.unitOfMeasure ?? '';
  const tone =
    line.direction === 'OVER'
      ? 'text-amber-700'
      : line.direction === 'UNDER'
        ? 'text-brand-700'
        : 'text-gray-500';

  return (
    <tr className="border-b border-gray-100 align-top">
      <th scope="row" className="py-1 pr-2 text-left font-medium text-gray-700">
        {line.label}
      </th>
      <td className="py-1 pr-2 font-mono text-gray-700">
        {line.plannedValue === null ? (
          <span className="text-gray-400">sem plano</span>
        ) : (
          `${formatQuantity(line.plannedValue)}${unit ? ` ${unit}` : ''}`
        )}
      </td>
      <td className="py-1 pr-2 font-mono text-gray-900">
        {line.actualValue === null ? (
          <span className="text-gray-400">não registrado</span>
        ) : (
          `${formatQuantity(line.actualValue)}${unit ? ` ${unit}` : ''}`
        )}
      </td>
      <td className={`py-1 pr-2 font-mono ${tone}`}>
        {line.variance === null ? (
          <span className="text-gray-400">—</span>
        ) : (
          `${Number(line.variance) > 0 ? '+' : ''}${formatQuantity(line.variance)}${unit ? ` ${unit}` : ''}`
        )}
      </td>
      <td className="py-1 text-gray-600">
        {line.explanation ? (
          line.explanation
        ) : line.direction === 'EQUAL' || line.direction === 'UNKNOWN' ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className="text-amber-700">sem causa registrada</span>
        )}
      </td>
    </tr>
  );
}

function Substitutions({ rows }: { rows: readonly ResourceSubstitution[] }) {
  const roleLabel: Record<string, string> = {
    DRIVER: 'Condutor',
    VEHICLE: 'Veículo',
    EQUIPMENT: 'Equipamento',
  };

  return (
    <div className="mt-2">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Recurso planejado × executado
      </h4>
      <ul className="space-y-0.5 text-xs">
        {rows.map((row) => (
          <li key={row.role} className="flex items-center gap-2">
            <span className="w-24 text-gray-500">{roleLabel[row.role] ?? row.role}</span>
            <span className="font-mono text-gray-700">{row.plannedCode ?? '—'}</span>
            <span aria-hidden="true" className="text-gray-400">
              →
            </span>
            <span
              className={
                row.changed ? 'font-mono font-semibold text-amber-700' : 'font-mono text-gray-700'
              }
            >
              {row.actualCode ?? '—'}
            </span>
            {row.changed ? <span className="text-amber-700">trocado</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Formata um decimal vindo do backend SEM alterar o valor.
 *
 * O backend já entrega em string decimal exata. Converter para `number` e voltar
 * introduziria o erro de ponto flutuante que o domínio evita de propósito.
 */
function formatQuantity(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) {
    return trimmed;
  }
  const [intPart = '0', fracRaw = ''] = trimmed.split('.');
  const frac = fracRaw.replace(/0+$/, '');
  return frac.length > 0 ? `${intPart},${frac}` : intPart;
}
