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
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  /** `true` quando o backend ainda não publica visões salvas. */
  persistedLocally?: boolean;
};

export function DynamicSavedViewsBar({
  views,
  onApply,
  onSave,
  onDelete,
  persistedLocally = false,
}: DynamicSavedViewsBarProps): React.ReactElement {
  const [name, setName] = useState('');

  return (
    <div
      data-testid="dynamic-saved-views"
      data-persisted-locally={persistedLocally ? 'true' : 'false'}
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {t('views.saved')}
      </span>

      {views.length === 0 ? (
        <span className="text-xs text-gray-500">{t('views.empty')}</span>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
          {views.map((view) => (
            <li key={view.id} className="inline-flex items-center">
              <button
                type="button"
                data-testid="dynamic-saved-view"
                data-view-name={view.name}
                className="rounded-l border border-slate-300 px-2 py-1 text-xs"
                onClick={() => onApply(view)}
              >
                {view.name}
              </button>
              <button
                type="button"
                data-testid="dynamic-saved-view-delete"
                aria-label={`${t('views.delete')}: ${view.name}`}
                className="rounded-r border border-l-0 border-slate-300 px-1.5 py-1 text-xs text-slate-500"
                onClick={() => onDelete(view.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="ml-auto flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name);
          setName('');
        }}
      >
        <input
          type="text"
          data-testid="dynamic-saved-view-name"
          aria-label={t('views.namePlaceholder')}
          placeholder={t('views.namePlaceholder')}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          data-testid="dynamic-saved-view-save"
          disabled={name.trim() === ''}
          className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
        >
          {t('views.save')}
        </button>
      </form>
    </div>
  );
}
