import { useMemo, type ReactNode } from 'react';
import { useDragAndDrop } from './use-drag-and-drop';
import { AgingBadge } from './DynamicList';
import { FieldRenderer, toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Kanban dirigido por metadados.
 *
 * AS COLUNAS SÃO OS ESTADOS DO WORKFLOW — não uma lista fixa em JSX. É o que substitui o
 * quadro artesanal de faturamento ("Pronto para faturar", "Em preparação", "Com
 * divergência"): adicionar uma coluna é adicionar um estado ao workflow no metadata store.
 *
 * `layout.groupBy` diz QUAL campo agrupa (normalmente o `stateField` do workflow), e
 * `layout.cardFields` diz o que aparece no cartão.
 *
 * CARD ENRIQUECIDO: além dos campos declarados, o cartão mostra AGING, RESPONSÁVEL e BADGES
 * de cross-reference (contagens que a TELA fornece — a engine não inventa chamada de rede por
 * cartão).
 */
export type DynamicKanbanCardBadge = {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'info' | 'warning' | 'critical';
};

export type DynamicKanbanProps = {
  /**
   * Schema da entidade.
   *
   * PODE SER `null`: um quadro com `derivedColumns` não depende do metadata store para
   * existir — as colunas vêm da tela. Quando o schema chega, ele apenas ENRIQUECE os cartões
   * (rótulos de campo, aging). Exigir o schema para desenhar faria a fila inteira sumir
   * enquanto o metadado não responde.
   */
  schema: MetaEntitySchema | null;
  rows: Array<Record<string, unknown> & { id: string }>;
  /** Campos do cartão. Vence `layout.cardFields`; obrigatório quando não há schema. */
  cardFields?: MetaField[];
  onCardClick?: (row: Record<string, unknown> & { id: string }) => void;
  /** Rótulo humano de um estado (ex.: "IN_EXECUTION" -> "Em execução"). */
  stateLabel?: (state: string) => string;
  /** Campo de responsável — exibido no cartão quando presente. */
  ownerField?: string;
  /** Campo de data para aging. Ausente = `created_at` se existir. */
  agingField?: string;
  /** Badges de cross-reference por registro, resolvidos pela TELA. */
  badges?: (row: Record<string, unknown> & { id: string }) => DynamicKanbanCardBadge[];
  /**
   * Arrastar um cartão para outra coluna.
   *
   * A engine NÃO executa nada: entrega o registro e o ESTADO DE DESTINO, e a tela resolve se
   * existe transição declarada para lá. Sem este handler os cartões não são arrastáveis — a
   * engine não inventa um comando a partir de um gesto.
   */
  onCardDrop?: (
    row: Record<string, unknown> & { id: string },
    targetState: string,
  ) => void;
  /**
   * Colunas DERIVADAS, quando o agrupamento não é um estado do workflow.
   *
   * Existe porque há quadros cujo eixo é uma classificação calculada (ex.: "pronto para
   * faturar" / "com divergência"), não um campo persistido. O metadado não sabe expressar
   * isso hoje — GAP_DE_CONTRATO declarado — então a TELA fornece as colunas e o bucketer.
   *
   * Quando presente, estas colunas MANDAM sobre `workflow.states`: são o eixo real do quadro.
   * A engine continua sem conhecer o domínio: ela só desenha as colunas que recebeu.
   */
  derivedColumns?: DynamicKanbanColumn[];
  /**
   * Cabeçalho do cartão, renderizado pela TELA.
   *
   * Existe porque o identificador de um registro costuma ser um LINK (navegação real, com
   * histórico e abrir-em-nova-aba), e a engine não conhece a malha de rotas do app — assim
   * como não conhece os endpoints. Sem isto o cartão só teria clique em botão.
   */
  renderCardHeader?: (row: Record<string, unknown> & { id: string }) => ReactNode;
  /**
   * Faixa de alerta do cartão, renderizada pela TELA.
   *
   * Para o que NÃO é contagem (ex.: "Divergência de condições"), que nenhum badge numérico
   * representa. A cor também vem da tela: a divergência comercial tem cor própria no domínio
   * de faturamento, e a engine não conhece essa paleta.
   */
  renderCardFlag?: (
    row: Record<string, unknown> & { id: string },
  ) => { content: ReactNode; accent?: string } | null;
};

export type DynamicKanbanColumn = {
  key: string;
  title: string;
  description?: string;
  /** Classifica uma linha na coluna. `null` = não pertence a esta coluna. */
  match: (row: Record<string, unknown> & { id: string }) => boolean;
  /**
   * Cor de identificação da coluna, como valor CSS (ex.: `#b45309`).
   *
   * Aplicada como borda superior, que é a convenção que o quadro de faturamento já usava para
   * distinguir os estágios. A engine NÃO conhece a paleta: recebe a cor e a desenha. Sem ela,
   * a coluna sai neutra — o que é correto, não uma suposição.
   */
  accent?: string;
  /** Texto quando a coluna está vazia. Padrão: "Vazio". */
  emptyText?: string;
};

export function DynamicKanban({
  schema,
  rows,
  cardFields: declaredCardFields,
  onCardClick,
  stateLabel,
  ownerField,
  agingField,
  badges,
  onCardDrop,
  derivedColumns,
  renderCardHeader,
  renderCardFlag,
}: DynamicKanbanProps): React.ReactElement {
  const kanbanView = schema?.views.find((view) => view.viewType === 'kanban') ?? null;
  const groupBy = kanbanView?.layout.groupBy ?? schema?.workflow?.stateField;
  const cardFieldNames = kanbanView?.layout.cardFields ?? (schema ? [schema.labelField] : []);
  const { dropState, handleDragStart, handleDragEnd, handleDragOver, handleDrop } =
    useDragAndDrop();

  const states = schema?.workflow?.states ?? [];
  const schemaFields = schema?.fields;
  const cardFields = useMemo(() => {
    if (declaredCardFields) {
      return declaredCardFields;
    }
    if (!schemaFields) {
      return [];
    }
    return cardFieldNames
      .map((name) => schemaFields.find((field) => field.name === name))
      .filter((field): field is MetaField => field !== undefined);
  }, [declaredCardFields, cardFieldNames, schemaFields]);
  const owner = ownerField
    ? schemaFields?.find((field) => field.name === ownerField) ?? null
    : null;
  const aging = resolveAging(schema, agingField);

  const byState = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown> & { id: string }>>();
    for (const state of states) {
      map.set(state, []);
    }
    for (const row of rows) {
      const key = groupBy ? toDisplayText(row[groupBy]) : '';
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(row);
      }
    }
    return map;
  }, [rows, states, groupBy]);

  /**
   * Colunas derivadas: cada linha entra na PRIMEIRA coluna que a reivindica, e só numa.
   *
   * Primeira-e-única porque uma linha em duas colunas inflaria as contagens e faria o mesmo
   * registro aparecer duas vezes no quadro. A ordem de `derivedColumns` é, portanto,
   * significativa — quem fornece as colunas declara a precedência.
   */
  const byDerived = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown> & { id: string }>>();
    if (!derivedColumns) {
      return map;
    }
    for (const column of derivedColumns) {
      map.set(column.key, []);
    }
    for (const row of rows) {
      const column = derivedColumns.find((candidate) => candidate.match(row));
      if (column) {
        map.get(column.key)?.push(row);
      }
    }
    return map;
  }, [rows, derivedColumns]);

  if (derivedColumns && derivedColumns.length > 0) {
    return (
      <div
        className="flex gap-3 overflow-x-auto"
        data-testid="dynamic-kanban"
        data-entity={schema?.name ?? null}
        data-grouping="derived"
      >
        {derivedColumns.map((column) => (
          <KanbanColumn
            key={column.key}
            columnKey={column.key}
            title={column.title}
            description={column.description}
            accent={column.accent}
            emptyText={column.emptyText}
            cards={byDerived.get(column.key) ?? []}
            cardFields={cardFields}
            owner={owner}
            aging={aging}
            badges={badges}
            onCardClick={onCardClick}
            isDropTarget={false}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            rows={rows}
            onCardDrop={onCardDrop}
            renderCardHeader={renderCardHeader}
            renderCardFlag={renderCardFlag}
            handleDragStart={handleDragStart}
            handleDragEnd={handleDragEnd}
          />
        ))}
      </div>
    );
  }

  if (!groupBy || states.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="dynamic-kanban-unavailable">
        Esta entidade não declara workflow com estados — o kanban não tem por onde agrupar.
      </p>
    );
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto"
      data-testid="dynamic-kanban"
      data-entity={schema?.name ?? null}
      data-grouping="workflow"
    >
      {states.map((state) => (
        <KanbanColumn
          key={state}
          columnKey={state}
          title={stateLabel ? stateLabel(state) : state}
          cards={byState.get(state) ?? []}
          cardFields={cardFields}
          owner={owner}
          aging={aging}
          badges={badges}
          onCardClick={onCardClick}
          isDropTarget={dropState === state}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          rows={rows}
          onCardDrop={onCardDrop}
          renderCardHeader={renderCardHeader}
          renderCardFlag={renderCardFlag}
          handleDragStart={handleDragStart}
          handleDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}

/**
 * Uma coluna do quadro — compartilhada pelo agrupamento por workflow e pelo derivado.
 *
 * Existe UMA implementação de cartão. Duplicá-la para o caminho derivado faria os dois
 * divergirem: o cartão enriquecido (dono, aging, badges) apareceria só em um dos eixos.
 */
function KanbanColumn({
  columnKey,
  title,
  description,
  accent,
  emptyText,
  cards,
  cardFields,
  owner,
  aging,
  badges,
  onCardClick,
  isDropTarget,
  onDragOver,
  onDrop,
  rows,
  onCardDrop,
  renderCardHeader,
  renderCardFlag,
  handleDragStart,
  handleDragEnd,
}: {
  columnKey: string;
  title: string;
  description?: string;
  accent?: string;
  emptyText?: string;
  cards: Array<Record<string, unknown> & { id: string }>;
  cardFields: MetaField[];
  owner: MetaField | null;
  aging: MetaField | null;
  badges?: (row: Record<string, unknown> & { id: string }) => DynamicKanbanCardBadge[];
  onCardClick?: (row: Record<string, unknown> & { id: string }) => void;
  isDropTarget: boolean;
  onDragOver: (event: React.DragEvent, state: string) => void;
  onDrop: (
    event: React.DragEvent,
    state: string,
    onDropped: (cardId: string) => void,
  ) => void;
  rows: Array<Record<string, unknown> & { id: string }>;
  onCardDrop?: (row: Record<string, unknown> & { id: string }, targetState: string) => void;
  renderCardHeader?: (row: Record<string, unknown> & { id: string }) => ReactNode;
  renderCardFlag?: (
    row: Record<string, unknown> & { id: string },
  ) => { content: ReactNode; accent?: string } | null;
  handleDragStart: (cardId: string) => void;
  handleDragEnd: () => void;
}): React.ReactElement {
  return (
    <section
      className={`min-w-56 flex-1 rounded-lg border bg-gray-50 ${
        isDropTarget ? 'border-slate-500 ring-2 ring-slate-400/40' : 'border-gray-200'
      }`}
      aria-label={title}
      data-kanban-column={columnKey}
      data-drop-target={isDropTarget ? 'true' : 'false'}
      data-column-accent={accent ?? null}
      /* A cor vem do CHAMADOR. A engine não tem paleta de domínio: ela desenha a que recebe. */
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
      onDragOver={(event) => onDragOver(event, columnKey)}
      onDrop={(event) =>
        onDrop(event, columnKey, (cardId) => {
          const card = rows.find((row) => row.id === cardId);
          if (card && onCardDrop) {
            onCardDrop(card, columnKey);
          }
        })
      }
    >
      <header className="border-b border-gray-200 px-2 py-1.5">
        <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
        {description ? <p className="text-[11px] text-gray-500">{description}</p> : null}
        <p className="text-[11px] text-gray-500" data-kanban-count={columnKey}>
          {cards.length}
        </p>
      </header>
      <ul className="space-y-2 p-2">
        {cards.map((card) => (
          <li key={card.id}>
            <article
              data-testid="dynamic-kanban-card"
              data-card-id={card.id}
              data-card-state={columnKey}
              draggable={onCardDrop !== undefined}
              onDragStart={onCardDrop ? () => handleDragStart(card.id) : undefined}
              onDragEnd={onCardDrop ? handleDragEnd : undefined}
              className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left"
            >
              {renderCardHeader ? (
                /*
                 * CABEÇALHO DA TELA: é onde o identificador vira LINK de verdade. O clique
                 * aqui NÃO usa `onCardClick` — quem navega é o próprio link, preservando
                 * histórico e abrir-em-nova-aba. Parar a propagação evita navegação dupla.
                 */
                <div
                  className="cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {renderCardHeader(card)}
                </div>
              ) : null}

              <div
                className={onCardClick ? 'cursor-pointer' : undefined}
                onClick={onCardClick ? () => onCardClick(card) : undefined}
              >
                {cardFields.map((field) => (
                  <span key={field.name} className="block text-xs">
                    <span className="text-gray-500">{field.label}: </span>
                    <FieldRenderer field={field} value={card[field.name]} />
                  </span>
                ))}

                {owner || aging ? (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    {owner ? (
                      <span
                        data-testid="dynamic-kanban-owner"
                        className="text-[11px] text-gray-600"
                      >
                        {toDisplayText(card[owner.name]).trim() === ''
                          ? 'Sem responsável'
                          : toDisplayText(card[owner.name])}
                      </span>
                    ) : null}
                    {aging ? <AgingBadge value={card[aging.name]} /> : null}
                  </span>
                ) : null}

                {badges ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {badges(card).map((badge) => (
                      <span
                        key={badge.label}
                        data-testid="dynamic-kanban-badge"
                        data-badge-label={badge.label}
                        className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badgeToneClass(badge.tone)}`}
                      >
                        {badge.label}: {badge.value}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>

              {renderCardFlag
                ? (() => {
                    const flag = renderCardFlag(card);
                    if (!flag) {
                      return null;
                    }
                    return (
                      <div
                        data-testid="dynamic-kanban-flag"
                        data-flag-accent={flag.accent ?? null}
                        className="mt-1 text-[11px] font-semibold"
                        style={flag.accent ? { color: flag.accent } : undefined}
                      >
                        {flag.content}
                      </div>
                    );
                  })()
                : null}
            </article>
          </li>
        ))}
        {cards.length === 0 ? (
          <li className="px-1 py-2 text-[11px] text-gray-400" data-kanban-empty={columnKey}>
            {emptyText ?? 'Vazio'}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
function resolveAging(
  schema: MetaEntitySchema | null,
  explicit?: string,
): MetaField | null {
  if (!schema) {
    return null;
  }
  if (explicit) {
    return schema.fields.find((field) => field.name === explicit) ?? null;
  }
  return schema.fields.find((field) => field.name === 'created_at') ?? null;
}

function badgeToneClass(tone: DynamicKanbanCardBadge['tone']): string {
  if (tone === 'critical') {
    return 'bg-red-50 text-red-700 ring-red-500/20';
  }
  if (tone === 'warning') {
    return 'bg-amber-50 text-amber-700 ring-amber-500/20';
  }
  if (tone === 'info') {
    return 'bg-blue-50 text-blue-700 ring-blue-500/20';
  }
  return 'bg-slate-50 text-slate-700 ring-slate-500/20';
}
