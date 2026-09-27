import { ProposalStatusBadge } from './ProposalStatusBadge';
import type {
  ProposalRevisionDiff,
  ProposalRevisionSummary,
} from '../types/proposal.types';
import { formatDateTime, formatMoney } from '../utils/proposal-labels';
import {
  formatDiffFieldValue,
  selectRevisionPair,
  summarizeRevisionDiff,
} from '../utils/proposal-workbench';
import { cn } from '../../ui/utils/cn';

type ProposalRevisionPanelProps = {
  revisions: ProposalRevisionSummary[];
  comparison: ProposalRevisionDiff | null;
};

const CHANGE_LABELS: Record<string, string> = {
  ADDED: 'Adicionado',
  REMOVED: 'Removido',
  CHANGED: 'Alterado',
};

const CHANGE_CLASS: Record<string, string> = {
  ADDED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  REMOVED: 'bg-red-50 text-red-700 ring-red-600/20',
  CHANGED: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

/**
 * Revisoes comerciais como primeira classe.
 *
 * Cada linha e uma versao persistida (`com.proposal_versions`): numero, estado real, nascimento,
 * emissao/aceite e se ela foi substituida. A comparacao entre a revisao vigente e a anterior e
 * CALCULADA no backend a partir dos dados gravados — nunca persistida e nunca inventada.
 */
export function ProposalRevisionPanel({ revisions, comparison }: ProposalRevisionPanelProps) {
  if (revisions.length === 0) {
    return (
      <p className="text-sm text-gray-500" role="status">
        Nenhuma revisão registrada para esta proposta.
      </p>
    );
  }

  const ordered = [...revisions].sort((left, right) => right.versionNumber - left.versionNumber);
  const { current, previous } = selectRevisionPair(revisions);

  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {ordered.map((revision) => (
          <li
            key={revision.versionNumber}
            className={cn(
              'rounded-lg border px-3 py-3',
              revision.isCurrent ? 'border-brand-500/40 bg-brand-50/40' : 'border-gray-200 bg-white',
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="cisne-type-code text-sm font-semibold text-gray-900">
                Revisão {revision.versionNumber}
              </span>
              <ProposalStatusBadge status={revision.status} />
              {revision.isCurrent ? (
                <span className="rounded bg-brand-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 uppercase">
                  Vigente
                </span>
              ) : null}
              {revision.supersededAt ? (
                <span className="text-[11px] text-gray-500">
                  substituída em {formatDateTime(revision.supersededAt)}
                </span>
              ) : null}
            </div>

            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-3">
              <div>
                <dt className="font-medium text-gray-500">Nascimento</dt>
                <dd>{formatDateTime(revision.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Emissão</dt>
                <dd>{formatDateTime(revision.issuedAt)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Valor</dt>
                <dd className="tabular-nums">
                  {formatMoney(revision.saleTotal, revision.currencyCode)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Validade</dt>
                <dd>{formatDateTime(revision.validUntil)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Itens</dt>
                <dd>{revision.itemCount}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500">Substitui</dt>
                <dd>
                  {revision.supersedesVersionNumber === null
                    ? '—'
                    : `Revisão ${revision.supersedesVersionNumber}`}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      {comparison ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              Comparação: Revisão {comparison.toRevisionNumber} vs Revisão{' '}
              {comparison.fromRevisionNumber}
            </h3>
            <span className="text-xs text-gray-500">{summarizeRevisionDiff(comparison)}</span>
          </div>

          {comparison.fields.length > 0 ? (
            <table className="mt-3 w-full text-xs" aria-label="Campos alterados entre revisões">
              <thead>
                <tr className="text-left text-gray-500">
                  <th scope="col" className="pb-1">
                    Campo
                  </th>
                  <th scope="col" className="pb-1">
                    Revisão {comparison.fromRevisionNumber}
                  </th>
                  <th scope="col" className="pb-1">
                    Revisão {comparison.toRevisionNumber}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {comparison.fields.map((field) => (
                  <tr key={field.field}>
                    <td className="py-1.5 font-medium text-gray-700">{field.label}</td>
                    <td className="py-1.5 text-gray-600">{formatDiffFieldValue(field, 'before')}</td>
                    <td className="py-1.5 font-medium text-gray-900">
                      {formatDiffFieldValue(field, 'after')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {comparison.lines.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {comparison.lines.map((line) => (
                <li key={`${line.change}-${line.key}`} className="text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset',
                        CHANGE_CLASS[line.change],
                      )}
                    >
                      {CHANGE_LABELS[line.change]}
                    </span>
                    <span className="font-medium text-gray-800">{line.description}</span>
                  </div>
                  {line.fields.length > 0 ? (
                    <ul className="mt-0.5 ml-4 text-gray-600">
                      {line.fields.map((field) => (
                        <li key={field.field}>
                          {field.label}: {formatDiffFieldValue(field, 'before')} →{' '}
                          <strong className="font-medium text-gray-900">
                            {formatDiffFieldValue(field, 'after')}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {comparison.fields.length === 0 && comparison.lines.length === 0 ? (
            <p className="mt-2 text-xs text-gray-600">
              As duas revisões têm os mesmos valores nos campos comparáveis.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {previous === null
            ? 'Primeira revisão da proposta — não há revisão anterior para comparar.'
            : `Sem comparação disponível entre as revisões ${previous.versionNumber} e ${current?.versionNumber ?? 0}.`}
        </p>
      )}

      <p className="text-xs text-gray-400">
        Revisão comercial é uma nova versão da proposta. É conceito diferente do controle de
        concorrência (`rowVersion`) e do histórico de auditoria.
      </p>
    </div>
  );
}
