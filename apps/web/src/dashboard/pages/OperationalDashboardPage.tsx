import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BusinessChainFlow } from '../components/BusinessChainFlow';
import { DashboardWorkbenchHeader } from '../components/DashboardWorkbenchHeader';
import { MetricStrip } from '../components/MetricStrip';
import { OperationalDashboardSkeleton } from '../components/OperationalDashboardSkeleton';
import { SituationGaps, SituationPanel } from '../components/SituationPanel';
import { WorkbenchKpiStrip } from '../components/WorkbenchKpiStrip';
import { WorkInboxSection } from '../components/WorkInboxSection';
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
import {
  getWorkInbox,
  WORK_DOMAIN_LABELS,
  WORK_KIND_LABELS,
  type WorkDomain,
  type WorkInboxPage,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../work-inbox/pages/WorkInboxPage';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import '../dashboard.css';

const OPERATIONAL_ACTIONS = [
  { id: 'service-requests', label: 'Solicitações', href: '/app/requests' },
  { id: 'service-orders', label: 'Ordens de serviço', href: '/app/service-orders' },
  { id: 'billing', label: 'Faturamento', href: '/app/billing' },
  { id: 'work-inbox', label: 'Central de trabalho', href: '/app/work-inbox' },
  { id: 'receivables', label: 'Contas a receber', href: '/app/finance/receivables' },
] as const;

/**
 * ATALHOS x COMANDOS — a distincao que a barra precisava declarar.
 *
 * Os cinco itens abaixo sao ROTAS de modulo: levam a uma lista, nao executam transicao de estado.
 * Chama-los de "Ações do workspace" era vocabulario errado — em ERP, "acao" significa comando
 * (aprovar, faturar, registrar medicao), e um link de navegacao apresentado como acao ensina o
 * operador a esperar que clicar mude o estado de alguma coisa.
 *
 * Eles continuam na tela porque sao atalhos legitimos; o que muda e o ROTULO, que agora diz o que
 * eles sao. Comando real entra aqui quando existir um comando autorizado que a tela possa executar
 * — e nenhum foi inventado para preencher a barra.
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

/**
 * PLURALIZACAO HUMANA — "1 dia" / "11 dias", nunca "1 dia(s)".
 *
 * O "(s)" e vicio de redacao tecnica: obriga o leitor a resolver a concordancia. Frase de gestao
 * escreve o numero e a palavra certos.
 */
function pluralizeDias(days: number): string {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** Excecao em atraso, em linguagem humana — reaproveitada pelos pontos que a exibem. */
function overdueLabel(dueAt: string | null): string | null {
  const days = daysOverdue(dueAt);
  return days === null ? null : `${pluralizeDias(days)} em atraso`;
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
 * OPERATIONAL WORKSPACE — a Visao geral do ERP, agora como AREA DE TRABALHO por persona.
 *
 * A tela ja era funcional, mas lia como painel administrativo: cabecalho escuro dominando a primeira
 * dobra, fila pequena e secundaria, cadeia de processo como tabela estatica, e metade da viewport
 * vazia abaixo. O que esta composicao entrega e ORDEM DE TRABALHO, nao decoracao:
 *
 *   1. CABECALHO            contexto do recorte em duas faixas densas (~120px), tema claro
 *   2. SITUACAO             o estado do recorte, com UNKNOWN declarado quando falta publicacao
 *   3. ACOES DO WORKSPACE   comandos contextuais autorizados
 *   4. INDICADORES          faixa densa de KPIs, cada um com drill para o recorte que o produziu
 *   5. MINHA FILA + LATERAL  a area central de trabalho, com contexto operacional complementar
 *   6. FLUXO EMPRESARIAL    Operacao -> Medicao -> Faturamento -> Recebimento como cadeia
 *   7. ANALISE              distribuicao e produtividade, quando o snapshot publica
 *
 * COMPOSICAO, NAO NOVA GRAMATICA. Todo bloco e montado com primitivos que ja existem no CISNE:
 * `WorkbenchQueue`/`WorkbenchQueueItem` (fila), `EnterpriseMetric`/`WorkbenchMetric` (numero com
 * drill), `ContextDrawer` (contexto sob demanda), `StatusBadge` (estado), `Money` (dinheiro),
 * `MetricStrip` (analise de produtividade) e `ModuleDeniedState` (acesso). Nenhum comportamento,
 * filtro, rota ou capability nasce aqui — e nenhum contrato estavel foi alterado.
 *
 * REGRA DE AREA, aplicada secao por secao: indicador sem fato publicado nao ocupa celula, e secao
 * sem trabalho nao ocupa faixa. Nao existe o quarto bloco "para a tela parecer completa".
 *
 * RECORTE DE DOMINIO E HONESTO. A fila e recortada NO SERVIDOR (`GET /work-inbox?domain=`) e por
 * isso obedece ao chip. O snapshot executivo NAO publica recorte por dominio; quando o chip ativo e
 * de um dominio que a dimensao nao alcanca, a secao correspondente nao e exibida — em vez de mostrar
 * numero de OPERACOES sob um chip FISCAL. Ver `DOMAIN_DATA_DIMENSIONS`.
 */
export function OperationalDashboardPage() {
  const { state, reload, filters, setFilters, periodOptions, isRefreshing } = useExecutiveDashboard();
  const { options: unitOptions } = useOperationalUnits();
  const navigate = useNavigate();

  /**
   * RECORTE OPERACIONAL NA URL — dominio e vencimento sobrevivem a refresh, back/forward, bookmark
   * e drillback. O workspace deixa de esconder o contexto em `useState` local.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = parseDashboardDomain(searchParams.get('domain'));
  const overdueOnly = searchParams.get('overdue') === 'true';
  const [inbox, setInbox] = useState<WorkInboxPage | null>(null);
  const [inboxPhase, setInboxPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  /* A fila e recortada pelo SERVIDOR com o mesmo recorte do workspace: nada e filtrado no navegador. */
  useEffect(() => {
    const controller = new AbortController();
    setInboxPhase('loading');
    void getWorkInbox(
      { domain: domain ?? undefined, overdue: overdueOnly, limit: 12, offset: 0 },
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
  }, [domain, overdueOnly]);

  /*
   * SELECAO — o contexto e SOB DEMANDA, e por isso NAO existe auto-selecao aqui.
   *
   * Ate uma passada anterior, um efeito escolhia `inbox.items[0]` assim que a fila chegava: o
   * ContextDrawer abria sozinho no primeiro render de /app, cobrindo a tela com o contexto de um
   * item que o operador nunca escolheu. Contexto sem intencao do usuario e ruido, nao ajuda.
   *
   * O contrato e: `selected` comeca `null`, so a acao do operador o preenche, e fechar o drawer
   * volta para `null`. A UNICA excecao e a selecao que deixa de existir no recorte (item filtrado
   * para fora): ai a selecao e LIMPA, nunca trocada por outro item sem o operador pedir.
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

  const updateOperationalRecorte = useCallback(
    (key: 'domain' | 'overdue', value: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const unitLabel = filters.unitId ? operationalUnitLabel(unitOptions, filters.unitId) : null;

  /*
   * O SNAPSHOT sobrevive a uma falha de atualizacao: quando a leitura anterior chegou, o painel
   * continua exibindo o ultimo dado autoritativo enquanto o alerta de falha aparece no topo, em vez
   * de trocar a tela inteira por um estado vazio. O `partial` so existe no ramo de erro.
   */
  const snapshot =
    state.phase === 'ready' ? state.snapshot : state.phase === 'error' ? state.partial : undefined;
  const scope = snapshot ? scopedAttention(snapshot, domain) : null;
  const situation = snapshot && scope ? buildOperationalSituation(snapshot, scope) : null;
  const domainLabel = domain ? WORK_DOMAIN_LABELS[domain] : 'Tudo';

  const headerProps = {
    title: 'Visão geral',
    description:
      'O que exige decisão, onde o processo está e qual é o próximo passo — no seu escopo autorizado.',
    period: filters.period,
    periodOptions,
    onPeriodChange: (period: string) => setFilters({ period }),
    isRefreshing,
    onRefresh: () => void reload(),
    domain,
    onDomainChange: (nextDomain: WorkDomain | null) =>
      updateOperationalRecorte('domain', nextDomain),
    overdueOnly,
    onOverdueChange: (value: boolean) =>
      updateOperationalRecorte('overdue', value ? 'true' : null),
    situation,
    queueTotal: inboxPhase === 'ready' ? (inbox?.total ?? null) : null,
  };

  if (state.phase === 'loading') {
    return (
      <ModulePage layout="workspace">
        <DashboardWorkbenchHeader
          {...headerProps}
          unitLabel={unitLabel}
          periodLabel={null}
          generatedAt={null}
          generatedAtFormatted={null}
          activeFilters={[]}
        />
        <OperationalDashboardSkeleton />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage layout="workspace">
        <DashboardWorkbenchHeader
          {...headerProps}
          unitLabel={unitLabel}
          periodLabel={null}
          generatedAt={null}
          generatedAtFormatted={null}
          activeFilters={[]}
        />
        <ModuleDeniedState
          title="Visão geral"
          message="Você não tem permissão para visualizar a visão geral."
        />
      </ModulePage>
    );
  }

  const activeFilters = buildActiveFilterLabels(filters, unitOptions);
  const periodLabel = snapshot ? formatPeriodLabel(snapshot.period.from, snapshot.period.to) : null;
  const workbenchKpis = snapshot ? buildWorkbenchKpis(snapshot, domain) : [];
  const flowStages = snapshot ? buildBusinessFlow(snapshot, domain) : [];

  /*
   * PAINEL ANALITICO — distribuicao real do snapshot. Ele descreve OPERACAO (situacao das ordens) e
   * carteira (aging): cada bloco e exibido apenas no recorte que ALCANCA aquela dimensao, e o de
   * produtividade so aparece quando o snapshot o publica.
   */
  const showOperationDistribution =
    domainReachesOperation(domain) && snapshot!.charts.serviceOrdersByStatus.items.length > 0;
  const showAging =
    domainReachesFinance(domain) &&
    snapshot!.charts.financialAging.available &&
    snapshot!.charts.financialAging.buckets.length > 0;
  const dashboardKpis = showOperationDistribution ? buildDashboardKpis(snapshot!) : [];
  /*
   * SEM REPETICAO ENTRE AS DUAS LEITURAS DE INDICADOR.
   *
   * A faixa do topo (acionavel) e o painel "Saude da empresa" (descritivo) leem o MESMO snapshot com
   * papeis diferentes. Sem esta deduplicacao, "Recebíveis vencidos" aparecia duas vezes na mesma
   * dobra — com dois rotulos de acao distintos, o que faz o operador ler dois fatos onde existe um.
   * A exclusao e por IDENTIDADE da metrica.
   */
  const workbenchKpiIds = new Set(workbenchKpis.map((kpi) => kpi.id));
  const productivitySection = showOperationDistribution && dashboardKpis.length > 0
    ? { kpis: dashboardKpis, volume: buildPeriodVolume(snapshot!) }
    : null;
  const hasAnalytics = showOperationDistribution || showAging || productivitySection !== null;

  return (
    <ModulePage layout="workspace">
      <DashboardWorkbenchHeader
        {...headerProps}
        unitLabel={unitLabel}
        periodLabel={periodLabel}
        activeFilters={activeFilters}
        onClearFilters={
          activeFilters.length > 0 ? () => setFilters({ unitId: '', from: '', to: '' }) : undefined
        }
        generatedAt={snapshot?.generatedAt ?? null}
        generatedAtFormatted={snapshot ? formatGeneratedAt(snapshot.generatedAt) : null}
      />

      {state.phase === 'error' ? (
        <div className="dashboard-alert" role="alert">
          <p>{state.message}</p>
          <button type="button" className="dashboard-alert__retry" onClick={() => void reload()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <div className="dashboard-workspace">
          {/* 2 — SITUACAO: o estado do recorte, com UNKNOWN declarado. Substitui o banner antigo. */}
          {situation ? <SituationPanel situation={situation} /> : null}

          <SituationGaps
            inboxPhase={inboxPhase}
            unavailableDomains={inbox?.unavailableDomains ?? []}
            errorMessage={
              inboxPhase === 'error'
                ? 'Não foi possível falar com o servidor para montar a fila de trabalho.'
                : null
            }
          />

          {/*
            3 — INDICADORES. A faixa vem LOGO depois da situação e ANTES dos comandos.

            ORDEM DE LEITURA DO COMANDO CENTER — o operador pergunta, nesta sequencia:
            "como esta o recorte?" -> "quanto e o que?" -> "o que eu faco?" -> "onde trabalho?".
            A barra de comandos estava entre a situacao e os indicadores, e isso QUEBRAVA a cadeia:
            o numero ficava depois da acao, entao o operador via o botao antes de saber a magnitude
            do problema que ele resolve. Indicador e leitura; comando e resposta.
          */}
          <WorkbenchKpiStrip kpis={workbenchKpis} />

          {/* 4 — ATALHOS: rotas de modulo, rotuladas como tal (nao como comandos). */}
          <nav className="dashboard-actions" aria-label="Atalhos do workspace">
            <span className="dashboard-actions__label">{WORKSPACE_SHORTCUTS_LABEL}</span>
            {OPERATIONAL_ACTIONS.map((action) => (
              <Link key={action.id} className="dashboard-actions__link" to={action.href}>
                {action.label}
              </Link>
            ))}
          </nav>

          {/*
            5 — AREA CENTRAL DE TRABALHO. Duas colunas em desktop grande: a FILA ocupa o dominio
            visual (2fr) e o contexto operacional complementar fica ao lado (0.85fr). Sem conteudo
            complementar publicado, a fila ocupa a largura inteira — nao existe coluna vazia.
          */}
          <div className="dashboard-workspace__grid">
            <div className="dashboard-workspace__main">
              <WorkInboxSection
                page={inbox}
                phase={inboxPhase}
                domainLabel={domainLabel}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onOpenRoute={onOpenRoute}
                onClearRecorte={() => updateOperationalRecorte('domain', null)}
              />
            </div>

            <aside className="dashboard-workspace__side" aria-label="Contexto operacional">
              {hasAnalytics ? (
                <section className="dashboard-rail-panel" aria-label="Indicadores analíticos">
                  <div {...semanticSectionAttrs([
                    'productivity.completed_count',
                    'productivity.on_time_rate',
                    'productivity.avg_cycle_hours',
                    'productivity.rework_rate',
                  ])}>
                    <MetricStrip
                      kpis={dashboardKpis}
                      volume={productivitySection?.volume ?? null}
                      excludeIds={workbenchKpiIds}
                    />
                  </div>
                  <OperationDistribution snapshot={snapshot} visible={showOperationDistribution} />
                  <AgingDistribution aging={snapshot.charts.financialAging} visible={showAging} />
                </section>
              ) : (
                /*
                 * CONTEXTO OPERACIONAL — ESTRUTURA DE CONTEXTO, NAO TEXTO DE AJUDA.
                 *
                 * Antes, quando o recorte nao publicava indicador agregado, esta coluna virava um
                 * paragrafo explicativo — e o operador lia "mensagem de sistema" onde deveria ler
                 * "estado do meu recorte". O painel agora responde SEMPRE as mesmas perguntas
                 * (escopo, dominio, periodo, fila, situacao), com fatos que a tela JA possui, e a
                 * frase de ausencia fica como NOTA SECUNDARIA abaixo delas.
                 *
                 * Nenhum valor e inventado: o que nao foi publicado aparece como ausencia declarada.
                 */
                <section className="dashboard-context" aria-label="Contexto operacional">
                  <h2 className="dashboard-context__title">Contexto</h2>
                  <dl className="dashboard-context__facts">
                    <div className="dashboard-context__fact">
                      <dt>Escopo</dt>
                      <dd>{unitLabel ?? 'Todas as unidades autorizadas'}</dd>
                    </div>
                    <div className="dashboard-context__fact">
                      <dt>Domínio</dt>
                      <dd>{domainLabel}</dd>
                    </div>
                    <div className="dashboard-context__fact">
                      <dt>Período</dt>
                      <dd className="tabular-nums">{periodLabel ?? 'não informado'}</dd>
                    </div>
                    <div className="dashboard-context__fact">
                      <dt>Fila</dt>
                      <dd>
                        {inboxPhase === 'ready'
                          ? `${inbox?.total ?? 0} ${(inbox?.total ?? 0) === 1 ? 'item' : 'itens'}`
                          : 'não publicada nesta leitura'}
                      </dd>
                    </div>
                    <div className="dashboard-context__fact">
                      <dt>Situação</dt>
                      <dd>{situation ? situationBadgeLabel(situation) : 'não avaliada'}</dd>
                    </div>
                  </dl>

                  <p className="dashboard-context__note">
                    {domain
                      ? `Nenhum indicador agregado é publicado para o recorte ${domainLabel}. A fila continua recortada no servidor.`
                      : 'O snapshot executivo não publicou indicadores agregados para este escopo e período.'}
                  </p>
                  <Link
                    className="dashboard-context__link"
                    to={`/app/work-inbox${domain ? `?domain=${domain}` : ''}`}
                  >
                    Central de trabalho<span aria-hidden> →</span>
                  </Link>
                </section>
              )}
            </aside>
          </div>

          {/* 6 — FLUXO EMPRESARIAL: cadeia de processo, com drillback por etapa. */}
          <BusinessChainFlow stages={flowStages} domainLabel={domainLabel} />
        </div>
      ) : null}

      {/* CONTEXTO COMPLETO — o MESMO primitivo lateral usado pelas listas maduras do produto. */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: selected.businessReference,
                subtitle: selected.title,
                status: (
                  <StatusBadge
                    label={overdueLabel(selected.dueAt) ?? selected.status}
                    tone={daysOverdue(selected.dueAt) !== null ? 'error' : 'info'}
                  />
                ),
                facts: [
                  { label: 'Domínio', value: WORK_DOMAIN_LABELS[selected.domain] },
                  { label: 'Natureza', value: WORK_KIND_LABELS[selected.kind] },
                  { label: 'Motivo', value: selected.reason },
                  { label: 'Contexto', value: selected.contextLabel || '—' },
                  { label: 'Ocorrido em', value: formatMoment(selected.occurredAt) },
                  { label: 'Vencimento', value: formatMoment(selected.dueAt) },
                  {
                    label: 'Exceção',
                    value: overdueLabel(selected.dueAt) ?? 'Sem atraso',
                    emphasis: daysOverdue(selected.dueAt) !== null,
                  },
                ],
                nextAction: {
                  label: selected.actionLabel,
                  onClick: () => {
                    setSelected(null);
                    void navigate(selected.targetRoute);
                  },
                  kind: 'primary',
                },
                detailHref: selected.targetRoute,
                detailLabel: 'Abrir na tela de origem',
              }
            : null
        }
      />
    </ModulePage>
  );
}

/**
 * ANALITICO 1 — OPERACAO POR STATUS.
 *
 * Distribuicao autoritativa de OS por status (o servidor publica a contagem de cada status no
 * escopo). Cada barra abre a lista REAL filtrada por aquele status — nenhuma barra e decorativa.
 *
 * Nao existe total somado aqui: a soma dos status NAO e apresentada como "OS ativas", porque a
 * distribuicao e o fato publicado. A distribuicao so aparece no recorte que alcanca a OPERACAO.
 */
function OperationDistribution({
  snapshot,
  visible,
}: {
  snapshot: ExecutiveDashboardSnapshot;
  visible: boolean;
}) {
  const status = snapshot.charts.serviceOrdersByStatus;

  if (!visible || status.items.length === 0) {
    return null;
  }

  const maxCount = Math.max(1, ...status.items.map((item) => item.count));

  return (
    <section className="dashboard-analytic" aria-labelledby="status-heading">
      <header className="dashboard-section-head">
        <h2 id="status-heading" className="dashboard-section-head__title">
          Ordens por situação
        </h2>
      </header>

      <ul className="dashboard-dist">
        {status.items.map((item) => (
          <li key={item.status} className="dashboard-dist__item">
            <Link
              className="dashboard-dist__row"
              to={`/app/service-orders?status=${item.status}`}
              aria-label={`${item.label}: ${item.count} ordens. Abrir lista filtrada.`}
            >
              <span className="dashboard-dist__label">{item.label}</span>
              <span className="dashboard-dist__track" aria-hidden>
                <span
                  className={
                    item.status === 'IN_EXECUTION'
                      ? 'dashboard-dist__bar dashboard-dist__bar--active'
                      : item.status === 'PAUSED'
                        ? 'dashboard-dist__bar dashboard-dist__bar--paused'
                        : 'dashboard-dist__bar'
                  }
                  style={{ width: `${(item.count / maxCount) * 100}%` }}
                />
              </span>
              <span className="dashboard-dist__count tabular-nums">{item.count}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="dashboard-analytic__note">{status.summary}</p>
    </section>
  );
}

/**
 * ANALITICO 2 — AGING FINANCEIRO.
 *
 * Distribuicao por faixa de atraso, com as faixas REAIS que o servidor publicou (nao ha faixa fixa
 * inventada aqui: 1-7/8-15/16-30/30+ so aparecem se forem as configuradas no backend).
 *
 * Cada faixa leva ao recorte real de titulos vencidos. A barra e proporcional a MAIOR faixa — e uma
 * leitura de distribuicao, nao um total: nenhum valor e somado entre faixas.
 *
 * `available=false` (sem aging autorizado) NAO vira zero: a secao inteira desaparece, porque uma
 * distribuicao de nada nao informa nada.
 */
function AgingDistribution({
  aging,
  visible,
}: {
  aging: ExecutiveDashboardSnapshot['charts']['financialAging'];
  visible: boolean;
}) {
  if (!visible || !aging.available || aging.buckets.length === 0) {
    return null;
  }

  const maxCount = Math.max(1, ...aging.buckets.map((bucket) => bucket.count));

  return (
    <section className="dashboard-analytic" aria-labelledby="aging-heading">
      <header className="dashboard-section-head">
        <h2 id="aging-heading" className="dashboard-section-head__title">
          Atraso por faixa
        </h2>
      </header>

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
                  className={
                    bucket.count > 0
                      ? 'dashboard-dist__bar dashboard-dist__bar--critical'
                      : 'dashboard-dist__bar'
                  }
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

      <p className="dashboard-analytic__note">{aging.summary}</p>
    </section>
  );
}
