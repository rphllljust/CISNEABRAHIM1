import { t } from '../i18n';
import { DynamicCalendar } from './DynamicCalendar';
import { DynamicGraph } from './DynamicGraph';
import { DynamicKanban } from './DynamicKanban';
import { DynamicList, type DynamicListRow } from './DynamicList';
import { DynamicPivot } from './DynamicPivot';
import { DynamicTree } from './DynamicTree';
import type { MetaEntitySchema, MetaField } from './types';
import { findView } from './view-layout';

/**
 * DESPACHO POR `viewType` — o coração de "views como dados".
 *
 * O mapa abaixo é a ÚNICA lista de tipos que a engine sabe desenhar. Tudo o mais vem do
 * store: quais abas existem, em que ordem, com que rótulo e com que layout. Adicionar uma
 * view nova em `meta.views` faz a aba aparecer SEM deploy; se o `view_type` não estiver
 * neste mapa, a engine diz isso em voz alta em vez de renderizar uma tela vazia.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO NÃO É UM `switch` DENTRO DE CADA TELA
 *
 * Antes, cada tela decidia o que renderizar e declarava sua própria lista de tipos suportados
 * (`SUPPORTED_VIEW_TYPES`). Isso significa que uma capacidade nova exigia editar TODA tela
 * que quisesse usá-la — o oposto de views-como-dados. Aqui o conhecimento mora num lugar só,
 * e a tela passa a ser encanamento: entidade → endpoint → linhas.
 *
 * `form` NÃO está no mapa: é o formulário do detalhe, não uma aba de apresentação da lista.
 */

/** Tipos que a engine sabe desenhar. A ordem é a ordem em que aparecem na documentação. */
export const RENDERABLE_VIEW_TYPES = [
  'list',
  'kanban',
  'calendar',
  'pivot',
  'tree',
  'graph',
] as const;

export type RenderableViewType = (typeof RENDERABLE_VIEW_TYPES)[number];

export function isRenderableViewType(value: string): value is RenderableViewType {
  return (RENDERABLE_VIEW_TYPES as readonly string[]).includes(value);
}

export type DynamicViewHostProps = {
  schema: MetaEntitySchema;
  /**
   * Linhas da entidade.
   *
   * Tipadas como `DynamicListRow` (o contrato mais permissivo da engine: `id` obrigatório +
   * chaves livres) porque é ele que `DynamicList` e `DynamicKanban` exigem. Uma entidade sem
   * `id` não é renderizável por nenhuma view de coleção, e o `DynamicList` trata a ausência
   * como erro de dado — razão pela qual o tipo o exige aqui também.
   */
  rows: DynamicListRow[];
  activeViewType: string;
  /** Estado controlado de expansão da árvore, quando a tela quiser preservá-lo na URL. */
  expandedDepth?: number;
  /** Campos do cartão do kanban. Sem ele, o kanban usa `layout.cardFields`. */
  cardFields?: MetaField[];
  onRowClick?: (row: DynamicListRow) => void;
  onCellClick?: (group: Record<string, string>, column: string | null) => void;
  onNodeClick?: (row: DynamicListRow) => void;
  onBarClick?: (category: string) => void;
  emptyMessage?: string;
};

/**
 * Renderiza a view ativa.
 *
 * O componente NÃO filtra as linhas: quem filtra é a tela, que é quem conhece os parâmetros
 * e o que o backend aceita. Aqui só se decide COMO desenhar o que chegou.
 */
export function DynamicViewHost({
  schema,
  rows,
  activeViewType,
  expandedDepth = 1,
  cardFields,
  onRowClick,
  onCellClick,
  onNodeClick,
  onBarClick,
  emptyMessage,
}: DynamicViewHostProps): React.ReactElement {
  switch (activeViewType) {
    case 'calendar':
      return (
        <DynamicCalendar
          schema={schema}
          rows={rows}
          viewType={activeViewType}
          onCardClick={onRowClick}
          emptyMessage={emptyMessage}
        />
      );
    case 'pivot':
      return (
        <DynamicPivot
          schema={schema}
          rows={rows}
          viewType={activeViewType}
          onCellClick={onCellClick}
          emptyMessage={emptyMessage}
        />
      );
    case 'tree':
      return (
        <DynamicTree
          schema={schema}
          rows={rows}
          viewType={activeViewType}
          defaultExpandedDepth={expandedDepth}
          onNodeClick={onNodeClick ?? onRowClick}
          emptyMessage={emptyMessage}
        />
      );
    case 'graph':
      return (
        <DynamicGraph
          schema={schema}
          rows={rows}
          viewType={activeViewType}
          onBarClick={onBarClick}
          emptyMessage={emptyMessage}
        />
      );
    case 'kanban':
      return (
        <DynamicKanban
          schema={schema}
          rows={rows}
          cardFields={cardFields}
          onCardClick={onRowClick}
        />
      );
    case 'list':
      return (
        <DynamicList schema={schema} rows={rows} emptyMessage={emptyMessage} onRowClick={onRowClick} />
      );
    default:
      return <UnsupportedViewNotice schema={schema} viewType={activeViewType} />;
  }
}

/**
 * AUSÊNCIA DECLARADA, NÃO SILENCIOSA.
 *
 * A view existe no store (a aba aparece) mas a engine não tem renderizador. Uma tela vazia
 * seria lida como "não há dado", que é falso — há configuração, falta renderizador. O aviso
 * nomeia o tipo e a entidade para que o gap seja acionável.
 */
export function UnsupportedViewNotice({
  schema,
  viewType,
}: {
  schema: MetaEntitySchema;
  viewType: string;
}): React.ReactElement {
  const view = findView(schema, viewType);
  return (
    <div
      data-testid="dynamic-view-unsupported"
      data-entity={schema.name}
      data-view-type={viewType}
      className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p>
        {t('views.unsupported', 'A visão')} <strong>{view?.label ?? viewType}</strong>{' '}
        {t(
          'views.unsupportedSuffix',
          'existe no metadata store, mas a engine ainda não possui renderizador para ela.',
        )}
      </p>
      <p className="mt-1 text-xs">
        {t('views.knownTypes', 'Tipos com renderizador')}: {RENDERABLE_VIEW_TYPES.join(', ')}.
      </p>
    </div>
  );
}
