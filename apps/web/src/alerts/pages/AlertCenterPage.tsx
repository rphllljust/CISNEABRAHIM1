import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAlertsCenter } from '../hooks/useAlerts';
import {
  BUSINESS_ALERT_TYPES,
  type BusinessAlertListItem,
  type BusinessAlertType,
} from '../types/alerts.types';
import { ModulePage, ModulePageHeader, ModuleStatePage, ModuleLoadingState, ModuleDeniedState, ModuleErrorState, UnitScopeLabel } from '../../ui/module-layout';
import {
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { StatusBadge } from '../../ui/StatusBadge';
import {
  WorkbenchMetric,
  WorkbenchQueue,
  WorkbenchQueueItem,
  WorkbenchSummaryStrip,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { toWorkInboxItem } from '../../operator/work-inbox/work-inbox';

/**
 * CENTRAL DE ALERTAS — FILA DE EXCECOES, nao formulario de consulta.
 *
 * A tela era um formulario: tres `<select>`, uma frase e espaco vazio. O operador nao abria
 * para trabalhar — abria para descobrir que nao havia nada para fazer. Agora ela e uma mesa de
 * trabalho: faixa de resumo com os numeros REAIS do recorte, fila de alertas ordenada pela
 * severidade PERSISTIDA (critico antes de atencao) e, por item, o que aconteceu, por que exige
 * acao, o objeto relacionado, a data/idade real, a situacao e o proximo passo.
 *
 * NADA aqui inventa numero, severidade ou ordem: a severidade vem de `item.severity`, a idade de
 * `triggeredAt` e a ordem e a mesma regra ja publicada em `operator/work-inbox` (severidade
 * primeiro, mais antigo antes). O hook `useAlertsCenter`, os filtros, a URL e as chamadas sao os
 * mesmos — mudou a superficie, nao o contrato.
 */

/** Lista vazia estavel: mantem a identidade da referencia entre renderizacoes. */
const NO_ITEMS: BusinessAlertListItem[] = [];

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function severityLabel(severity: BusinessAlertListItem['severity']): string {
  // Vocabulario ja existente no dominio (mesmo rotulo do filtro de severidade).
  return severity === 'CRITICAL' ? 'Crítico' : 'Atenção';
}

function statusLabel(status: BusinessAlertListItem['status']): string {
  return status === 'ACTIVE' ? 'Ativo' : 'Resolvido';
}

export function AlertCenterPage() {
  const { state, reload, filters, setFilters } = useAlertsCenter();

  const items =
    state.phase === 'ready'
      ? state.items
      : state.phase === 'error'
        ? (state.partial ?? NO_ITEMS)
        : NO_ITEMS;

  /**
   * FILA ORDENADA PELO FATO PERSISTIDO.
   *
   * `toWorkInboxItem` e o mesmo utilitario que a Central de trabalho usa: ele le severidade e
   * `triggeredAt` do alerta e devolve rotulo humano, tempo parado e proxima acao — sem criar
   * estado novo. A ordenacao e a mesma regra do produto: severidade primeiro (critico no topo) e,
   * dentro dela, o que esta parado ha mais tempo.
   */
  const queue = useMemo(() => {
    const now = new Date();
    return items
      .map((alert) => ({ alert, work: toWorkInboxItem(alert, now) }))
      .sort((left, right) => {
        if (right.work.priorityScore !== left.work.priorityScore) {
          return right.work.priorityScore - left.work.priorityScore;
        }
        return new Date(left.work.stalledSince).getTime() - new Date(right.work.stalledSince).getTime();
      });
  }, [items]);

  const criticalCount = items.filter((item) => item.severity === 'CRITICAL').length;
  const warningCount = items.filter((item) => item.severity === 'WARNING').length;
  const resolvedCount = items.filter((item) => item.status === 'RESOLVED').length;
  const hasFilter = Boolean(filters.type || filters.severity) || filters.status !== 'ACTIVE';

  if (state.phase === 'loading') {
    return (
      <ModuleStatePage title="Central de alertas">
        <ModuleLoadingState message="Carregando alertas operacionais…" />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModuleStatePage title="Central de alertas">
        <ModuleDeniedState message="Você não tem permissão para visualizar alertas operacionais." />
      </ModuleStatePage>
    );
  }

  const toolbarAction = (
    <button type="button" className={workbenchSecondaryActionClass} onClick={() => void reload()}>
      Atualizar
    </button>
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Central de alertas"
        description="Alertas persistentes derivados das políticas operacionais — não substituem ações no fluxo."
        action={toolbarAction}
      />

      {/*
        RESUMO — todos os numeros sao contados do MESMO conjunto que a fila exibe, no recorte
        atual. Nao existe total global nesta resposta do servidor, entao nenhum total global e
        afirmado aqui.
      */}
      {items.length > 0 ? (
        <WorkbenchSummaryStrip>
          <WorkbenchMetric value={items.length} label="alertas no recorte atual" />
          <WorkbenchMetric value={criticalCount} label="críticos" tone="critical" />
          <WorkbenchMetric value={warningCount} label="em atenção" tone="warning" />
          {resolvedCount > 0 ? (
            <WorkbenchMetric value={resolvedCount} label="resolvidos" tone="success" />
          ) : null}
        </WorkbenchSummaryStrip>
      ) : null}

      {/* BARRA COMPACTA: os mesmos tres recortes, com o mesmo valor enviado ao servidor. */}
      <WorklistFilterBar
        meta={
          hasFilter ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
              onClick={() =>
                setFilters({
                  status: 'ACTIVE',
                  // Vazio e o contrato do hook para REMOVER o parametro da URL.
                  type: '' as BusinessAlertType,
                  severity: '' as 'WARNING' | 'CRITICAL',
                })
              }
            >
              Limpar filtros
            </button>
          ) : null
        }
      >
        <WorklistField label="Status" htmlFor="alert-status">
          <select
            id="alert-status"
            className={worklistSelectClass}
            value={filters.status ?? 'ACTIVE'}
            onChange={(event) => setFilters({ status: event.target.value as 'ACTIVE' | 'RESOLVED' })}
          >
            <option value="ACTIVE">Ativos</option>
            <option value="RESOLVED">Resolvidos</option>
          </select>
        </WorklistField>

        <WorklistField label="Tipo" htmlFor="alert-type">
          <select
            id="alert-type"
            className={worklistSelectClass}
            value={filters.type ?? ''}
            onChange={(event) =>
              setFilters({ type: (event.target.value as BusinessAlertType) || undefined })
            }
          >
            <option value="">Todos</option>
            <option value={BUSINESS_ALERT_TYPES.ServiceOrderOverdue}>OS vencida</option>
            <option value={BUSINESS_ALERT_TYPES.ServiceOrderDueSoon}>OS vencendo</option>
            <option value={BUSINESS_ALERT_TYPES.ServiceOrderStalled}>OS parada</option>
            <option value={BUSINESS_ALERT_TYPES.MeasurementAging}>Medição parada</option>
            <option value={BUSINESS_ALERT_TYPES.BillingAging}>Faturamento parado</option>
            <option value={BUSINESS_ALERT_TYPES.PaymentOverdue}>Pagamento vencido</option>
          </select>
        </WorklistField>

        <WorklistField label="Severidade" htmlFor="alert-severity">
          <select
            id="alert-severity"
            className={worklistSelectClass}
            value={filters.severity ?? ''}
            onChange={(event) =>
              setFilters({
                severity: (event.target.value as 'WARNING' | 'CRITICAL' | '') || undefined,
              })
            }
          >
            <option value="">Todas</option>
            <option value="WARNING">Atenção</option>
            <option value="CRITICAL">Crítico</option>
          </select>
        </WorklistField>
      </WorklistFilterBar>

      {state.phase === 'error' ? (
        <div className="mb-2">
          <ModuleErrorState
            message={state.message}
            retryable
            onRetry={() => void reload()}
          />
        </div>
      ) : null}

      <WorkbenchQueue
        title="Fila de alertas"
        count={items.length}
        description="Ordenada pela severidade persistida e, dentro dela, pelo tempo parado do alerta."
        emptyTitle={
          hasFilter ? 'Nenhum alerta no recorte selecionado' : 'Nenhum alerta ativo persistido'
        }
        emptyDescription={
          hasFilter
            ? 'O servidor não devolveu alerta para este recorte. Ajuste ou limpe os filtros para ver o conjunto completo.'
            : 'As políticas operacionais não geraram alerta persistido para este escopo.'
        }
      >
        {queue.map(({ alert, work }) => (
          <WorkbenchQueueItem
            key={alert.id}
            severity={
              <WorklistException tone={work.severity === 'CRITICAL' ? 'critical' : 'warning'}>
                {severityLabel(work.severity)}
              </WorklistException>
            }
            severityTone={work.severity === 'CRITICAL' ? 'critical' : 'warning'}
            title={alert.title}
            reason={alert.message}
            context={
              <>
                <StatusBadge
                  label={statusLabel(alert.status)}
                  tone={alert.status === 'ACTIVE' ? 'warning' : 'success'}
                />
                <span className="ml-3">{work.kindLabel}</span>
                <span className="ml-3">
                  <UnitScopeLabel unitId={alert.unitId} />
                </span>
              </>
            }
            age={
              <>
                Disparado em {formatWhen(alert.triggeredAt)} · {work.stalledLabel}
                {alert.resolvedAt ? ` · Resolvido em ${formatWhen(alert.resolvedAt)}` : null}
              </>
            }
            action={
              <>
                <span className="text-xs text-gray-600">{work.nextAction}</span>
                <Link className={workbenchPrimaryActionClass} to={alert.entityHref}>
                  Abrir entidade relacionada
                </Link>
              </>
            }
          />
        ))}
      </WorkbenchQueue>
    </ModulePage>
  );
}
