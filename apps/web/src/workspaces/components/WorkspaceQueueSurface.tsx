import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import { DynamicSavedViewsBar, useSavedViews } from '../../engine';
import {
  WORK_DOMAIN_LABELS,
  WORK_DOMAINS,
  type WorkDomain,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { WorklistException, worklistSelectClass } from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';
import { ContextDrawer, type ContextField } from '../../operator';
import { isTechnicalIdentity } from '../../shell/format-identity';
import {
  OperationalUnitOptions,
  operationalUnitLabel,
  useOperationalUnits,
} from '../../shell/hooks/useOperationalUnits';
import { useWorkspaceQueue } from '../api/use-workspace-queue';
import {
  ALL_WORKSPACE_QUEUE_SCOPE,
  WORKSPACE_QUEUE_KINDS,
  coverageLabel,
  isAllScope,
  scopeEquals,
  scopeFromSavedFilters,
  scopeFromSearchParams,
  scopeFromSearchParams as scopeFromUrl,
  scopeLabel,
  scopeToSavedFilters,
  scopeToSearchParams,
  unavailableWorkNotice,
  workInboxHref,
  type WorkspaceQueueScope,
} from '../api/workspace-queue-model';

/**
 * FILA DE TRABALHO — a superficie unica de fila do produto.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE COMPONENTE EXISTE
 *
 * O CISNE tinha QUATRO filas desenhadas separadamente: a do painel operacional, a do My Inbox, a do
 * workspace financeiro e a dos workspaces de dominio. Todas liam o MESMO read model
 * (`GET /work-inbox`) e todas divergiam no que importa — uma dizia `total` e a outra dizia o tamanho
 * do array; uma tratava leitura parcial e a outra mostrava a zona vazia; uma tinha visoes salvas e a
 * outra nao.
 *
 * Aqui a fila e escrita UMA vez. Cada superficie diz QUEM ela e (dominio, titulo, recorte inicial) e
 * recebe o mesmo comportamento: recorte no servidor, contexto sem sair da fila, proxima acao real,
 * visoes salvas, estados de carga/negado/erro/vazio honestos e a saida para o conjunto completo.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SUPERFICIE NAO FAZ
 *
 * - Nao filtra no navegador. O recorte inteiro (`domain`, `kind`, `overdue`, `unitId`) vai ao
 *   SERVIDOR; a pagina recebida nunca e re-filtrada, porque filtrar no cliente esconderia itens que
 *   ficaram fora da pagina e apresentaria uma amostra como se fosse o conjunto.
 * - Nao conta. `total` e o numero publicado pelo servidor sob o MESMO recorte; `items.length` e a
 *   amostra desta pagina. As duas aparecem ditas e separadas na faixa da fila.
 * - Nao inventa pendencia, prioridade, score ou criticidade. A unica excecao afirmada e a que o dado
 *   sustenta: item com vencimento PERSISTIDO no passado.
 * - Nao esconde leitura parcial: `unavailableDomains` e dito em voz alta, e a zona nao aparece
 *   vazia por causa dele.
 * - Nao executa transicao sensivel. A acao da linha e a proxima acao que o read model publicou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ONDE O RECORTE VIVE
 *
 * `'url'`   — a tela E a fila (My Inbox): recarregar, voltar e compartilhar preservam o conjunto.
 * `'local'` — a fila e uma zona dentro de outra tela (workspace financeiro, workspace de dominio):
 *             o recorte e local e as visoes salvas fazem o papel de persistencia.
 *
 * `showScopeBar` desliga a barra de recortes rapidos quando a tela JA publica a propria barra de
 * filtros governada — duas barras de filtro na mesma superficie seriam dois lugares para a mesma
 * pergunta.
 */

const DEFAULT_LIMIT = 6;

/** Rotulo humano do prazo. `sem prazo` e um fato do dado, nao um vazio a preencher. */
function formatMoment(value: string | null): string {
  if (!value) {
    return 'sem prazo';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'sem prazo' : date.toLocaleDateString('pt-BR');
}

/**
 * Dias corridos desde o vencimento PERSISTIDO. `null` quando nao ha vencimento ou ele e futuro.
 *
 * Nao existe score nem criticidade calculada: a unica excecao que a fila afirma e esta.
 */
export function daysOverdue(value: string | null, now: Date = new Date()): number | null {
  if (!value) {
    return null;
  }
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const elapsed = Math.floor((startOfDay(now) - startOfDay(due)) / 86_400_000);
  return elapsed > 0 ? elapsed : null;
}

/**
 * Fatos do contexto — SO o que e humano.
 *
 * `status` do read model e o estado PERSISTIDO do dominio (codigo interno). Ele aparece como
 * SITUACAO porque e o que o servidor publicou, e nao vira rotulo traduzido aqui: traduzir estado de
 * dominio na camada de fila seria uma segunda tabela de estados para o mesmo dado. A unidade entra
 * apenas quando o proprio dominio publica um codigo legivel.
 */
function contextFacts(item: WorkItem, unitLabel: string | null): ContextField[] {
  const facts: ContextField[] = [
    { label: 'Domínio', value: WORK_DOMAIN_LABELS[item.domain] },
    { label: 'Natureza', value: item.kind },
    { label: 'Situação', value: item.status },
    { label: 'Motivo', value: item.reason },
    { label: 'Contexto', value: item.contextLabel || '—' },
    { label: 'Ocorrido em', value: formatMoment(item.occurredAt) },
    { label: 'Prazo', value: formatMoment(item.dueAt) },
  ];

  if (unitLabel) {
    facts.push({ label: 'Unidade', value: unitLabel });
  }

  return facts;
}

export type WorkspaceQueueSurfaceProps = {
  title: string;
  /**
   * Nome acessivel da regiao.
   *
   * Existe porque a MESMA tela pode publicar mais de uma fila — o workspace financeiro publica a
   * fila de CATEGORIAS de excecao e a fila de ITENS de trabalho — e duas regioes com nomes iguais
   * nao podem ser distinguidas por quem le a tela. O titulo visivel continua sendo `title`.
   */
  ariaLabel?: string;
  description?: string;
  /** Teto de linhas por pagina. */
  limit?: number;
  /** Chave de persistencia das visoes salvas — o recorte de um dominio nao polui o de outro. */
  savedViewsScope: string;
  /** `'url'` = a tela E a fila; `'local'` = a fila e uma zona de outra tela. */
  scopeSource: 'url' | 'local';
  /** Recorte inicial. Em `scopeSource: 'url'` funciona como PADRAO quando a URL nao traz recorte. */
  initialScope?: WorkspaceQueueScope;
  /**
   * Dominios que a superficie NAO oferece como recorte — tipicamente porque ela JA E o dominio.
   * O `domain` do escopo continua sendo aplicado em silencio (nao e um filtro do operador, e a
   * identidade da tela).
   */
  lockDomain?: WorkDomain | null;
  /** Barra de recortes rapidos (natureza/vencido). Desligue quando a tela ja tem barra propria. */
  showScopeBar?: boolean;
  /** Filtro de unidade na barra. So faz sentido em telas multi-unidade (My Inbox). */
  showUnitFilter?: boolean;
  /** Paginacao do servidor. Desligada por padrao: zonas mostram amostra e oferecem a fila completa. */
  paginate?: boolean;
  /** Renderizado na barra de titulo da fila. */
  headerAction?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

export function WorkspaceQueueSurface({
  title,
  ariaLabel,
  description,
  limit = DEFAULT_LIMIT,
  savedViewsScope,
  scopeSource,
  initialScope,
  lockDomain = null,
  showScopeBar = true,
  showUnitFilter = false,
  paginate = false,
  headerAction,
  emptyTitle,
  emptyDescription,
  className,
}: WorkspaceQueueSurfaceProps) {
  const identityId = useOptionalIdentityId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { options: unitOptions } = useOperationalUnits();

  const baseScope: WorkspaceQueueScope = initialScope ?? ALL_WORKSPACE_QUEUE_SCOPE;
  const [localScope, setLocalScope] = useState<WorkspaceQueueScope>(baseScope);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * O DOMINIO TRAVADO E IDENTIDADE DA TELA, NAO FILTRO.

   * Quando a superficie JA E o dominio (workspace financeiro, workspace de operacoes), o `domain`
   * do escopo vem da tela e nao pode ser trocado pelo operador dentro dela: um seletor de dominio
   * ali ofereceria "ver Financeiro dentro do Financeiro". O dominio entra no escopo sempre, e a
   * barra apenas nao o oferece.
   */
  const urlScope = scopeSource === 'url' ? scopeFromSearchParams(searchParams) : null;
  const declaredScope = urlScope ?? localScope;
  const effectiveScope: WorkspaceQueueScope = {
    ...declaredScope,
    domain: lockDomain ?? declaredScope.domain,
  };

  const offset = paginate ? Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0 : 0;

  const applyScope = useCallback(
    (next: WorkspaceQueueScope) => {
      const normalized: WorkspaceQueueScope = { ...next, domain: lockDomain ?? next.domain };
      if (scopeSource === 'url') {
        setSearchParams(scopeToSearchParams(normalized), { replace: true });
        return;
      }
      setLocalScope(normalized);
    },
    [lockDomain, scopeSource, setSearchParams],
  );

  /*
   * Trocar de recorte NAO mantem a selecao: o item selecionado pode nao pertencer ao novo conjunto,
   * e um drawer aberto sobre um item que sumiu da fila e contexto de outra pergunta.
   */
  useEffect(() => {
    setSelectedId(null);
  }, [effectiveScope.domain, effectiveScope.kind, effectiveScope.overdue, effectiveScope.unitId]);

  const { state, reload } = useWorkspaceQueue({
    scope: effectiveScope,
    limit,
    offset,
  });

  const savedViews = useSavedViews(identityId ?? null, savedViewsScope);
  const activeSavedView =
    savedViews.views.find((view) =>
      scopeEquals(scopeFromSavedFilters(view.filters), effectiveScope),
    ) ?? null;

  const items = state.phase === 'ready' ? state.items : [];
  const page = state.phase === 'ready' ? state.page : null;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const total = page?.total ?? null;
  const fullQueueHref = workInboxHref(effectiveScope);
  const incompleteNotice = page ? unavailableWorkNotice(page.unavailableDomains) : null;

  const unitLabel = (unitId: string) => operationalUnitLabel(unitOptions, unitId, 'Unidade autorizada');

  const selectedUnitLabel =
    selected && selected.unitId && !isTechnicalIdentity(selected.unitId)
      ? unitLabel(selected.unitId)
      : null;

  return (
    <div className={className}>
      <WorkbenchQueue
        title={title}
        regionLabel={ariaLabel}
        count={total}
        description={
          state.phase === 'loading'
            ? 'Lendo o trabalho do recorte no servidor…'
            : state.phase === 'ready' && page
              ? [
                  coverageLabel(page, items.length),
                  scopeDescription(effectiveScope, lockDomain),
                  description,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : description
        }
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={workbenchSecondaryActionClass} onClick={reload}>
              Atualizar
            </button>
            {/*
              A ACAO DO CABECALHO SO EXISTE QUANDO HA LINHA PARA ROLAR.

              Com a fila cheia, "Abrir fila completa" e a saida do cabecalho. Com a fila vazia, o
              mesmo destino ja aparece dentro do estado vazio — duas ocorrencias seriam o MESMO
              destino oferecido duas vezes na mesma dobra, com dois alvos identicos para o mesmo
              clique. No vazio quem governa a saida e o estado vazio.
            */}
            {items.length > 0 && !paginate ? (
              <Link className={workbenchSecondaryActionClass} to={fullQueueHref}>
                Abrir fila completa
              </Link>
            ) : null}
            {headerAction}
          </div>
        }
        emptyTitle={
          state.phase === 'denied'
            ? 'Fila indisponível'
            : state.phase === 'error'
              ? 'Não foi possível ler a fila'
              : (emptyTitle ?? 'Nenhum trabalho pendente neste recorte.')
        }
        emptyDescription={
          state.phase === 'denied'
            ? 'Você não tem permissão para ler esta fila de trabalho.'
            : state.phase === 'error'
              ? state.message
              : (emptyDescription ??
                'A fila não inventa pendência para parecer cheia. Ajuste o recorte ou abra a fila completa.')
        }
        emptyAction={
          state.phase === 'ready' ? (
            <>
              {!isAllScope(effectiveScope) ? (
                <button
                  type="button"
                  className={workbenchSecondaryActionClass}
                  onClick={() => applyScope(ALL_WORKSPACE_QUEUE_SCOPE)}
                >
                  {declaredScope.domain || lockDomain ? 'Ver todo o domínio' : 'Ver toda a fila'}
                </button>
              ) : null}
              {!paginate ? (
                <Link className={workbenchPrimaryActionClass} to={fullQueueHref}>
                  Abrir fila completa
                </Link>
              ) : null}
            </>
          ) : null
        }
      >
        {/*
          VISOES SALVAS — o modo de trabalho do operador, na propria area de trabalho.
          A barra persiste apenas o RECORTE que o servidor executa: guardar dado de negocio dentro de
          uma visao seria manter uma copia de dado autoritativo no navegador.
        */}
        <div className="border-b border-gray-100 px-2.5 py-1.5">
          <DynamicSavedViewsBar
            views={savedViews.views}
            persistedLocally={savedViews.persistedLocally}
            persistable={savedViews.persistable}
            onSave={(name) => savedViews.save(name, scopeToSavedFilters(effectiveScope), 'list')}
            onDelete={savedViews.remove}
            onApply={(view) => applyScope(scopeFromSavedFilters(view.filters))}
          />
        </div>

        {showScopeBar ? (
          /*
            RECORTES DE SISTEMA — exatamente as dimensoes que o contrato do read model executa.
            Uma visao que o servidor nao executa voltaria como lista inteira e o operador acharia que
            recortou.
          */
          <ul
            aria-label="Recortes da fila"
            className="m-0 flex list-none flex-wrap items-center gap-1.5 border-b border-gray-100 bg-gray-50/60 px-2.5 py-1.5"
          >
            <li>
              <ScopeButton
                active={isAllScope(effectiveScope)}
                label="Tudo"
                onClick={() => applyScope({ ...effectiveScope, kind: null, overdue: false })}
              />
            </li>
            {WORKSPACE_QUEUE_KINDS.map((recorte) => (
              <li key={recorte.kind}>
                <ScopeButton
                  active={effectiveScope.kind === recorte.kind && !effectiveScope.overdue}
                  label={recorte.label}
                  onClick={() =>
                    applyScope({ ...effectiveScope, kind: recorte.kind, overdue: false })
                  }
                />
              </li>
            ))}
            <li>
              <ScopeButton
                active={effectiveScope.overdue}
                label="Somente vencidos"
                onClick={() => applyScope({ ...effectiveScope, kind: null, overdue: true })}
              />
            </li>
            {showUnitFilter ? (
              <li className="ml-1">
                <select
                  aria-label="Unidade"
                  value={effectiveScope.unitId ?? ''}
                  onChange={(event) =>
                    applyScope({ ...effectiveScope, unitId: event.target.value || null })
                  }
                  className={cn(worklistSelectClass, 'w-44')}
                >
                  <OperationalUnitOptions options={unitOptions} includeAllLabel="Todas as unidades" />
                </select>
              </li>
            ) : null}
            {activeSavedView ? (
              <li className="cisne-type-helper ml-1">Visão: {activeSavedView.name}</li>
            ) : null}
          </ul>
        ) : null}

        {incompleteNotice ? (
          <p
            role="status"
            className="m-0 border-b border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
          >
            {incompleteNotice}
          </p>
        ) : null}

        {items.map((item) => {
          const late = daysOverdue(item.dueAt);
          return (
            <WorkbenchQueueItem
              key={item.id}
              severity={
                late !== null ? (
                  <WorklistException tone="critical">
                    {late} dia{late === 1 ? '' : 's'} em atraso
                  </WorklistException>
                ) : (
                  <WorklistException tone={item.kind === 'BLOCKER' ? 'warning' : 'info'}>
                    {item.kind}
                  </WorklistException>
                )
              }
              severityTone={late !== null ? 'critical' : item.kind === 'BLOCKER' ? 'warning' : 'info'}
              title={item.title}
              reason={item.reason}
              context={
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    title="Ver o contexto deste trabalho"
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    {item.businessReference}
                  </button>
                  <span className="ml-3">{item.contextLabel || WORK_DOMAIN_LABELS[item.domain]}</span>
                </>
              }
              age={<>Vencimento {formatMoment(item.dueAt)}</>}
              action={
                <Link className={workbenchPrimaryActionClass} to={item.targetRoute}>
                  {item.actionLabel}
                </Link>
              }
            />
          );
        })}
      </WorkbenchQueue>

      {paginate && page && page.totalPages > 1 ? (
        <div className="mt-1 mb-2 flex items-center justify-between text-xs text-gray-600">
          <span className="tabular-nums">
            {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} de {page.total}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className={workbenchSecondaryActionClass}
              disabled={page.offset === 0}
              onClick={() => setOffsetParam(searchParams, setSearchParams, Math.max(0, page.offset - page.limit))}
            >
              Anterior
            </button>
            <button
              type="button"
              className={workbenchSecondaryActionClass}
              disabled={page.offset + page.limit >= page.total}
              onClick={() => setOffsetParam(searchParams, setSearchParams, page.offset + page.limit)}
            >
              Próxima
            </button>
          </span>
        </div>
      ) : null}

      {/*
        CONTEXTO DO ITEM — o MESMO primitivo lateral das listas maduras. Nao duplica Object Page:
        entrega o suficiente para decidir e o atalho para o objeto completo, sem sair da fila.
      */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelectedId(null)}
        preview={
          selected
            ? {
                identifier: selected.businessReference,
                subtitle: selected.title,
                facts: contextFacts(selected, selectedUnitLabel),
                nextAction: {
                  label: selected.actionLabel,
                  href: selected.targetRoute,
                  kind: 'primary',
                },
                detailHref: selected.targetRoute,
                detailLabel: 'Abrir objeto completo',
              }
            : null
        }
      />
    </div>
  );
}

function setOffsetParam(
  current: URLSearchParams,
  setSearchParams: (next: URLSearchParams, options?: { replace?: boolean }) => void,
  offset: number,
): void {
  const next = new URLSearchParams(current);
  if (offset > 0) {
    next.set('offset', String(offset));
  } else {
    next.delete('offset');
  }
  setSearchParams(next, { replace: true });
}

/** Procedencia do recorte, em uma linha: o operador sabe QUAL conjunto esta lendo. */
function scopeDescription(scope: WorkspaceQueueScope, lockDomain: WorkDomain | null): string {
  const domain = lockDomain ?? scope.domain;
  const parts = [scopeLabel(scope)];
  parts.push(domain ? WORK_DOMAIN_LABELS[domain] : `${WORK_DOMAINS.length} domínios autorizados`);
  if (scope.unitId) {
    parts.push('unidade autorizada');
  }
  return parts.join(' · ');
}

function ScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded border px-2 py-0.5 text-xs',
        active
          ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
          : 'border-gray-300 bg-white font-medium text-gray-600 hover:bg-gray-50',
      )}
    >
      {label}
    </button>
  );
}

/** Reexportado para os testes de deep link — o recorte da URL e o mesmo vocabulario. */
export { scopeFromUrl };
