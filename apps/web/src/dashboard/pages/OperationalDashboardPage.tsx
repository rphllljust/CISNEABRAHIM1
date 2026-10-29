import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { BusinessChainFlow } from '../components/BusinessChainFlow';
import { DashboardWorkbenchHeader } from '../components/DashboardWorkbenchHeader';
import { MetricStrip } from '../components/MetricStrip';
import { OperationalDashboardSkeleton } from '../components/OperationalDashboardSkeleton';
import { SituationGaps } from '../components/SituationPanel';
import { WorkbenchKpiStrip } from '../components/WorkbenchKpiStrip';
import { useExecutiveDashboard } from '../hooks/useExecutiveDashboard';
import { useOperationalUnits, operationalUnitLabel } from '../../shell/hooks/useOperationalUnits';
import { buildDashboardKpis, buildPeriodVolume } from '../utils/build-dashboard-kpis';
import { buildWorkbenchKpis } from '../utils/build-workbench-kpis';
import {
  buildBusinessFlow,
  domainReachesFinance,
  domainReachesOperation,
  scopedAttention,
} from '../utils/dashboard-semantics';
import { buildOperationalSituation, situationBadgeLabel } from '../utils/dashboard-situation';
import { semanticSectionAttrs } from '../semantic-dashboard';
import { ModuleDeniedState, ModulePage } from '../../ui';
import { ContextDrawer } from '../../operator';
import { StatusBadge } from '../../ui/StatusBadge';
import { Money } from '../../ui/Money';
import { cn } from '../../ui/utils/cn';
import {
  getWorkInbox,
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  WORK_KINDS,
  type WorkDomain,
  type WorkInboxPage,
  type WorkItem,
  type WorkKind,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../workspaces/components/WorkspaceQueueSurface';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import '../dashboard.css';

/**
 * PAINEL OPERACIONAL (/app) — CENTRAL OPERACIONAL ERP.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU, E POR QUE A MUDANCA E ESTRUTURAL
 *
 * A composicao anterior era uma COLUNA de blocos empilhados: cabecalho, regua de situacao, grade
 * fila+lateral, faixa de indicadores, cadeia, atalhos. Cada bloco tinha envelope proprio, gap de
 * 12-16px e altura livre — e o resultado medido era uma pagina em que a metade de baixo ficava
 * vazia e a fila terminava em ~120px. A tela lia como relatorio, nao como posto de trabalho.
 *
 * A composicao atual tem a anatomia de uma central operacional:
 *
 *   LINHA 1  indicadores acionaveis
 *   LINHA 2  distribuicao | carteira | excecoes
 *   LINHA 3  produtividade e tendencia publicada
 *   LINHA 4  fluxo operacional
 *   LINHA 5  workbench: fila real + contexto lateral persistente
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRA DE AREA — a mesma de antes, agora aplicada a composicao inteira
 *
 * Indicador sem fato publicado nao ocupa celula. Superficie analitica sem dado real nao ocupa
 * coluna. Estagio de processo sem contagem mostra "sem contagem" e NAO vira zero. AUSENCIA != ZERO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O CONTEXTO NAO E UM MODAL
 *
 * Em viewport larga o `ContextDrawer` entra em modo `inline`: ele e uma COLUNA do grid, ao lado da
 * fila, com `border-left`, sem overlay e sem bloquear o scroll da worklist. Filtros, saved view,
 * paginacao, selecao e posicao de scroll sobrevivem — que e a razao de existir um context drawer
 * num ERP. Abaixo de 1280px o MESMO primitivo volta ao modo overlay, porque em tela estreita a
 * coluna roubaria mais do que entrega.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * NENHUM COMANDO FOI INVENTADO
 *
 * A barra da fila publica apenas o que o read model realmente executa no servidor (`kind`,
 * `overdue`) e a busca local que recorta a PAGINA recebida. Nao existe "Novo", "Exportar" nem
 * "Editar status" aqui: nenhum comando autorizado foi publicado para esta superficie, e um botao
 * sem transicao por tras ensina o operador a esperar que clicar mude o estado de alguma coisa.
 */

const QUEUE_PAGE_SIZE = 50;

/** View da fila — SEMPRE mapeada para um filtro que o servidor executa. */
type QueueViewId = 'all' | WorkKind | 'overdue';

const QUEUE_VIEWS: ReadonlyArray<{ id: QueueViewId; label: string; kind: WorkKind | null }> = [
  { id: 'all', label: 'Fila completa', kind: null },
  { id: 'BLOCKER', label: 'Bloqueios', kind: 'BLOCKER' },
  { id: 'OVERDUE', label: 'Vencidos', kind: 'OVERDUE' },
  { id: 'APPROVAL', label: 'Aprovações', kind: 'APPROVAL' },
  { id: 'EXCEPTION', label: 'Exceções', kind: 'EXCEPTION' },
  { id: 'CONTINUITY', label: 'Continuidade', kind: 'CONTINUITY' },
];

const OPERATIONAL_SHORTCUTS = [
  { id: 'work-inbox', label: 'Central de trabalho', href: '/app/work-inbox' },
  { id: 'service-orders', label: 'Ordens de serviço', href: '/app/service-orders' },
  { id: 'billing', label: 'Faturamento', href: '/app/billing' },
  { id: 'receivables', label: 'Contas a receber', href: '/app/finance/receivables' },
  { id: 'requests', label: 'Solicitações', href: '/app/requests' },
] as const;

/**
 * A TRILHA DO PROCESSO, em rotulos — a MESMA ordem que `buildBusinessFlow` publica.
 *
 * O rail de contexto sem selecao declara o processo em texto porque ali nao cabe a trilha completa;
 * ele existe para responder "em que ponto do processo eu estou" sem exigir que o operador role a
 * tela. A ordem e unica: qualquer mudanca no fluxo acontece em `dashboard-semantics`, e este array
 * apenas espelha os rotulos.
 */
const FLOW_LABELS = [
  'Solicitação',
  'Proposta',
  'Contrato',
  'Ordem de serviço',
  'Medição',
  'Faturamento',
  'Recebimento',
] as const;

/**
 * ATALHOS x COMANDOS — a distincao que a barra precisa declarar.
 *
 * Os itens acima sao ROTAS de modulo: levam a uma lista, nao executam transicao de estado.
 * Chama-los de "acoes" era vocabulario errado — em ERP, "acao" significa comando. O rotulo
 * "Atalhos" diz o que eles sao, e nenhum comando foi inventado para preencher a barra.
 */
const WORKSPACE_SHORTCUTS_LABEL = 'Atalhos';

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPeriodLabel(from: string, to: string): string {
  return `${from} — ${to}`;
}

/** Uma data civil curta, sem hora: o vencimento de um item de trabalho e um dia, nao um instante. */
function formatMoment(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

function parseDashboardDomain(value: string | null): WorkDomain | null {
  return value && (Object.keys(WORK_DOMAIN_LABELS) as WorkDomain[]).includes(value as WorkDomain)
    ? (value as WorkDomain)
    : null;
}

function parseQueueView(value: string | null): QueueViewId {
  if (!value) {
    return 'all';
  }
  if (value === 'overdue') {
    return 'overdue';
  }
  return (WORK_KINDS as ReadonlyArray<string>).includes(value) ? (value as WorkKind) : 'all';
}

/** PLURALIZACAO HUMANA — "1 dia" / "11 dias", nunca "1 dia(s)". */
function pluralizeDias(days: number): string {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** Excecao em atraso, em linguagem humana — reaproveitada pelos pontos que a exibem. */
function overdueLabel(dueAt: string | null): string | null {
  const days = daysOverdue(dueAt);
  return days === null ? null : `${pluralizeDias(days)} em atraso`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** RECORTE ATIVO — nunca o identificador interno de unidade. */
function buildActiveFilterLabels(
  filters: { unitId?: string; from?: string; to?: string },
  unitLabels: { value: string; label: string }[],
): string[] {
  const labels: string[] = [];
  if (filters.unitId) {
    labels.push(`Unidade: ${operationalUnitLabel(unitLabels, filters.unitId)}`);
  }
  if (filters.from) {
    labels.push(`De: ${filters.from}`);
  }
  if (filters.to) {
    labels.push(`Até: ${filters.to}`);
  }
  return labels;
}

/**
 * TONE SEMANTICO DA EXCECAO.
 *
 * Critico = vermelho, atencao = ambar, informativo = azul, neutro = slate. Nenhuma heuristica de
 * risco: o tom vem da severidade que o servidor publicou para o item.
 */
function exceptionTone(severity: 'critical' | 'warning' | 'info'): string {
  return severity === 'critical'
    ? 'dashboard-exceptions__row--critical'
    : severity === 'warning'
      ? 'dashboard-exceptions__row--warning'
      : 'dashboard-exceptions__row--info';
}

export function OperationalDashboardPage() {
  const { state, reload, filters, setFilters, periodOptions, isRefreshing } =
    useExecutiveDashboard();
  const { options: unitOptions } = useOperationalUnits();
  const navigate = useNavigate();

  /**
   * RECORTE OPERACIONAL NA URL — dominio, vencimento e view sobrevivem a refresh, back/forward,
   * bookmark e drillback. O workspace deixa de esconder o contexto em `useState` local.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = parseDashboardDomain(searchParams.get('domain'));
  const overdueOnly = searchParams.get('overdue') === 'true';
  const view = parseQueueView(searchParams.get('view'));
  /*
   * A VIEW E O RECORTE DE NATUREZA — `view` ja e o proprio `WorkKind` quando nao e `all`/`overdue`,
   * porque `parseQueueView` so devolve um id que existe em `WORK_KINDS`. Nao ha coercao a fazer.
   */
  const viewKind: WorkKind | null = view !== 'all' && view !== 'overdue' ? view : null;
  const queueSearch = searchParams.get('q') ?? '';
  const offset = Math.max(0, Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  const [inbox, setInbox] = useState<WorkInboxPage | null>(null);
  const [inboxPhase, setInboxPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  /*
   * A FILA E RECORTADA PELO SERVIDOR com o mesmo recorte do workspace: dominio, natureza,
   * vencimento e pagina vao na requisicao. Nada e filtrado no navegador sobre a pagina recebida —
   * isso esconderia itens que ficaram fora dela e apresentaria uma amostra como se fosse o conjunto.
   */
  const serverOverdue = overdueOnly || view === 'overdue';

  useEffect(() => {
    const controller = new AbortController();
    setInboxPhase('loading');
    void getWorkInbox(
      {
        domain: domain ?? undefined,
        kind: viewKind ?? undefined,
        overdue: serverOverdue,
        limit: QUEUE_PAGE_SIZE,
        offset,
      },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setInbox(result);
          setInboxPhase('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setInboxPhase('error');
        }
      });
    return () => controller.abort();
  }, [domain, viewKind, serverOverdue, offset]);

  /*
   * SELECAO — o contexto e SOB DEMANDA, e por isso NAO existe auto-selecao aqui.
   *
   * Contexto sem intencao do usuario e ruido, nao ajuda. A UNICA excecao e a selecao que deixa de
   * existir no recorte (item filtrado para fora): ai a selecao e LIMPA, nunca trocada por outro
   * item sem o operador pedir.
   */
  useEffect(() => {
    setSelected((current) =>
      current && !inbox?.items.some((item) => item.id === current.id) ? null : current,
    );
  }, [inbox]);

  const onOpenRoute = useCallback(
    (route: string) => {
      void navigate(route);
    },
    [navigate],
  );

  const updateQueueParam = useCallback(
    (key: 'view' | 'q' | 'offset', value: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          /* Trocar de recorte reinicia a paginacao: `offset` de outro conjunto nao faz sentido. */
          if (key !== 'offset') next.delete('offset');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const updateOperationalRecorte = useCallback(
    (key: 'domain' | 'overdue', value: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete('offset');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /*
   * BUSCA LOCAL — recorta SOMENTE a pagina recebida, e a faixa diz isso em voz alta. O read model
   * nao publica parametro de texto; apresentar este campo como "busca global" faria o operador
   * acreditar que filtrou o conjunto quando filtrou 50 linhas.
   */
  const pageItems = inbox?.items ?? [];
  const visibleItems = useMemo(() => {
    const term = queueSearch.trim().toLowerCase();
    if (!term) {
      return pageItems;
    }
    return pageItems.filter((item) =>
      [item.businessReference, item.title, item.contextLabel, item.status, item.reason]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [pageItems, queueSearch]);

  const unitLabel = filters.unitId ? operationalUnitLabel(unitOptions, filters.unitId) : null;

  /*
   * O SNAPSHOT sobrevive a uma falha de atualizacao: quando a leitura anterior chegou, o painel
   * continua exibindo o ultimo dado autoritativo enquanto o alerta de falha aparece no topo.
   */
  const snapshot =
    state.phase === 'ready' ? state.snapshot : state.phase === 'error' ? state.partial : undefined;
  const scope = snapshot ? scopedAttention(snapshot, domain) : null;
  const situation = snapshot && scope ? buildOperationalSituation(snapshot, scope) : null;
  const domainLabel = domain ? WORK_DOMAIN_LABELS[domain] : 'Tudo';

  const headerProps = {
    title: 'Central de operações',
    description: 'Acompanhe a execução operacional e o trabalho que exige decisão.',
    period: filters.period,
    periodOptions,
    onPeriodChange: (period: string) => setFilters({ period }),
    isRefreshing,
    onRefresh: () => void reload(),
    domain,
    onDomainChange: (nextDomain: WorkDomain | null) =>
      updateOperationalRecorte('domain', nextDomain),
    overdueOnly,
    onOverdueChange: (value: boolean) => updateOperationalRecorte('overdue', value ? 'true' : null),
    situation,
    queueTotal: inboxPhase === 'ready' ? (inbox?.total ?? null) : null,
  };

  if (state.phase === 'loading') {
    return (
      <ModulePage layout="workspace">
        <div data-region="work-surface">
          <div data-region="operating-header">
            <DashboardWorkbenchHeader
              {...headerProps}
              unitLabel={unitLabel}
              periodLabel={null}
              generatedAt={null}
              generatedAtFormatted={null}
              activeFilters={[]}
            />
          </div>
          <div data-region="worklist-master">
            <OperationalDashboardSkeleton />
          </div>
        </div>
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage layout="workspace">
        <div data-region="work-surface">
          <div data-region="operating-header">
            <DashboardWorkbenchHeader
              {...headerProps}
              unitLabel={unitLabel}
              periodLabel={null}
              generatedAt={null}
              generatedAtFormatted={null}
              activeFilters={[]}
            />
          </div>
          <div data-region="worklist-master">
            <ModuleDeniedState
              title="Visão geral"
              message="Você não tem permissão para visualizar a visão geral."
            />
          </div>
        </div>
      </ModulePage>
    );
  }

  const activeFilters = buildActiveFilterLabels(filters, unitOptions);
  const periodLabel = snapshot ? formatPeriodLabel(snapshot.period.from, snapshot.period.to) : null;
  const workbenchKpis = snapshot ? buildWorkbenchKpis(snapshot, domain) : [];

  /*
   * ANALITICO 1 e 2 — DISTRIBUICAO OPERACIONAL e CARTEIRA.
   *
   * As duas leem FATOS DIFERENTES (situacao das ordens x faixas de atraso dos titulos) e por isso
   * NAO sao alternativas: um painel de operacao sem a carteira vencida esconde metade do que o
   * snapshot publica. O que elas nunca fazem e sair do recorte que as alcanca — cada uma respeita a
   * dimensao de dado declarada em `DOMAIN_DATA_DIMENSIONS`, para que o operador nunca leia OPERACAO
   * sob um chip FISCAL.
   */
  const showOperationDistribution =
    domainReachesOperation(domain) && snapshot!.charts.serviceOrdersByStatus.items.length > 0;
  const showAging =
    domainReachesFinance(domain) &&
    snapshot!.charts.financialAging.available &&
    snapshot!.charts.financialAging.buckets.length > 0;
  const dashboardKpis = showOperationDistribution ? buildDashboardKpis(snapshot!) : [];
  const workbenchKpiIds = new Set(workbenchKpis.map((kpi) => kpi.id));
  const productivitySection =
    showOperationDistribution && dashboardKpis.length > 0
      ? { kpis: dashboardKpis, volume: buildPeriodVolume(snapshot!) }
      : null;
  const flowStages = snapshot ? buildBusinessFlow(snapshot, domain) : [];
  const attentionItems = scope?.items ?? [];
  const queueTotal = inboxPhase === 'ready' ? (inbox?.total ?? null) : null;
  const incompleteNotice = inbox?.unavailableDomains?.length
    ? `Fila incompleta: ${inbox.unavailableDomains.join(', ')} não respondeu nesta leitura.`
    : null;

  /*
   * AS TRES SUPERFICIES ANALITICAS SAO FIXAS — e isso e deliberado.
   *
   * A faixa do cockpit e DISTRIBUICAO | CARTEIRA | ALERTAS. Cada superficie permanece na grade em
   * todos os recortes; o que varia e o ESTADO INTERNO (grafico quando o dado existe, estado
   * governado declarado quando nao existe). Uma faixa que encolhe conforme o recorte faz o cockpit
   * parecer quebrado e esconde do operador QUAIS leituras o painel oferece.
   *
   * Isso nao inventa dado: "não publicado para este recorte" e uma afirmacao verdadeira sobre o que
   * o servidor entregou, e a decision de exibir a lista continua sendo do operador.
   */

  return (
    <ModulePage layout="workspace">
      {/*
        GRAMATICA DE REGIOES NA CENTRAL OPERACIONAL.

        Esta e a superficie de entrada do produto e era uma das duas workspaces sem nenhuma
        `data-region`. O cockpit tem layout interno proprio (`dashboard-cc` com zona de trabalho
        e zona de contexto), mas o CABECALHO e as ZONAS externas ficavam colados: a regua que
        separa "onde estou / qual recorte" de "o que a operacao mostra" e desenhada pela
        governanca global a partir das regioes, e sem elas a faixa de orientacao se confundia
        com o primeiro bloco de dado.
      */}
      <div className="flex min-h-0 flex-1 flex-col" data-region="work-surface">
        <div data-region="operating-header">
          <DashboardWorkbenchHeader
            {...headerProps}
            unitLabel={unitLabel}
            periodLabel={periodLabel}
            activeFilters={activeFilters}
            onClearFilters={
              activeFilters.length > 0
                ? () => setFilters({ unitId: '', from: '', to: '' })
                : undefined
            }
            generatedAt={snapshot?.generatedAt ?? null}
            generatedAtFormatted={snapshot ? formatGeneratedAt(snapshot.generatedAt) : null}
          />
        </div>

        {state.phase === 'error' ? (
          <div className="dashboard-alert" role="alert">
            <p>{state.message}</p>
            <button type="button" className="dashboard-alert__retry" onClick={() => void reload()}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        {snapshot ? (
          <div
            className={cn('dashboard-cc', selected && 'dashboard-cc--context')}
            role="group"
            aria-label="Central operacional"
            data-layout="operations-control-center"
            data-region="worklist-master"
          >
            {/*
            CONTROL CENTER — a ordem responde primeiro como esta a operacao, onde ha desvio e em
            que ponto o processo parou; a fila e a bancada acionavel que vem em seguida. Todos os
            numeros e links abaixo derivam do snapshot executivo e do work inbox publicados.
          */}
            <section
              className="dashboard-situation-strip"
              aria-label="Situação operacional"
              data-layout="situation-strip"
              data-region="situation-strip"
            >
              <WorkbenchKpiStrip kpis={workbenchKpis} />
            </section>

            <div data-layout="compact-process-flow">
              <BusinessChainFlow stages={flowStages} domainLabel={domainLabel} />
            </div>

            <div className="dashboard-cc__work" data-layout="work-area">
              <div className="dashboard-cc__workspace" data-layout="main-workspace">
                <section
                  className="dashboard-cc__priority"
                  aria-label="Fila prioritária"
                  data-layout="priority-work-area"
                >
                  {/*
              VIEWS + TOOLBAR DA FILA — antes da grade, dentro da própria superfície de trabalho.
              As views sao EXATAMENTE os recortes que o servidor executa (`kind`, `overdue`); a
              contagem por view vem de `byDomain`/`total` publicados, nunca de um calculo local.

              O recorte e a busca ficam imediatamente antes da fila que controlam.
            */}
                  <div className="dashboard-queuebar" data-layout="queue-toolbar">
                    <div className="dashboard-views" role="group" aria-label="Views da fila">
                      {QUEUE_VIEWS.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          aria-pressed={view === candidate.id}
                          className={cn(
                            'dashboard-views__tab',
                            view === candidate.id && 'dashboard-views__tab--on',
                          )}
                          onClick={() =>
                            updateQueueParam('view', candidate.id === 'all' ? null : candidate.id)
                          }
                        >
                          {candidate.label}
                        </button>
                      ))}
                    </div>

                    <div className="dashboard-queuebar__tools">
                      <label className="dashboard-queuebar__search">
                        <Search
                          className="dashboard-queuebar__search-icon"
                          strokeWidth={2.2}
                          aria-hidden
                        />
                        <span className="cisne-sr-only">Buscar nesta página da fila</span>
                        <input
                          type="search"
                          value={queueSearch}
                          onChange={(event) => updateQueueParam('q', event.target.value || null)}
                          placeholder="Buscar nesta página: referência, cliente, motivo…"
                        />
                      </label>

                      <span className="dashboard-queuebar__filter">
                        <SlidersHorizontal
                          className="dashboard-queuebar__filter-icon"
                          strokeWidth={2.4}
                          aria-hidden
                        />
                        {domainLabel}
                      </span>

                      {/*
                  "SOMENTE VENCIDOS" COMO TOGGLE DE FILTRO REAL — o read model executa `overdue`
                  no servidor, entao o controle tem efeito verdadeiro.
                */}
                      <button
                        type="button"
                        className={cn(
                          'dashboard-queuebar__button',
                          overdueOnly && 'dashboard-queuebar__button--active',
                        )}
                        aria-pressed={overdueOnly}
                        onClick={() =>
                          updateOperationalRecorte('overdue', overdueOnly ? null : 'true')
                        }
                      >
                        <AlertTriangle
                          className="dashboard-queuebar__button-icon"
                          strokeWidth={2.4}
                          aria-hidden
                        />
                        Atrasados
                      </button>

                      <button
                        type="button"
                        className="dashboard-queuebar__button"
                        onClick={() => void reload()}
                        disabled={isRefreshing}
                      >
                        <RefreshCw
                          className="dashboard-queuebar__button-icon"
                          strokeWidth={2.4}
                          aria-hidden
                        />
                        Atualizar
                      </button>

                      <Link
                        className="dashboard-queuebar__button dashboard-queuebar__button--primary"
                        to="/app/work-inbox"
                      >
                        Abrir fila
                        <ArrowUpRight
                          className="dashboard-queuebar__button-icon"
                          strokeWidth={2.4}
                          aria-hidden
                        />
                      </Link>
                    </div>
                  </div>

                  <WorkQueue
                    phase={inboxPhase}
                    items={visibleItems}
                    page={inbox}
                    total={queueTotal}
                    view={view}
                    domainLabel={domainLabel}
                    search={queueSearch}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelected}
                    onOpenRoute={onOpenRoute}
                    onNavigateOffset={(nextOffset) =>
                      updateQueueParam('offset', nextOffset > 0 ? String(nextOffset) : null)
                    }
                    onClearSearch={() => updateQueueParam('q', null)}
                    onClearRecorte={() => updateOperationalRecorte('domain', null)}
                  />

                  <SituationGaps
                    inboxPhase={inboxPhase}
                    unavailableDomains={inbox?.unavailableDomains ?? []}
                    errorMessage={
                      inboxPhase === 'error'
                        ? 'Não foi possível falar com o servidor para montar a fila de trabalho.'
                        : null
                    }
                  />

                  {incompleteNotice && inboxPhase === 'ready' ? (
                    <p className="dashboard-queue__notice" role="status">
                      {incompleteNotice}
                    </p>
                  ) : null}
                </section>

                {/*
                RAIL OPERACIONAL CONTÍNUO: acompanha somente a superfície da fila e preserva o
                recorte enquanto o operador troca a seleção.
              */}
                {selected ? (
                  <ContextDrawer
                    open
                    className="dashboard-context-drawer"
                    title="Contexto do trabalho"
                    onClose={() => setSelected(null)}
                    preview={{
                      identifier: selected.businessReference,
                      subtitle: selected.title,
                      status: (
                        <StatusBadge
                          label={overdueLabel(selected.dueAt) ?? selected.status}
                          tone={daysOverdue(selected.dueAt) !== null ? 'error' : 'info'}
                        />
                      ),
                      facts: [
                        { label: 'Cliente / contexto', value: selected.contextLabel || '—' },
                        { label: 'Domínio', value: WORK_DOMAIN_LABELS[selected.domain] },
                        { label: 'Natureza', value: WORK_KIND_LABELS[selected.kind] },
                        { label: 'Situação', value: selected.status },
                        { label: 'Motivo', value: selected.reason },
                        { label: 'Ocorrido em', value: formatMoment(selected.occurredAt) },
                        { label: 'Vencimento', value: formatMoment(selected.dueAt) },
                        {
                          label: 'Prazo',
                          value: overdueLabel(selected.dueAt) ?? 'Sem atraso',
                          emphasis: daysOverdue(selected.dueAt) !== null,
                        },
                      ],
                      nextAction: {
                        label: selected.actionLabel,
                        onClick: () => {
                          void navigate(selected.targetRoute);
                        },
                        kind: 'primary',
                      },
                      detailHref: selected.targetRoute,
                      detailLabel: 'Abrir na tela de origem',
                    }}
                  />
                ) : null}
              </div>
            </div>

            <details
              className="border-t border-[var(--erp-border)] bg-white p-3"
              data-layout="operational-insight"
            >
              <summary className="cursor-pointer text-xs font-semibold text-[var(--erp-text-secondary)]">
                Contexto do recorte e análise operacional
              </summary>
              <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-3">
                  {showOperationDistribution || showAging || attentionItems.length > 0 ? (
                    <section
                      className="dashboard-analytics"
                      aria-label="Análise operacional"
                      data-layout="operational-analytics"
                    >
                      {showOperationDistribution ? (
                        <OperationDistribution snapshot={snapshot} available />
                      ) : null}
                      {showAging ? (
                        <AgingDistribution aging={snapshot.charts.financialAging} available />
                      ) : null}
                      {attentionItems.length > 0 ? (
                        <ExceptionSurface items={attentionItems} />
                      ) : null}
                    </section>
                  ) : null}
                  {productivitySection ? (
                    <section
                      className="dashboard-summary"
                      aria-label="Saúde da empresa no período"
                      {...semanticSectionAttrs([
                        'productivity.completed_count',
                        'productivity.on_time_rate',
                        'productivity.avg_cycle_hours',
                        'productivity.rework_rate',
                      ])}
                    >
                      <MetricStrip
                        kpis={productivitySection.kpis}
                        volume={productivitySection.volume}
                        excludeIds={workbenchKpiIds}
                      />
                    </section>
                  ) : null}
                </div>
                <OperationalContextRail
                  unitLabel={unitLabel}
                  domainLabel={domainLabel}
                  periodLabel={periodLabel}
                  generatedAtFormatted={snapshot ? formatGeneratedAt(snapshot.generatedAt) : null}
                  queueStateLabel={
                    inboxPhase === 'ready'
                      ? `${queueTotal ?? 0} ${plural(queueTotal ?? 0, 'item', 'itens')} na fila`
                      : inboxPhase === 'loading'
                        ? 'Leitura em andamento'
                        : 'Fila não publicada nesta leitura'
                  }
                  pageCount={inbox?.items.length ?? 0}
                  situationLabel={
                    situation
                      ? situationBadgeLabel(situation)
                      : 'Situação não avaliada neste recorte'
                  }
                />
              </div>
            </details>

            {/*
            RODAPE OPERACIONAL — leitura secundaria (rotas alternativas de modulo), fora da area de
            trabalho para nao competir com a fila.
          */}
            <nav className="dashboard-shortcuts-bar" aria-label="Atalhos do workspace">
              <span className="dashboard-shortcuts-bar__label">{WORKSPACE_SHORTCUTS_LABEL}</span>
              {OPERATIONAL_SHORTCUTS.map((shortcut) => (
                <Link
                  key={shortcut.id}
                  className="dashboard-shortcuts-bar__link"
                  to={shortcut.href}
                >
                  {shortcut.label}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}
      </div>
    </ModulePage>
  );
}

/**
 * CONTEXTO OPERACIONAL DO RECORTE — o estado do rail quando NAO ha entidade selecionada.
 *
 * Tudo aqui e FATO que a tela ja possui: escopo autorizado, dominio ativo, periodo, estado da fila,
 * tamanho da pagina lida, situacao avaliada e hora da ultima leitura. Nenhum campo e placeholder e
 * nenhum numero e inventado — quando um fato nao existe para o recorte, ele e declarado como nao
 * publicado em vez de virar `0` ou `—` decorativo.
 *
 * As tres secoes respondem, nesta ordem, as tres perguntas do operador ao abrir o painel:
 *   ONDE ESTOU   (recorte)
 *   EM QUE PONTO (processo)
 *   PARA ONDE IR (atalhos reais)
 */
function OperationalContextRail({
  unitLabel,
  domainLabel,
  periodLabel,
  generatedAtFormatted,
  queueStateLabel,
  pageCount,
  situationLabel,
}: {
  unitLabel: string | null;
  domainLabel: string;
  periodLabel: string | null;
  generatedAtFormatted: string | null;
  queueStateLabel: string;
  pageCount: number;
  situationLabel: string;
}) {
  return (
    <div className="dashboard-rail">
      <section className="dashboard-rail__section" aria-labelledby="rail-context">
        <div className="dashboard-rail__head">
          <span className="dashboard-rail__mark dashboard-rail__mark--info" aria-hidden />
          <h2 id="rail-context" className="dashboard-rail__title">
            Contexto operacional
          </h2>
        </div>
        <dl className="dashboard-rail__facts">
          <div className="dashboard-rail__fact">
            <dt>Escopo</dt>
            <dd>{unitLabel ?? 'Todas as unidades autorizadas'}</dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Domínio</dt>
            <dd>{domainLabel}</dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Período</dt>
            <dd className="tabular-nums">{periodLabel ?? 'Não informado'}</dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Fila</dt>
            <dd>{queueStateLabel}</dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Nesta página</dt>
            <dd className="tabular-nums">
              {pageCount} {plural(pageCount, 'item lido', 'itens lidos')}
            </dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Situação</dt>
            <dd>{situationLabel}</dd>
          </div>
          <div className="dashboard-rail__fact">
            <dt>Atualização</dt>
            <dd className="tabular-nums">{generatedAtFormatted ?? 'Não publicada'}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-rail__section" aria-labelledby="rail-process">
        <div className="dashboard-rail__head">
          <span className="dashboard-rail__mark dashboard-rail__mark--identity" aria-hidden />
          <h2 id="rail-process" className="dashboard-rail__title">
            Processo atual
          </h2>
        </div>
        <ol className="dashboard-rail__process">
          {FLOW_LABELS.map((label) => (
            <li key={label} className="dashboard-rail__process-step">
              {label}
            </li>
          ))}
        </ol>
        <p className="dashboard-rail__note">
          A trilha descreve o processo do CISNE. Contagem só aparece quando o servidor publica.
        </p>
      </section>

      <section className="dashboard-rail__section" aria-labelledby="rail-shortcuts">
        <div className="dashboard-rail__head">
          <span className="dashboard-rail__mark dashboard-rail__mark--neutral" aria-hidden />
          <h2 id="rail-shortcuts" className="dashboard-rail__title">
            Atalhos contextuais
          </h2>
        </div>
        <ul className="dashboard-rail__links">
          {OPERATIONAL_SHORTCUTS.map((shortcut) => (
            <li key={shortcut.id}>
              <Link className="dashboard-rail__link" to={shortcut.href}>
                {shortcut.label}
                <ArrowUpRight className="dashboard-rail__link-icon" strokeWidth={2.4} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ============================================================================
   FILA DE TRABALHO — grade real, densa, com paginacao
   ============================================================================ */

const QUEUE_COLUMNS =
  '1.05fr minmax(0, 1.9fr) minmax(1.4rem, 1fr) 1.15fr 0.85fr 0.6fr minmax(6rem, auto)';

function WorkQueue({
  phase,
  items,
  page,
  total,
  view,
  domainLabel,
  search,
  selectedId,
  onSelect,
  onOpenRoute,
  onNavigateOffset,
  onClearSearch,
  onClearRecorte,
}: {
  phase: 'loading' | 'ready' | 'denied' | 'error';
  items: WorkItem[];
  page: WorkInboxPage | null;
  total: number | null;
  view: QueueViewId;
  domainLabel: string;
  search: string;
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onOpenRoute: (route: string) => void;
  onNavigateOffset: (offset: number) => void;
  onClearSearch: () => void;
  onClearRecorte: () => void;
}) {
  const limit = page?.limit ?? QUEUE_PAGE_SIZE;
  const offset = page?.offset ?? 0;
  const totalPages = page?.totalPages ?? 1;

  return (
    <section
      className={cn(
        'dashboard-queue',
        items.length > 0 ? 'dashboard-queue--filled' : 'dashboard-queue--empty',
      )}
      aria-label="Fila de trabalho do recorte"
      data-layout="priority-work-queue"
    >
      <div className="dashboard-queue__head">
        <h2 className="dashboard-queue__title">Fila de trabalho</h2>
        {typeof total === 'number' ? (
          <span className="dashboard-queue__count tabular-nums">
            {total} {plural(total, 'item', 'itens')}
          </span>
        ) : null}
        <span className="dashboard-queue__scope">
          {domainLabel}
          {search
            ? ` · busca local em ${items.length} de ${page?.items.length ?? items.length}`
            : ''}
        </span>
        <span className="dashboard-queue__spacer" />
        {typeof total === 'number' && total > items.length ? (
          <Link className="dashboard-queue__all" to="/app/work-inbox">
            Abrir fila completa
            <ArrowUpRight className="dashboard-queue__all-icon" strokeWidth={2.2} aria-hidden />
          </Link>
        ) : null}
      </div>

      {phase === 'loading' ? (
        <div className="dashboard-queue__state" role="status" aria-busy="true">
          <Loader2
            className="dashboard-queue__state-icon dashboard-queue__state-icon--spin"
            strokeWidth={2.2}
            aria-hidden
          />
          <p>Lendo o trabalho do recorte no servidor…</p>
        </div>
      ) : phase === 'denied' ? (
        <div className="dashboard-queue__state" role="alert">
          <p>Você não tem permissão para ler a fila de trabalho.</p>
        </div>
      ) : phase === 'error' ? (
        <div className="dashboard-queue__state" role="alert">
          <p>Não foi possível falar com o servidor para montar a fila de trabalho.</p>
        </div>
      ) : items.length === 0 ? (
        /*
         * ESTADO VAZIO DENTRO DA GRADE — o cabecalho de colunas CONTINUA.

         * Zero itens nao desmonta o workbench. O operador precisa reconhecer a mesma superficie de
         * processamento que ele usa quando ha trabalho: grade, colunas nomeadas e uma unica linha
         * dizendo que o recorte esta vazio, com a acao REAL que o desfaz. O vazio ocupa 48-56px de
         * conteudo; a superficie em volta continua reservada por `.dashboard-queue--empty`.
         */
        <div className="dashboard-queue__table" role="table" aria-label="Trabalho do recorte">
          <div
            className="dashboard-queue__row dashboard-queue__row--head"
            role="row"
            style={{ gridTemplateColumns: QUEUE_COLUMNS }}
          >
            <span role="columnheader">Prioridade</span>
            <span role="columnheader">Documento</span>
            <span role="columnheader">Contexto</span>
            <span role="columnheader">Etapa</span>
            <span role="columnheader">Responsável</span>
            <span role="columnheader">Prazo</span>
            <span role="columnheader">Próxima ação</span>
          </div>

          <div className="dashboard-queue__empty" role="row">
            <FolderOpen className="dashboard-queue__empty-icon" strokeWidth={2} aria-hidden />
            <p className="dashboard-queue__empty-text">
              {search
                ? `Nenhum item desta página corresponde a “${search}”.`
                : `Nenhum trabalho neste recorte · ${domainLabel}`}
            </p>
            <span className="dashboard-queue__empty-spacer" />
            {search ? (
              <button
                type="button"
                className="dashboard-queue__empty-action"
                onClick={onClearSearch}
              >
                Limpar busca
              </button>
            ) : null}
            {!search && domainLabel !== 'Tudo' ? (
              <button
                type="button"
                className="dashboard-queue__empty-action"
                onClick={onClearRecorte}
              >
                Ver todos os domínios
              </button>
            ) : null}
            {!search && domainLabel === 'Tudo' ? (
              <Link className="dashboard-queue__empty-action" to="/app/work-inbox">
                Abrir central de trabalho
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="dashboard-queue__table" role="table" aria-label="Trabalho do recorte">
            <div
              className="dashboard-queue__row dashboard-queue__row--head"
              role="row"
              style={{ gridTemplateColumns: QUEUE_COLUMNS }}
            >
              <span role="columnheader">Prioridade</span>
              <span role="columnheader">Documento</span>
              <span role="columnheader">Contexto</span>
              <span role="columnheader">Etapa</span>
              <span role="columnheader">Responsável</span>
              <span role="columnheader">Prazo</span>
              <span role="columnheader">Próxima ação</span>
            </div>

            <div className="dashboard-queue__body" role="rowgroup">
              {items.map((item) => {
                const late = daysOverdue(item.dueAt);
                const isSelected = selectedId === item.id;
                return (
                  <div
                    key={item.id}
                    role="row"
                    aria-selected={isSelected}
                    className={cn(
                      'dashboard-queue__row',
                      late !== null && 'dashboard-queue__row--critical',
                      isSelected && 'dashboard-queue__row--selected',
                    )}
                    style={{ gridTemplateColumns: QUEUE_COLUMNS }}
                  >
                    <span className="dashboard-queue__priority" role="cell">
                      <span
                        className={cn(
                          'dashboard-queue__dot',
                          late !== null
                            ? 'dashboard-queue__dot--critical'
                            : item.kind === 'BLOCKER'
                              ? 'dashboard-queue__dot--warning'
                              : 'dashboard-queue__dot--neutral',
                        )}
                        aria-hidden
                      />
                      {late !== null
                        ? `${late} ${late === 1 ? 'dia' : 'dias'}`
                        : WORK_KIND_LABELS[item.kind]}
                    </span>

                    <span className="dashboard-queue__doc" role="cell">
                      <button
                        type="button"
                        className="dashboard-queue__ref"
                        onClick={() => onSelect(item)}
                        title="Ver o contexto deste trabalho"
                      >
                        {item.businessReference}
                      </button>
                      <span className="dashboard-queue__title">{item.title}</span>
                    </span>

                    <span
                      className="dashboard-queue__context"
                      role="cell"
                      title={item.contextLabel}
                    >
                      {item.contextLabel || '—'}
                    </span>

                    <span className="dashboard-queue__stage" role="cell">
                      <StatusBadge label={item.status} tone="info" />
                    </span>

                    <span className="dashboard-queue__owner" role="cell" title={item.reason}>
                      {WORK_DOMAIN_LABELS[item.domain]}
                    </span>

                    <span
                      className={cn(
                        'dashboard-queue__due tabular-nums',
                        late !== null && 'dashboard-queue__due--late',
                      )}
                      role="cell"
                    >
                      {item.dueAt ? new Date(item.dueAt).toLocaleDateString('pt-BR') : '—'}
                    </span>

                    <span className="dashboard-queue__action" role="cell">
                      <button
                        type="button"
                        className="dashboard-queue__action-button"
                        onClick={() => onOpenRoute(item.targetRoute)}
                      >
                        {item.actionLabel}
                      </button>
                      <button
                        type="button"
                        className="dashboard-queue__more"
                        onClick={() => onSelect(item)}
                        aria-label={`Mais opções de ${item.businessReference}`}
                      >
                        ⋯
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="dashboard-queue__footer">
            <span className="tabular-nums">
              {offset + 1}–{Math.min(offset + limit, total ?? offset + items.length)} de{' '}
              {total ?? offset + items.length}
            </span>
            <span className="dashboard-queue__pager">
              <button
                type="button"
                className="dashboard-queue__page-button"
                disabled={offset === 0}
                onClick={() => onNavigateOffset(Math.max(0, offset - limit))}
              >
                Anterior
              </button>
              <span className="tabular-nums">
                Página {Math.floor(offset / limit) + 1} de {Math.max(1, totalPages)}
              </span>
              <button
                type="button"
                className="dashboard-queue__page-button"
                disabled={offset + limit >= (total ?? offset + items.length)}
                onClick={() => onNavigateOffset(offset + limit)}
              >
                Próxima
              </button>
            </span>
            <span className="dashboard-queue__view-name">
              {QUEUE_VIEWS.find((candidate) => candidate.id === view)?.label ?? 'Fila completa'}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}

/* ============================================================================
   ANALITICO — distribuicao, aging e EXCECOES
   ============================================================================ */

/**
 * ANALITICO A — DISTRIBUICAO DE OPERACAO (DONUT + LEGENDA).
 *
 * O servidor publica a contagem de cada status no escopo. O donut e construido com
 * `conic-gradient` — SEM biblioteca de grafico e SEM canvas, para que cada categoria continue sendo
 * um NODE do DOM verificavel: o E2E conta segmentos e le o valor, em vez de "olhar o screenshot".
 *
 * O TOTAL CENTRAL SO APARECE QUANDO E AUTORITATIVO. A soma dos status e o total das ordens que o
 * servidor publicou nessa dimensao — a distribuicao E o conjunto aqui, porque a tela so desenha o
 * donut quando o snapshot publicou `serviceOrdersByStatus.items`. Quando a distribuicao nao cobre o
 * conjunto (nao e o caso hoje), o centro fica vazio. AUSENCIA != ZERO.
 *
 * O PERCENTUAL so aparece quando o denominador e o conjunto publicado — nunca sobre uma amostra.
 */
function OperationDistribution({
  snapshot,
  available,
}: {
  snapshot: ExecutiveDashboardSnapshot;
  available: boolean;
}) {
  const status = snapshot.charts.serviceOrdersByStatus;
  const total = status.items.reduce((sum, item) => sum + item.count, 0);

  /*
   * COR POR SEMANTICA DO ESTADO — paleta DIFERENCIADA, nao monocromatica.
   *
   * Um donut em cinco tons de azul nao informa nada: o operador precisa distinguir "em execucao" de
   * "pausada" sem ler a legenda. Cada estado recebe a familia que o representa no vocabulario do
   * produto (operacao=azul, atencao=ambar, concluido=verde) e o que nao esta mapeado cai em slate —
   * o grafico nao inventa significado para um estado que ele nao conhece.
   */
  const colorFor = (statusId: string): string => {
    switch (statusId) {
      case 'IN_EXECUTION':
        return 'var(--erp-action)';
      case 'RELEASED':
        return 'var(--erp-info)';
      case 'PAUSED':
        return 'var(--erp-warning)';
      case 'COMPLETED':
        return 'var(--erp-success)';
      case 'CANCELLED':
        return 'var(--erp-text-disabled)';
      default:
        return 'var(--erp-neutral)';
    }
  };

  const segments = status.items.filter((item) => item.count > 0);
  let cursor = 0;
  const stops = segments.map((item) => {
    const share = total > 0 ? (item.count / total) * 100 : 0;
    const from = cursor;
    cursor += share;
    return `${colorFor(item.status)} ${from}% ${cursor}%`;
  });
  const ring = stops.length > 0 ? `conic-gradient(${stops.join(', ')})` : 'none';

  /*
   * ESTADO GOVERNADO — a superficie existe, o dado nao.
   *
   * Nao ha grafico falso nem eixo vazio: a superficie declara o que o servidor NAO publicou para
   * este recorte. O operador le "nao publicado", que e diferente de "zero ordens" e diferente de
   * "esta tudo bem".
   */
  if (!available) {
    return null;
  }
  if (stops.length === 0) {
    return (
      <p className="dashboard-analytics__compact-state" role="status">
        Nenhuma ordem no recorte publicado.
      </p>
    );
  }

  return (
    <div className="dashboard-analytics__panel" aria-labelledby="status-heading">
      <div className="dashboard-analytics__head">
        <h2 id="status-heading" className="dashboard-analytics__title">
          Ordens por situação
        </h2>
        <span className="dashboard-analytics__meta">Escopo autorizado</span>
      </div>

      <div className="dashboard-donut">
        <div className="dashboard-donut__ring" style={{ backgroundImage: ring }} aria-hidden>
          {total > 0 ? (
            <span className="dashboard-donut__center">
              <span className="dashboard-donut__total tabular-nums">{total}</span>
              <span className="dashboard-donut__total-label">
                {total === 1 ? 'ordem' : 'ordens'}
              </span>
            </span>
          ) : null}
        </div>

        <ul className="dashboard-donut__legend">
          {status.items.map((item) => (
            <li key={item.status} className="dashboard-donut__legend-item">
              <Link
                className="dashboard-donut__legend-row"
                to={`/app/service-orders?status=${item.status}`}
                aria-label={`${item.label}: ${item.count} ordens. Abrir lista filtrada.`}
              >
                <span
                  className="dashboard-donut__swatch"
                  style={{ background: colorFor(item.status) }}
                  aria-hidden
                />
                <span className="dashboard-donut__legend-label">{item.label}</span>
                <span className="dashboard-donut__legend-count tabular-nums">{item.count}</span>
                {total > 0 ? (
                  <span className="dashboard-donut__legend-share tabular-nums">
                    {Math.round((item.count / total) * 100)}%
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * ANALITICO 2 — AGING DA CARTEIRA.
 *
 * As faixas sao EXATAMENTE as que o servidor configurou (nenhuma faixa fixa inventada aqui) e cada
 * uma leva ao recorte real de titulos vencidos. `available=false` NAO vira zero: a superficie
 * inteira desaparece, porque distribuicao de nada nao informa nada.
 */
function AgingDistribution({
  aging,
  available,
}: {
  aging: ExecutiveDashboardSnapshot['charts']['financialAging'];
  available: boolean;
}) {
  /*
   * ESTADO GOVERNADO — a carteira nao foi publicada (ou o recorte nao alcanca o financeiro).
   *
   * `available: false` NAO e "carteira zerada": e ausencia de publicacao. A superficie permanece no
   * cockpit com a declaracao honesta, em vez de desaparecer e deixar a faixa manca.
   */
  if (!available || !aging.available || aging.buckets.length === 0) {
    return null;
  }

  const maxCount = Math.max(1, ...aging.buckets.map((bucket) => bucket.count));

  return (
    <div className="dashboard-analytics__panel" aria-labelledby="aging-heading">
      <div className="dashboard-analytics__head">
        <h2 id="aging-heading" className="dashboard-analytics__title">
          Atraso por faixa
        </h2>
        <span className="dashboard-analytics__meta">Carteira vencida no escopo</span>
      </div>

      <ul className="dashboard-dist">
        {aging.buckets.map((bucket) => (
          <li key={bucket.bandId} className="dashboard-dist__item">
            <Link
              className="dashboard-dist__row"
              to="/app/finance/receivables?status=OVERDUE"
              aria-label={`${bucket.label}: ${bucket.count} títulos vencidos. Abrir títulos vencidos.`}
            >
              <span className="dashboard-dist__label">{bucket.label}</span>
              <span className="dashboard-dist__track" aria-hidden>
                <span
                  className={cn(
                    'dashboard-dist__bar',
                    bucket.count > 0 && 'dashboard-dist__bar--critical',
                  )}
                  style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                />
              </span>
              <span className="dashboard-dist__count tabular-nums">{bucket.count}</span>
              <span className="dashboard-dist__amount">
                {/* MONEY CANONICO: o primitivo formata o valor do servidor (R$ 500,00). */}
                <Money value={bucket.totalAmount} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="dashboard-analytics__note">{aging.summary}</p>
    </div>
  );
}

/**
 * ANALITICO C — ALERTAS E EXCECOES.
 *
 * WORKLIST COMPACTA, nao banner. Cada linha tem icone semantico, QUANTIDADE REAL publicada, texto e
 * drilldown, em 28-34px de altura. Cor por significado: critico vermelho, atencao ambar, informativo
 * azul — sempre pela regua lateral, nunca por area cheia.
 *
 * ESTA SUPERFICIE NAO TEM ESTADO VAZIO. Ela so e renderizada quando existe excecao publicada
 * (`hasExceptions` na pagina governa a coluna); sem excecao, a faixa analitica se recompoe e uma
 * coluna vazia de 24% nao e reservada para uma nao-noticia.
 *
 * Sem exceções publicadas, a superfície some em vez de reservar área para uma não-notícia.
 */
function ExceptionSurface({ items }: { items: ExecutiveDashboardSnapshot['attention'] }) {
  const ordered = [...items].sort((left, right) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const delta = rank[left.severity] - rank[right.severity];
    return delta !== 0 ? delta : right.count - left.count;
  });

  if (ordered.length === 0) return null;

  return (
    <section className="dashboard-exceptions" aria-labelledby="exceptions-heading">
      <div className="dashboard-analytics__head">
        <h2 id="exceptions-heading" className="dashboard-analytics__title">
          Alertas e exceções
        </h2>
        <Link className="dashboard-exceptions__all" to="/app/work-inbox">
          Ver todos
        </Link>
      </div>

      {/*
        SEM EXCECAO PUBLICADA — ESTADO POSITIVO COMPACTO DENTRO DA SUPERFICIE.

        A superficie permanece (a arquitetura do cockpit e fixa), mas o conteudo e uma UNICA linha
        declarando ausencia — nunca um bloco verde de 100px celebrando uma nao-noticia.
      */}
      {ordered.length > 0 ? (
        <ul className="dashboard-exceptions__list">
          {ordered.map((item) => {
            const href = item.href;
            const body = (
              <>
                <span className="dashboard-exceptions__icon" aria-hidden>
                  {item.severity === 'critical' ? '▲' : item.severity === 'warning' ? '◆' : '●'}
                </span>
                <span className="dashboard-exceptions__count tabular-nums">{item.count}</span>
                <span className="dashboard-exceptions__label">{item.label}</span>
                <span className="dashboard-exceptions__detail">
                  {item.detail ?? item.ariaLabel}
                </span>
              </>
            );
            return (
              <li key={item.id} className="dashboard-exceptions__item">
                {href ? (
                  <Link
                    className={cn('dashboard-exceptions__row', exceptionTone(item.severity))}
                    to={href}
                    aria-label={item.ariaLabel}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={cn('dashboard-exceptions__row', exceptionTone(item.severity))}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
