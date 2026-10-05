import { Link } from 'react-router-dom';
import { AttentionBlock } from '../components/AttentionBlock';
import { BusinessFlowStrip, DashboardKpiStrip, PeriodVolumeFootnote } from '../components/DashboardKpiStrip';
import { DashboardPageHeader } from '../components/DashboardPageHeader';
import { FinancePanel } from '../components/FinancePanel';
import { FiscalPanel } from '../components/FiscalPanel';
import { OperationPanel } from '../components/OperationPanel';
import { OperationalDashboardSkeleton } from '../components/OperationalDashboardSkeleton';
import { ProductivityPanel } from '../components/ProductivityPanel';
import { WorkInboxSection } from '../components/WorkInboxSection';
import { useExecutiveDashboard } from '../hooks/useExecutiveDashboard';
import { useOperationalUnits, operationalUnitLabel } from '../../shell/hooks/useOperationalUnits';
import { buildDashboardKpis, buildPeriodVolume } from '../utils/build-dashboard-kpis';
import { buildBusinessFlow } from '../utils/dashboard-semantics';
import { semanticSectionAttrs } from '../semantic-dashboard';
import { ModuleDeniedState, ModulePage } from '../../ui';
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

/**
 * RECORTE ATIVO — nunca o identificador interno.
 *
 * `filters.unitId` e o valor real enviado a API (`unit-synthetic-homolog` em HML: slug de ambiente
 * somado a codigo tecnico). Ele era concatenado direto no rotulo — `Unidade: unit-synthetic-homolog`
 * no PAINEL, a primeira tela do produto. O `operationalUnitLabel` resolve o rotulo pelo mesmo
 * dicionario que o filtro usa; o valor cru permanece apenas na consulta autorizada.
 */
function buildActiveFilterLabels(
  filters: {
    period: string;
    unitId?: string;
    from?: string;
    to?: string;
  },
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
 * EXECUTIVE CONTROL TOWER — composicao do painel principal.
 *
 * Ordem de leitura (5 segundos): saúde da empresa -> o que exige decisão agora ->
 * onde está o dinheiro e o atraso -> operação -> fluxo -> produtividade -> fiscal.
 *
 * Todas as fontes continuam sendo o SNAPSHOT COMPOSTO UNICO
 * (`GET /dashboard/executive` via useExecutiveDashboard): um request, sem N+1,
 * sem polling novo, sem cálculo de regra empresarial no navegador.
 */
export function OperationalDashboardPage() {
  const { state, reload, filters, setFilters, periodOptions, isRefreshing } = useExecutiveDashboard();
  const { options: unitOptions } = useOperationalUnits();

  const headerProps = {
    title: 'Visão geral',
    period: filters.period,
    periodOptions,
    onPeriodChange: (period: string) => setFilters({ period }),
    isRefreshing,
    onRefresh: () => void reload(),
  };

  // Rótulo humano da unidade no cabeçalho; o valor cru nunca chega à superfície.
  const unitLabel = filters.unitId ? operationalUnitLabel(unitOptions, filters.unitId) : null;

  if (state.phase === 'loading') {
    return (
      <ModulePage className="max-w-7xl">
        <DashboardPageHeader
          {...headerProps}
          unitLabel={unitLabel}
          periodLabel={null}
          activeFilters={[]}
          generatedAt={null}
          generatedAtFormatted={null}
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
          activeFilters={[]}
          generatedAt={null}
          generatedAtFormatted={null}
          isRefreshing={false}
        />
        <ModuleDeniedState
          title="Painel operacional"
          message="Você não tem permissão para visualizar o painel operacional."
        />
      </ModulePage>
    );
  }

  const snapshot = state.phase === 'ready' ? state.snapshot : state.partial;
  const kpis = snapshot ? buildDashboardKpis(snapshot) : [];
  const volume = snapshot ? buildPeriodVolume(snapshot) : null;
  const flow = snapshot ? buildBusinessFlow(snapshot) : [];
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
        <>
          <div className="dashboard-fold">
            <AttentionBlock items={snapshot.attention} />
            <div className="dashboard-fold__kpis">
              <DashboardKpiStrip kpis={kpis} />
              {volume ? <PeriodVolumeFootnote volume={volume} /> : null}
            </div>
          </div>

          {flow.length > 0 ? <BusinessFlowStrip stages={flow} /> : null}

          {/* MINHA FILA — fila de trabalho real composta DENTRO do Command Center.
              Consome o MESMO read model `GET /work-inbox` da Central de trabalho: o operador
              processa itens (seleciona, vê contexto no drawer, age ou faz drilldown) sem
              abandonar o painel. Agregado (AttentionBlock) ≠ fila (WorkInboxSection). */}
          <WorkInboxSection />

          {snapshot.visibility.serviceOrders ? <OperationPanel snapshot={snapshot} /> : null}

          {snapshot.visibility.productivity && snapshot.productivity ? (
            <div
              {...semanticSectionAttrs([
                'productivity.completed_count',
                'productivity.on_time_rate',
                'productivity.avg_cycle_hours',
                'productivity.rework_rate',
              ])}
            >
              <ProductivityPanel productivity={snapshot.productivity} />
            </div>
          ) : null}

          {/*
            ANCORA SEMANTICA DO FINANCEIRO — a secao renderiza `receivables.overdue_count`
            (contagem vencida) e `receivables.overdue_amount` (exposicao publicada pelo
            serializer no mesmo payload). O atributo liga a secao ao catalogo SMC-001
            sem mover regra para o navegador.
          */}
          <div
            {...semanticSectionAttrs(['receivables.overdue_count', 'receivables.overdue_amount'])}
          >
            <FinancePanel snapshot={snapshot} />
          </div>

          <FiscalPanel snapshot={snapshot} />

          {snapshot.shortcuts.length > 0 ? (
            <nav className="dashboard-shortcuts" aria-label="Atalhos operacionais">
              {snapshot.shortcuts.map((shortcut) => (
                <Link
                  key={shortcut.id}
                  className="dashboard-shortcuts__link"
                  to={shortcut.href}
                  aria-label={shortcut.ariaLabel}
                >
                  {shortcut.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </>
      ) : null}
    </ModulePage>
  );
}
