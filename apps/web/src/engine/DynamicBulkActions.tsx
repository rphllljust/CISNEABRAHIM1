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
      /*
        BARRA DE COMANDO EM LOTE — hierarquia real entre comando, selecao e saida.

        Antes: `rounded border bg-slate-50` com o rotulo "Aplicar" DUPLICADO (um `<label>` e o texto
        do botao) e o botao em `slate-800` — uma cor de produto que nao existe em nenhum outro lugar
        do CISNE. O comando em lote e a acao de MAIOR alcance da tela e aparecia com peso visual
        menor que um botao secundario qualquer.

        Agora: a barra e uma regua de comando (regua de acento + divisor), o NUMERO de selecionados e
        o dado primario da faixa, o comando em lote e o unico elemento em brand (comando primario) e
        "Limpar seleção" e a saida discreta a direita — tres papeis distintos, tres pesos distintos.
      */
      className="cisne-divider flex flex-wrap items-center gap-2 border-l-[3px] border-l-brand-600 bg-brand-50/40 px-2.5 py-1.5"
    >
      <p className="cisne-type-body m-0">
        <strong data-testid="dynamic-bulk-count" className="cisne-type-primary">
          {selectedIds.length}
        </strong>{' '}
        {t('bulk.selected')}
      </p>

      {transitions.length === 0 ? (
        <p className="cisne-type-helper m-0">{t('bulk.none')}</p>
      ) : (
        <>
          <span className="cisne-meta-label">{t('bulk.apply')}</span>
          <select
            id="bulk-command"
            data-testid="dynamic-bulk-command"
            aria-label={t('bulk.apply')}
            className="min-h-[var(--control-height)] rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] font-medium text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
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
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-brand-600 px-3 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="cisne-type-action ml-auto inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        onClick={onClear}
      >
        {t('bulk.clear')}
      </button>

      {errorMessage ? (
        <p className="m-0 w-full text-[length:var(--type-body-size)] text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function label(transition: MetaTransition): string {
  return transition.label;
}
