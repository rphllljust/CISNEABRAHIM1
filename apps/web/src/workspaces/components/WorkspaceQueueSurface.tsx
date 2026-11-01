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
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { WorklistException, worklistSelectClass } from '../../ui/enterprise-list';
import {
  ContextFacts,
  ContextSection,
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspacePane,
  WorkspacePaneHeader,
  WorkspaceSkeletonRows,
} from '../../ui/workspace-frame';
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
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/*
        BANCADA DE FILA — GRADE ELASTICA: a fila ocupa a altura que o shell deixou.

        Antes esta superficie era um bloco que crescia com o conteudo: com a fila vazia ela media
        329px e o resto da viewport ficava branco (medido em 1600x900: conteudo terminava em y=624
        de 900 — 276px vazios). Agora a fila vive dentro de `WorkspaceBody`, que e uma grade de altura
        total, e as duas colunas (fila e contexto) acompanham a tela em vez de encolherem ate o dado.

        ZERO ITENS NAO DESMONTA A BANCADA: cabecalho, visoes, recortes, barra de filtros e a coluna
        de contexto continuam montados; o que muda e apenas o miolo da grade.
      */}
      <WorkspaceBody
        context={
          <WorkspacePane
            aria-label="Contexto da decisão"
            surface="support"
            className="hidden h-full overflow-auto xl:flex"
          >
            <WorkspacePaneHeader title="Contexto da decisão" />
            {selected ? (
              <ContextSection title="Trabalho selecionado">
                <p className="m-0 text-[13px] font-semibold text-[color:var(--color-text-primary)]">
                  {selected.businessReference}
                </p>
                <p className="m-0 mt-0.5 text-[12px] text-[color:var(--color-text-secondary)]">
                  {selected.title}
                </p>
                <ContextFacts
                  facts={contextFacts(selected, selectedUnitLabel).map((fact) => ({
                    label: fact.label,
                    value: fact.value,
                  }))}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link className={workbenchPrimaryActionClass} to={selected.targetRoute}>
                    {selected.actionLabel}
                  </Link>
                </div>
              </ContextSection>
            ) : (
              /*
                SEM ITEM SELECIONADO — E, PRINCIPALMENTE, SEM ITEM NENHUM.

                A coluna de contexto e o que faz a fila vazia continuar sendo uma RESPOSTA. Ela diz
                qual recorte foi lido, quais dominios responderam, quantos itens existem e o que
                entra nesta fila. Sem isso, "0 trabalhos" e indistinguivel de "a tela quebrou" — e
                era exatamente o que o operador via antes: uma mensagem e 276px de branco.
              */
              <>
                <ContextSection title="Recorte lido">
                  <ContextFacts
                    facts={[
                      { label: 'Domínio', value: scopeDescription(effectiveScope, lockDomain) },
                      { label: 'Itens publicados', value: total === null ? 'Não lido' : String(total) },
                      {
                        label: 'Nesta página',
                        value: state.phase === 'ready' ? String(items.length) : 'Não lido',
                      },
                    ]}
                  />
                </ContextSection>

                <ContextSection title="Domínios consultados">
                  {page ? (
                    <ContextFacts
                      facts={WORK_DOMAINS.map((domain) => ({
                        label: WORK_DOMAIN_LABELS[domain],
                        value: page.unavailableDomains.includes(domain)
                          ? 'Não respondeu'
                          : String(page.byDomain[domain] ?? 0),
                      }))}
                    />
                  ) : (
                    <p className="cisne-type-helper m-0">
                      A leitura por domínio não foi publicada nesta consulta.
                    </p>
                  )}
                </ContextSection>

                <ContextSection title="O que entra nesta fila">
                  {/*
                    CONTEXTO E DADO DE NEGOCIO, NAO TUTORIAL.

                    Aqui havia tres bullets INSTRUCIONAIS ("Excecoes e bloqueios publicados pelos
                    dominios autorizados", "A fila nao inventa pendencia..."). Isso e texto de AJUDA
                    ocupando a coluna mais cara da tela — a coluna que existe para responder "o que e
                    este trabalho". Um ERP Tier-1 nao explica o proprio produto dentro do contexto
                    operacional: ele mostra o FATO.

                    O que fica no lugar e o mesmo conteudo, dito como CONTRATO DO RECORTE: quais
                    dimensoes o servidor executou e quantas publicaram trabalho. O operador sai daqui
                    sabendo o que a fila contem AGORA, e nao como usar a tela.
                  */}
                  <ContextFacts
                    facts={[
                      {
                        label: 'Recorte',
                        value: isAllScope(effectiveScope)
                          ? 'Todos os tipos publicados'
                          : (WORKSPACE_QUEUE_KINDS.find(
                              (recorte) =>
                                recorte.kind === effectiveScope.kind && !effectiveScope.overdue,
                            )?.label ?? 'Somente vencidos'),
                      },
                      {
                        label: 'Prazo',
                        value: effectiveScope.overdue ? 'Somente vencidos' : 'Todos os prazos',
                      },
                      {
                        label: 'Unidade',
                        value: effectiveScope.unitId ? selectedUnitLabel : 'Todas as unidades',
                      },
                      {
                        label: 'Domínios com trabalho',
                        value: page
                          ? String(
                              WORK_DOMAINS.filter((domain) => (page.byDomain[domain] ?? 0) > 0).length,
                            )
                          : 'Não lido',
                      },
                    ]}
                  />
                </ContextSection>

                {incompleteNotice ? (
                  <ContextSection title="Leitura parcial">
                    <p className="m-0 text-[12px] text-[color:var(--color-amber-700)]">
                      {incompleteNotice}
                    </p>
                  </ContextSection>
                ) : null}
              </>
            )}
          </WorkspacePane>
        }
      >
        <WorkspacePane className="h-full overflow-hidden">
          {/* CABECALHO DA FILA — identidade da regiao, contagem do servidor e comandos. */}
          <WorkspacePaneHeader
            title={title}
            count={total ?? undefined}
            action={
              <>
                <button type="button" className={workbenchSecondaryActionClass} onClick={reload}>
                  Atualizar
                </button>
                {/*
                  A ACAO DO CABECALHO SO EXISTE QUANDO HA LINHA PARA ROLAR.
                  Com a fila cheia, "Abrir fila completa" e a saida do cabecalho. Com a fila vazia, o
                  mesmo destino ja aparece dentro do estado vazio — duas ocorrencias seriam o MESMO
                  destino oferecido duas vezes na mesma dobra, com dois alvos identicos.
                */}
                {items.length > 0 && !paginate ? (
                  <Link className={workbenchSecondaryActionClass} to={fullQueueHref}>
                    Abrir fila completa
                  </Link>
                ) : null}
                {headerAction}
              </>
            }
          />

          {/*
            VISOES SALVAS — o modo de trabalho do operador, na propria area de trabalho.
            A barra persiste apenas o RECORTE que o servidor executa: guardar dado de negocio dentro
            de uma visao seria manter uma copia de dado autoritativo no navegador.
          */}
          <div className="shrink-0 border-b border-[color:var(--color-divider)] px-3 py-1.5">
            <DynamicSavedViewsBar
              views={savedViews.views}
              persistedLocally={savedViews.persistedLocally}
              persistable={savedViews.persistable}
              statusMessage={savedViews.notice ?? (savedViews.loading ? 'Carregando visões do servidor…' : null)}
              onSave={(name) => savedViews.save(name, scopeToSavedFilters(effectiveScope), 'list')}
              onDelete={savedViews.remove}
              onApply={(view) => applyScope(scopeFromSavedFilters(view.filters))}
            />
          </div>

          {showScopeBar ? (
            /*
              RECORTES DE SISTEMA — exatamente as dimensoes que o contrato do read model executa.
              Uma visao que o servidor nao executa voltaria como lista inteira e o operador acharia
              que recortou.
            */
            <ul
              aria-label="Recortes da fila"
              className="m-0 flex shrink-0 list-none flex-wrap items-center gap-1.5 border-b border-[color:var(--color-divider)] px-3 py-1.5"
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
              className="m-0 shrink-0 border-b border-[color:var(--color-amber-200)] bg-[color:var(--color-surface-warning)] px-3 py-1.5 text-[11px] text-[color:var(--color-amber-700)]"
            >
              {incompleteNotice}
            </p>
          ) : null}

          {/*
            CORPO DA FILA — a area elastica E a regiao nomeada da fila.

            E uma `<section>` com o nome acessivel da fila (`ariaLabel`), como era antes: a linha de
            trabalho precisa estar DENTRO da secao que a contem — e a assercao que garante que o item
            pertence a fila, com referencia humana, motivo, prazo e acao. Um `<div>` de rolagem
            anonimo quebraria essa leitura (e o leitor de tela perderia o landmark).

            Com itens, e a lista; sem itens, e o estado vazio COMPACTO — a moldura em volta permanece
            (visoes, recortes, cabecalho, contexto), que e a regra de "zero itens nao desmonta a
            bancada".
          */}
          <section
            aria-label={ariaLabel ?? title}
            aria-busy={state.phase === 'loading'}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {/*
              DESCRICAO DO RECORTE — a procedencia do conjunto, DENTRO da regiao nomeada da fila.

              `coverageLabel` ("Exibindo N de M itens" / "1 de 1 item no recorte") tem de estar dentro
              da secao "Fila de trabalho": e ela que impede a PAGINA de passar por CONJUNTO. Fora do
              landmark, quem le a fila por regiao nao recebe essa declaracao — que e exatamente o
              defeito que o `total` do read model existe para impedir.

              A descricao da superficie (o que ESTA fila e) acompanha a cobertura na mesma linha: as
              duas descrevem o recorte carregado, e separa-las custaria uma segunda faixa.
            */}
            <p className="m-0 shrink-0 border-b border-[color:var(--color-divider)] px-3 py-1 text-[11px] text-[color:var(--color-text-muted)]">
              {[
                state.phase === 'loading'
                  ? 'Lendo o trabalho do recorte no servidor…'
                  : state.phase === 'ready' && page
                    ? coverageLabel(page, items.length)
                    : null,
                scopeDescription(effectiveScope, lockDomain),
                description,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            <div className="min-h-0 flex-1 overflow-auto">
              {state.phase === 'loading' ? <WorkspaceSkeletonRows rows={8} columns={4} /> : null}
              {state.phase !== 'loading' && items.length === 0 ? (
                <WorkspaceEmpty
                  title={
                    state.phase === 'denied'
                      ? 'Fila indisponível'
                      : state.phase === 'error'
                        ? 'Não foi possível ler a fila'
                        : (emptyTitle ?? 'Nenhum trabalho pendente neste recorte.')
                  }
                  description={
                    state.phase === 'denied'
                      ? 'Você não tem permissão para ler esta fila de trabalho.'
                      : state.phase === 'error'
                        ? state.message
                        : (emptyDescription ??
                          'A fila não inventa pendência para parecer cheia. Ajuste o recorte ou abra a fila completa.')
                  }
                  action={
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
                />
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
                    severityTone={
                      late !== null ? 'critical' : item.kind === 'BLOCKER' ? 'warning' : 'info'
                    }
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
                        <span className="ml-3">
                          {item.contextLabel || WORK_DOMAIN_LABELS[item.domain]}
                        </span>
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
            </div>
          </section>

          {paginate && page && page.totalPages > 1 ? (
            <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--color-divider)] px-3 py-1.5 text-[11px] text-[color:var(--color-text-secondary)]">
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
        </WorkspacePane>
      </WorkspaceBody>

      {/*
        CONTEXTO DO ITEM EM VIEWPORT ESTREITO — abaixo de `xl` nao ha largura para duas colunas,
        entao o MESMO conteudo vira o drawer. Nao duplica Object Page: entrega o suficiente para
        decidir e o atalho para o objeto completo, sem sair da fila.
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
