import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AttentionBlock } from '../components/AttentionBlock';
import { DashboardPageHeader } from '../components/DashboardPageHeader';
import { MetricStrip } from '../components/MetricStrip';
import { OperationalDashboardSkeleton } from '../components/OperationalDashboardSkeleton';
import { WorkInboxSection } from '../components/WorkInboxSection';
import { useExecutiveDashboard } from '../hooks/useExecutiveDashboard';
import { useOperationalUnits, operationalUnitLabel } from '../../shell/hooks/useOperationalUnits';
import { buildDashboardKpis, buildPeriodVolume } from '../utils/build-dashboard-kpis';
import { buildBusinessFlow, type BusinessFlowStage } from '../utils/dashboard-semantics';
import { semanticSectionAttrs } from '../semantic-dashboard';
import { ModuleDeniedState, ModulePage } from '../../ui';
import { ContextDrawer } from '../../operator';
import { NextActionPanel } from '../../enterprise-object/NextActionPanel';
import { StatusBadge } from '../../ui/StatusBadge';
import { getWorkInbox, type WorkInboxPage, type WorkItem } from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../work-inbox/pages/WorkInboxPage';
import { WORK_DOMAIN_LABELS, WORK_KIND_LABELS } from '../../work-inbox/api/work-inbox-api';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';
import '../dashboard.css';

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPeriodLabel(from: string, to: string): string {
  return `${from} — ${to}`;
}

function formatMoment(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
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
 * EXECUTIVE OPERATIONAL WORKSPACE — a Visao geral do ERP.
 *
 * TRES ZONAS, na ordem das perguntas de quem administra a empresa:
 *
 *   1. DECISAO   — o que exige atencao, quanto pesa e o que eu faco agora;
 *   2. FLUXO     — onde o processo esta, do comercial ao caixa, como UMA cadeia;
 *   3. CONTEXTO  — o detalhe do que selecionei, sem sair da tela.
 *
 * COMPOSICAO, NAO NOVA GRAMATICA. Toda zona e montada com primitivos que ja existem no CISNE:
 *   Zone 1 -> `AttentionBlock` (fila densa de excecoes) + `WorkbenchQueue` (fila de trabalho real)
 *   Zone 2 -> `BusinessChain` (a cadeia empresarial) alimentada pelos fatos do snapshot
 *   Zone 3 -> `ContextDrawer` + `NextActionPanel` + `StatusBadge`, e `EnterpriseMetric` na faixa
 * O que esta tela acrescenta e COMPOSICAO (qual primitivo aparece onde, e com que recorte), nao
 * um componente novo. Nenhum comportamento, filtro, rota ou capability nasce aqui.
 *
 * Nao existe um quarto bloco "para a tela parecer completa": indicador sem fato publicado nao
 * ocupa celula, e secao sem trabalho nao ocupa faixa.
 *
 * Fontes continuam sendo o SNAPSHOT COMPOSTO UNICO (`GET /dashboard/executive`) e o read model da
 * fila (`GET /work-inbox`): sem N+1, sem polling novo, sem regra empresarial no navegador.
 */
export function OperationalDashboardPage() {
  const { state, reload, filters, setFilters, periodOptions, isRefreshing } = useExecutiveDashboard();
  const { options: unitOptions } = useOperationalUnits();
  const navigate = useNavigate();

  /** UNICO recorte de dominio da tela — alimenta fila, cadeia e faixa de indicadores. */
  const [domain, setDomain] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [inbox, setInbox] = useState<WorkInboxPage | null>(null);
  const [inboxPhase, setInboxPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  /* A fila e recortada pelo SERVIDOR com o mesmo recorte do painel: nada e filtrado no navegador. */
  useEffect(() => {
    const controller = new AbortController();
    setInboxPhase('loading');
    void getWorkInbox(
      { domain: (domain ?? undefined) as never, overdue: overdueOnly, limit: 6, offset: 0 },
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

  /* Selecao trocada -> contexto trocado. A fila abre com o primeiro item ja em contexto. */
  useEffect(() => {
    setSelected((current) => {
      if (current && inbox?.items.some((item) => item.id === current.id)) {
        return current;
      }
      return inbox?.items[0] ?? null;
    });
  }, [inbox]);

  const onOpenRoute = useCallback(
    (route: string) => {
      void navigate(route);
    },
    [navigate],
  );

  const headerProps = {
    title: 'Visão geral',
    period: filters.period,
    periodOptions,
    onPeriodChange: (period: string) => setFilters({ period }),
    isRefreshing,
    onRefresh: () => void reload(),
    domain,
    onDomainChange: setDomain,
    overdueOnly,
    onOverdueChange: setOverdueOnly,
  };

  const unitLabel = filters.unitId ? operationalUnitLabel(unitOptions, filters.unitId) : null;

  if (state.phase === 'loading') {
    return (
      <ModulePage className="max-w-7xl">
        <DashboardPageHeader
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
      <ModulePage className="max-w-7xl">
        <DashboardPageHeader
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

  const snapshot = state.phase === 'ready' ? state.snapshot : state.partial;
  const activeFilters = buildActiveFilterLabels(filters, unitOptions);
  const periodLabel = snapshot ? formatPeriodLabel(snapshot.period.from, snapshot.period.to) : null;

  return (
    <ModulePage className="max-w-7xl">
      <DashboardPageHeader
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
          <div className="dashboard-workspace__main">
            {/* ZONA 1 — DECISAO. Excecoes que exigem decisao, em linhas densas. */}
            <AttentionBlock items={scopedAttention(snapshot, domain)} />

            {/* ZONA 2 — FLUXO EMPRESARIAL: resumo agregado do workspace, estágio por estágio. */}
            <BusinessFlowSummary stages={buildBusinessFlow(snapshot, domain)} />

            {/* FILA — o trabalho real que sustenta os numeros acima. */}
            <section className="dashboard-work" aria-labelledby="queue-heading">
              <WorkInboxSection
                page={inbox}
                phase={inboxPhase}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onOpenRoute={onOpenRoute}
              />
            </section>
          </div>

          {/* ZONA 3 — CONTEXTO EXECUTIVO, coluna lateral fixa. */}
          <aside className="dashboard-workspace__side" aria-label="Contexto executivo">
            <div className="dashboard-side-panel">
              <h2 className="dashboard-side-panel__title">Contexto</h2>
              {selected ? (
                <div className="dashboard-side-summary">
                  <p className="dashboard-side-summary__id">{selected.businessReference}</p>
                  <p className="dashboard-side-summary__title">{selected.title}</p>
                  <div className="mt-1">
                    <StatusBadge
                      label={
                        daysOverdue(selected.dueAt) !== null
                          ? `${daysOverdue(selected.dueAt)} dia(s) em atraso`
                          : WORK_KIND_LABELS[selected.kind]
                      }
                      tone={daysOverdue(selected.dueAt) !== null ? 'error' : 'info'}
                    />
                  </div>
                  <p className="dashboard-side-summary__reason">{selected.reason}</p>
                  <NextActionPanel
                    className="mt-2"
                    action={{
                      kind: 'act',
                      label: selected.actionLabel,
                      description: `${WORK_DOMAIN_LABELS[selected.domain]} · vencimento ${formatMoment(selected.dueAt)}`,
                      to: selected.targetRoute,
                    }}
                  />
                </div>
              ) : (
                <p className="dashboard-side-panel__empty">
                  Selecione um trabalho na fila para ver o contexto aqui.
                </p>
              )}
            </div>

            {/* SAUDE DA EMPRESA — metric strip compacto, sem grade de celulas vazias. */}
            <div
              {...semanticSectionAttrs([
                'productivity.completed_count',
                'productivity.on_time_rate',
                'productivity.avg_cycle_hours',
                'productivity.rework_rate',
              ])}
            >
              <MetricStrip kpis={buildDashboardKpis(snapshot)} volume={buildPeriodVolume(snapshot)} />
            </div>
          </aside>
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
                    label={
                      daysOverdue(selected.dueAt) !== null
                        ? `${daysOverdue(selected.dueAt)} dia(s) em atraso`
                        : selected.status
                    }
                    tone={daysOverdue(selected.dueAt) !== null ? 'error' : 'info'}
                  />
                ),
                facts: [
                  { label: 'Domínio', value: WORK_DOMAIN_LABELS[selected.domain] },
                  { label: 'Natureza', value: WORK_KIND_LABELS[selected.kind] },
                  { label: 'Motivo', value: selected.reason },
                  { label: 'Contexto', value: selected.contextLabel || '—' },
                  { label: 'Vencimento', value: formatMoment(selected.dueAt) },
                  {
                    label: 'Exceção',
                    value:
                      daysOverdue(selected.dueAt) !== null
                        ? `${daysOverdue(selected.dueAt)} dia(s) em atraso`
                        : 'Sem atraso',
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
 * ZONA 2 — FLUXO EMPRESARIAL.
 *
 * Este resumo e AGREGADO DO WORKSPACE: cada estagio mostra o volume que o PROPRIO servidor
 * publicou para ele. Nao e `BusinessChain` — aquele primitivo representa cadeia real de
 * entidades/relacoes (Cliente -> Proposta -> OS -> Faturamento -> Recebivel), e forcar uma
 * metrica de processo dentro dele seria mentir sobre o que a cadeia significa. Nao e
 * `OperationsControlCenter` tampouco: aquele descreve UMA ordem de servico.
 *
 * O que esta secao faz e compor os primitivos existentes SEM inventar vocabulario novo:
 *   EnterpriseMetric -> o numero real do estagio
 *   StatusBadge      -> a situacao dominante do estagio
 * Um estagio sem contagem publicada mostra o ESTADO, nunca um zero.
 */
function BusinessFlowSummary({ stages }: { stages: BusinessFlowStage[] }) {
  if (stages.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="flow-heading" className="dashboard-flow">
      <header className="dashboard-section-head">
        <h2 id="flow-heading" className="dashboard-section-head__title">
          Fluxo empresarial
        </h2>
        <p className="dashboard-section-head__meta">
          Da execução ao caixa. Cada estágio mostra o que ele mesmo publicou.
        </p>
      </header>

      <ol className="dashboard-flow__stages">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className={[
              'dashboard-flow__stage',
              stage.situation === 'critical' && 'dashboard-flow__stage--critical',
              stage.situation === 'attention' && 'dashboard-flow__stage--attention',
              stage.count === null && 'dashboard-flow__stage--unknown',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {index > 0 ? (
              <span className="dashboard-flow__step" aria-hidden>
                →
              </span>
            ) : null}
            {/* O NUMERO E O FATO PRINCIPAL do estagio. */}
            <span className="dashboard-flow__value">
              {stage.count !== null ? (
                <span className="dashboard-flow__number tabular-nums">{stage.count}</span>
              ) : (
                /* AUSENCIA != ZERO: sem contagem publicada nao existe "0" — existe o estado. */
                <span className="dashboard-flow__unknown">sem contagem publicada</span>
              )}
              {stage.amount ? (
                <span className="dashboard-flow__exposure tabular-nums">{stage.amount}</span>
              ) : null}
            </span>
            {/* LABEL e SITUACAO sao secundarios. */}
            <span className="dashboard-flow__label">{stage.label}</span>
            {stage.count !== null ? (
              <span
                className={[
                  'dashboard-flow__situation',
                  stage.situation === 'critical' && 'dashboard-flow__situation--critical',
                  stage.situation === 'attention' && 'dashboard-flow__situation--attention',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {stage.situationLabel}
              </span>
            ) : null}
            <span className="dashboard-flow__hint">{stage.hint}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Excecao de CONTEUDO (divergencia: medicao rejeitada ou faturamento anulado) nao e excecao de
 * prazo: ela aparece no estagio que a produz, dentro da cadeia, e nao duas vezes na fila.
 */
function scopedAttention(snapshot: ExecutiveDashboardSnapshot, domain: string | null) {
  const operational = snapshot.attention.filter((item) => item.id !== 'divergences');
  if (!domain) {
    return operational;
  }
  if (domain === 'FINANCEIRO') {
    return operational.filter((item) => item.id === 'overdue-receivables');
  }
  if (domain === 'FISCAL' || domain === 'CONTABILIDADE' || domain === 'SUPRIMENTOS') {
    return [];
  }
  return operational;
}
