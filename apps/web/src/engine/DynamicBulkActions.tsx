import { useState } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema, MetaTransition } from './types';

/**
 * Ações em lote sobre a lista.
 *
 * As ações oferecidas são as TRANSIÇÕES do workflow que o ator pode executar — a mesma fonte
 * da `ActionBar`. Não existe catálogo separado de "ações em lote": uma ação em lote é uma
 * transição aplicada a N registros.
 *
 * A engine NÃO executa nada: ela emite `onApply(command, ids)` e a tela despacha. Isso mantém
 * o conhecimento de "como cada comando chega ao backend" fora da engine — que é o que permite
 * a mesma barra servir OS, fornecedores e faturamento.
 */
export type DynamicBulkActionsProps = {
  schema: MetaEntitySchema;
  selectedIds: string[];
  onApply: (command: string, ids: string[]) => void;
  onClear: () => void;
  busy?: boolean;
  /** Comandos que exigem justificativa são ignorados no lote — a tela confirma um a um. */
  errorMessage?: string | null;
};

export function DynamicBulkActions({
  schema,
  selectedIds,
  onApply,
  onClear,
  busy = false,
  errorMessage = null,
}: DynamicBulkActionsProps): React.ReactElement | null {
  const [command, setCommand] = useState('');

  if (selectedIds.length === 0) {
    return null;
  }

  const transitions = (schema.workflow?.transitions ?? [])
    .filter((transition) => transition.allowed)
    // `requiresReason` fica de fora: aplicar em lote um comando que exige justificativa
    // individual gravaria a mesma justificativa para todos, ou nenhuma.
    .filter((transition) => !transition.requiresReason)
    .slice()
    .sort((left, right) => left.buttonOrder - right.buttonOrder);

  const selected = transitions.find((transition) => transition.command === command) ?? null;

  return (
    <div
      data-testid="dynamic-bulk-actions"
      data-selected-count={selectedIds.length}
      className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-slate-50 px-3 py-2"
    >
      <p className="text-sm">
        <strong data-testid="dynamic-bulk-count">{selectedIds.length}</strong>{' '}
        {t('bulk.selected')}
      </p>

      {transitions.length === 0 ? (
        <p className="text-sm text-gray-500">{t('bulk.none')}</p>
      ) : (
        <>
          <label htmlFor="bulk-command" className="text-xs font-medium text-gray-700">
            {t('bulk.apply')}
          </label>
          <select
            id="bulk-command"
            data-testid="dynamic-bulk-command"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={command}
            disabled={busy}
            onChange={(event) => setCommand(event.target.value)}
          >
            <option value="">—</option>
            {transitions.map((transition) => (
              <option key={transition.command} value={transition.command}>
                {label(transition)}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="dynamic-bulk-apply"
            disabled={busy || selected === null}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-60"
            onClick={() => {
              if (selected) {
                onApply(selected.command, selectedIds);
              }
            }}
          >
            {t('bulk.apply')}
          </button>
        </>
      )}

      <button
        type="button"
        data-testid="dynamic-bulk-clear"
        className="ml-auto text-xs text-slate-600 underline"
        onClick={onClear}
      >
        {t('bulk.clear')}
      </button>

      {errorMessage ? (
        <p className="w-full text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function label(transition: MetaTransition): string {
  return transition.label;
}
