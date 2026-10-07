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
  /**
   * `false` quando NÃO existe identidade para ser dona da visão.
   *
   * O formulário de salvar deixa de ser oferecido: um "Salvar visão" que não salva nada é pior que
   * a ausência dele — o operador digita um nome, confirma e perde a configuração ao recarregar sem
   * entender por quê. A barra DECLARA a indisponibilidade em vez de fingir.
   */
  persistable?: boolean;
};

export function DynamicSavedViewsBar({
  views,
  onApply,
  onSave,
  onDelete,
  persistedLocally = false,
  persistable = true,
}: DynamicSavedViewsBarProps): React.ReactElement {
  const [name, setName] = useState('');

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
      className="cisne-divider flex flex-wrap items-center gap-x-3 gap-y-1 px-0 py-1.5"
    >
      <span className="cisne-meta-label shrink-0">{t('views.saved')}</span>

      {!persistable ? (
        <span className="cisne-type-helper" data-testid="dynamic-saved-views-unavailable">
          Indisponível sem sessão identificada — não há dono para a visão.
        </span>
      ) : null}

      {persistable && views.length === 0 ? (
        <span className="cisne-type-helper">{t('views.empty')}</span>
      ) : (
        <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
          {views.map((view) => (
            <li
              key={view.id}
              className="inline-flex items-center overflow-hidden rounded-md ring-1 ring-gray-300 ring-inset"
            >
              <button
                type="button"
                data-testid="dynamic-saved-view"
                data-view-name={view.name}
                className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center bg-white px-2 text-gray-700 hover:bg-brand-600 hover:text-white"
                onClick={() => onApply(view)}
              >
                {view.name}
              </button>
              <button
                type="button"
                data-testid="dynamic-saved-view-delete"
                aria-label={`${t('views.delete')}: ${view.name}`}
                className="inline-flex min-h-[var(--control-height)] items-center border-l border-gray-300 bg-white px-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700"
                onClick={() => onDelete(view.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {persistable ? (
      <form
        className="ml-auto flex items-center gap-1.5"
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
          className="block min-h-[var(--control-height)] w-40 rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          data-testid="dynamic-saved-view-save"
          disabled={name.trim() === ''}
          className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-white px-2 text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('views.save')}
        </button>
      </form>
      ) : null}
    </div>
  );
}
