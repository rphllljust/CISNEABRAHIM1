import { useState } from 'react';
import { t } from '../i18n';
import type { SavedView } from './DynamicSavedViews';

/**
 * Barra de visões salvas.
 *
 * Só APRESENTAÇÃO: o estado e a persistência vivem em `useSavedViews`. Aqui ficam o campo de
 * nome, a lista e o botão de excluir.
 */
export type DynamicSavedViewsBarProps = {
  views: SavedView[];
  onApply: (view: SavedView) => void;
  onSave: (name: string) => boolean | Promise<boolean> | void;
  onDelete: (id: string) => void;
  /** `true` quando o backend ainda não publica visões salvas. */
  persistedLocally?: boolean;
  /**
   * `false` quando NÃO existe identidade para ser dona da visão.
   *
   * O formulário de salvar deixa de ser oferecido: um "Salvar visão" que não salva nada é pior que
   * a ausência dele — o operador digita um nome, confirma e perde a configuração ao recarregar sem
   * entender por quê. A barra DECLARA a indisponibilidade em vez de fingir.
   */
  persistable?: boolean;
  /** Visible error, loading or authorization state from the server. */
  statusMessage?: string | null;
  /** Retry a failed authoritative GET; never a localStorage fallback. */
  onRetry?: () => void;
};

export function DynamicSavedViewsBar({
  views,
  onApply,
  onSave,
  onDelete,
  persistedLocally = false,
  persistable = true,
  statusMessage = null,
  onRetry,
}: DynamicSavedViewsBarProps): React.ReactElement {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div
      data-testid="dynamic-saved-views"
      data-persisted-locally={persistedLocally ? 'true' : 'false'}
      /*
        SAVED VIEWS COMO RECURSO CENTRAL.

        Antes: "Nome da visão" + "Salvar visão" como um formulario solto no canto direito, com as
        visões existentes em botoes cinza do mesmo peso. O operador nao lia aquilo como o mecanismo
        que evita reconstruir a mesma consulta todo dia.

        Agora a barra tem gramatica de SELECAO: as visões existentes vem primeiro, como um segmento
        clicavel unico (aplicar + remover lendo como um controle so), e o ato de salvar fica
        subordinado a direita. A visao aplicada e um comando de primeira classe, nao um chip perdido.
      */
      className="cisne-saved-views grid gap-2 px-3 py-2 lg:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="cisne-meta-label shrink-0">{t('views.saved')}</span>

        {!persistable ? (
          <span className="cisne-type-helper" data-testid="dynamic-saved-views-unavailable">
            {statusMessage ?? 'Indisponível sem sessão identificada — não há dono para a visão.'}
          </span>
        ) : null}

        {!persistable && onRetry ? (
          <button type="button" onClick={onRetry} className="text-xs font-semibold text-brand-700 underline">
            Tentar novamente
          </button>
        ) : null}

        {persistable && views.length === 0 ? (
          <span className="cisne-type-helper">{t('views.empty')}</span>
        ) : (
          <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
            {views.map((view) => (
              <li
                key={view.id}
                className="inline-flex items-center overflow-hidden rounded-md ring-1 ring-[color:var(--color-border-default)] ring-inset"
              >
                <button
                  type="button"
                  data-testid="dynamic-saved-view"
                  data-view-name={view.name}
                  className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center bg-white px-2 text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-brand-50)] hover:text-[color:var(--color-text-primary)]"
                  onClick={() => onApply(view)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  data-testid="dynamic-saved-view-delete"
                  aria-label={`${t('views.delete')}: ${view.name}`}
                  className="inline-flex min-h-[var(--control-height)] items-center border-l border-[color:var(--color-border-default)] bg-white px-1.5 text-[color:var(--color-text-muted)] hover:bg-red-50 hover:text-red-700"
                  onClick={() => onDelete(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {persistable && statusMessage ? (
        <p role="alert" className="m-0 text-xs text-red-700">{statusMessage}</p>
      ) : null}
      {persistable ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={saving}
            disabled={pending}
            onClick={() => setSaving((previous) => !previous)}
            className="text-xs font-semibold text-[color:var(--color-brand-700)]"
          >
            {saving ? 'Cancelar' : t('views.save')}
          </button>
          <form
            hidden={!saving}
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              // Acknowledgement comes from the authenticated API, not a click.
              // Preserve the operator's draft when the server refuses the save.
              void Promise.resolve()
                .then(() => onSave(name))
                .then((confirmed) => {
                  if (confirmed === false) return;
                  setName('');
                  setSaving(false);
                })
                .catch(() => {
                  // Preserve the draft. The owner hook publishes the error.
                })
                .finally(() => setPending(false));
            }}
          >
            <input
              type="text"
              disabled={pending}
              data-testid="dynamic-saved-view-name"
              aria-label={t('views.namePlaceholder')}
              placeholder={t('views.namePlaceholder')}
              className="block min-h-[var(--control-height)] w-40 rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="submit"
              data-testid="dynamic-saved-view-save"
              disabled={pending || name.trim() === ''}
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-white px-2 text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Salvando…' : t('views.save')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
