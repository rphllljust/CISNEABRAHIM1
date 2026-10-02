import { useMemo } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema, MetaView } from './types';

/**
 * Seletor de visões.
 *
 * AS ABAS SÃO AS VIEWS DO METADATA STORE — não uma lista fixa em JSX. Adicionar uma view
 * `calendar` (ou qualquer outro `view_type`) em `meta.views` faz a aba aparecer, sem deploy.
 * É esta indireção que torna a Prova 2 possível.
 *
 * A engine conhece RENDERIZADORES para os tipos que ela sabe desenhar (`list`, `kanban`,
 * `form`). Um tipo novo aparece como aba e, ao ser escolhido, diz explicitamente que não há
 * renderizador — em vez de sumir ou quebrar. Isso é GAP_DE_ENGINE declarado, não falha
 * silenciosa.
 */
export type DynamicViewSwitcherProps = {
  schema: MetaEntitySchema;
  activeViewType: string;
  onChange: (viewType: string) => void;
  /** Tipos que têm renderizador disponível na tela atual. */
  supportedViewTypes: string[];
};

export function DynamicViewSwitcher({
  schema,
  activeViewType,
  onChange,
  supportedViewTypes,
}: DynamicViewSwitcherProps): React.ReactElement | null {
  const views = useMemo(() => orderedViews(schema), [schema]);

  if (views.length <= 1) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label={t('views.title')}
      data-testid="dynamic-view-switcher"
      className="mb-3 flex flex-wrap gap-2"
    >
      {views.map((view) => {
        const supported = supportedViewTypes.includes(view.viewType);
        const active = view.viewType === activeViewType;
        return (
          <button
            key={view.viewType}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid="dynamic-view-tab"
            data-view-type={view.viewType}
            data-view-supported={supported ? 'true' : 'false'}
            className={`rounded border px-2 py-1 text-xs ${
              active
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-300 bg-white text-slate-700'
            } ${supported ? '' : 'opacity-60'}`}
            onClick={() => onChange(view.viewType)}
          >
            {view.label}
            {supported ? '' : ' ⚠'}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Views renderizáveis, ordenadas.
 *
 * `form` fica de fora: é o formulário do detalhe, não uma aba de apresentação da lista. As
 * demais entram na ordem que o servidor devolveu (`ORDER BY view_type`), estável entre
 * navegações.
 */
export function orderedViews(schema: MetaEntitySchema): MetaView[] {
  return schema.views.filter((view) => view.viewType !== 'form');
}
