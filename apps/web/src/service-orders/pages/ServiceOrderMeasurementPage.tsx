import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { getExecutionBundle } from '../api/service-order-execution-api';
import {
  approveMeasurement,
  createMeasurement,
  getMeasurement,
  rejectMeasurement,
  resubmitMeasurement,
  startMeasurementReview,
  submitMeasurement,
} from '../api/measurement-api';
import { mapMeasurementsErrorToMessage } from '../api/measurements-error-messages';
import { listPlannedResources } from '../api/service-order-planning-api';
import { getServiceOrder, ServiceOrdersApiError } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { MeasurementApprovalDialog } from '../components/MeasurementApprovalDialog';
import { MeasurementComparisonCards } from '../components/MeasurementComparisonCards';
import { MeasurementComparisonTable } from '../components/MeasurementComparisonTable';
import { MeasurementSummaryPanel } from '../components/MeasurementSummaryPanel';
import { MEASUREMENT_STATUS_LABELS } from '../components/MeasurementStatusBadge';
import { MeasurementTimeline } from '../components/MeasurementTimeline';
import { MeasurementVersionConflictBanner } from '../components/MeasurementVersionConflictBanner';
import { getMeasurementWorkbench } from '../api/measurement-workbench-api';
import type { MeasurementWorkbenchReadModel } from '../types/measurement-workbench.types';
import { useMeasurementCapabilities } from '../hooks/useMeasurementCapabilities';
import {
  MEASUREMENT_STATUSES,
  MEASUREMENTS_ERROR_CODES,
  type MeasurementDetail,
} from '../types/measurement.types';
import type { PlannedResource } from '../types/resource-planning.types';
import { SERVICE_ORDER_STATUSES, type ServiceOrderDetail } from '../types/service-order.types';
import { buildMeasurementComparisonRows } from '../utils/measurement-comparison';
import { sumMoneyLines } from '../utils/measurement-format';
import { buildRequirementCoverage, collectSatisfiedEvidenceKinds, parseExecutionRequirements } from '../utils/execution-requirements';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui';
import { EnterpriseObjectHeader, EnterpriseObjectPage, ObjectPanel } from '../../enterprise-object';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      measurement: MeasurementDetail | null;
      planned: PlannedResource[];
      evidencePending: boolean;
    };

function readClientLabel(order: ServiceOrderDetail): string {
  if (!order.clientSnapshot) {
    return 'Cliente';
  }
  const tradeName = order.clientSnapshot.tradeName;
  const legalName = order.clientSnapshot.legalName;
  if (typeof tradeName === 'string' && tradeName.trim()) {
    return tradeName;
  }
  if (typeof legalName === 'string' && legalName.trim()) {
    return legalName;
  }
  return 'Cliente';
}

export function ServiceOrderMeasurementPage() {
  const { serviceOrderId = '' } = useParams();
  const feedbackId = useId();
  const { capabilities } = useMeasurementCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const requestSeq = useRef(0);

  /**
   * SUPERFÍCIE DE COMANDOS publicada pelo backend.
   *
   * `null` significa "não foi possível ler" — e nesse caso nenhum comando é
   * habilitado. Assumir habilitado por ausência de informação habilitaria um
   * botão que o backend pode recusar.
   */
  const [workbench, setWorkbench] = useState<MeasurementWorkbenchReadModel | null>(null);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    setVersionConflict(false);
    try {
      /**
       * O WORKBENCH É A AUTORIDADE DA HABILITAÇÃO.
       *
       * Esta página já carrega a ordem, o planejamento e a medição — leituras
       * necessárias à CONFERÊNCIA. O que ela não pode fazer é decidir quais
       * comandos estão habilitados, e é isso que o workbench publica: a mesma
       * superfície que a estação de trabalho usa.
       *
       * O `catch` devolve `null` porque a conferência continua útil sem ele: a
       * tela então NÃO habilita comando nenhum — conservador no ponto certo,
       * porque sem a decisão do backend a única leitura honesta é "não sei".
       */
      const [order, planned, measurement, execution, workbenchRead] = await Promise.all([
        getServiceOrder(serviceOrderId),
        listPlannedResources(serviceOrderId),
        getMeasurement(serviceOrderId),
        getExecutionBundle(serviceOrderId).catch(() => null),
        getMeasurementWorkbench(serviceOrderId).catch(() => null),
      ]);
      if (seq !== requestSeq.current) {
        return;
      }
      setWorkbench(workbenchRead);

      const requirements = parseExecutionRequirements(order.serviceSnapshot);
      const satisfied = execution ? collectSatisfiedEvidenceKinds(execution) : new Set<string>();
      const coverage = buildRequirementCoverage(requirements, satisfied);
      const evidencePending = coverage.some(
        (item) => item.requirementLevel === 'REQUIRED' && !item.satisfied,
      );

      setState({ phase: 'ready', order, measurement, planned, evidencePending });
    } catch (error) {
      if (seq !== requestSeq.current) {
        return;
      }
      if (error instanceof ServiceOrdersApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        if (error.kind === 'not_found') {
          setState({ phase: 'not_found' });
          return;
        }
      }
      setState({
        phase: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a medição.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreateMeasurement() {
    if (state.phase !== 'ready' || submitting) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const measurement = await createMeasurement(serviceOrderId);
      setState({ ...state, measurement });
      setFeedback({ tone: 'success', message: 'Medição criada a partir da execução.' });
      // A medição passou a existir: a superfície de comandos muda de DRAFT para
      // as transições, e precisa vir do backend.
      await refreshWorkbench();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapMeasurementsErrorToMessage(error.code, error.status)
            : 'Não foi possível criar a medição.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * RECARREGA A SUPERFÍCIE DE COMANDOS.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * O DEFEITO QUE ISTO FECHA
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `runTransition` aplicava o agregado devolvido pelo comando
   * (`setState({ ...state, measurement })`) e NÃO recarregava o workbench. O
   * resultado: depois de submeter, a tela mostrava o estado NOVO e continuava
   * com a superfície de comandos do estado ANTIGO — o botão "iniciar análise"
   * nunca aparecia, porque o read model ainda dizia DRAFT.
   *
   * Duas leituras do mesmo agregado em instantes diferentes dentro da mesma tela
   * é a definição de divergência. A correção é recarregar a decisão quando o
   * estado muda: o comando já commitou, e a superfície precisa refleti-lo.
   */
  const refreshWorkbench = useCallback(async () => {
    try {
      const next = await getMeasurementWorkbench(serviceOrderId);
      setWorkbench(next);
    } catch {
      // A superfície fica como está: os comandos anteriores continuam
      // desabilitados se eram, e um erro de leitura não habilita nada.
    }
  }, [serviceOrderId]);

  async function runTransition(
    action: () => Promise<MeasurementDetail>,
    successMessage: string,
  ) {
    if (state.phase !== 'ready' || !state.measurement || submitting || versionConflict) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const measurement = await action();
      setState({ ...state, measurement });
      setFeedback({ tone: 'success', message: successMessage });
      setApproveOpen(false);
      setRejectOpen(false);
      // O estado mudou: a DECISÃO publicada precisa acompanhar, senão a tela
      // mostra o novo status com os comandos do anterior.
      await refreshWorkbench();
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setFeedback({
          tone: 'error',
          message: mapMeasurementsErrorToMessage(MEASUREMENTS_ERROR_CODES.VERSION_CONFLICT, error.status),
        });
        return;
      }
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapMeasurementsErrorToMessage(error.code, error.status)
            : 'Não foi possível concluir a operação.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <ModulePage className="measurement-page">
        <ModulePageHeader title="Conferência de medição" />
        <ModuleLoadingState title="Conferência de medição" message="Carregando medição…" />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage className="measurement-page">
        <ModulePageHeader title="Conferência de medição" />
        <ModuleDeniedState
          title="Conferência de medição"
          message="Você não tem permissão para conferir medições desta ordem de serviço."
        />
      </ModulePage>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <ModulePage className="measurement-page">
        <ModulePageHeader title="Conferência de medição" />
        <p role="alert">Ordem de serviço não encontrada.</p>
      </ModulePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModulePage className="measurement-page">
        <ModulePageHeader title="Conferência de medição" />
        <ModuleErrorState
          title="Conferência de medição"
          message={state.message}
          retryable
          onRetry={() => void reload()}
        />
      </ModulePage>
    );
  }

  const { order, measurement, planned, evidencePending } = state;
  const comparisonRows = measurement
    ? buildMeasurementComparisonRows({
        items: measurement.items,
        planned,
        serviceSnapshot: order.serviceSnapshot,
        evidencePending,
      })
    : [];
  const totalAmount = sumMoneyLines(measurement?.items.map((item) => item.lineAmount) ?? []);
  const status = measurement?.status ?? MEASUREMENT_STATUSES.Draft;
  /*
   * ESTADO EM RÓTULO DE NEGÓCIO, NUNCA O ENUM.
   *
   * Esta linha passava `status` cru para o cabeçalho, e o operador lia `SUBMITTED` — o
   * identificador interno do ciclo — onde deveria ler "Submetida". O enum é contrato de
   * máquina; a tela fala a língua do negócio.
   *
   * Os rótulos são os MESMOS que `MeasurementStatusBadge` já publicava. Eles são reusados
   * aqui em vez de redesenhados: duas tabelas de tradução para o mesmo enum divergiriam.
   */
  const statusLabel = MEASUREMENT_STATUS_LABELS[status];
  const actionsBlocked = versionConflict || submitting;

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * A HABILITAÇÃO VEM DO BACKEND — NÃO DE UMA CONJUNÇÃO LOCAL
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Aqui existia:
   *
   *     const canApprove =
   *       capabilities.canApprove && measurement?.status === MEASUREMENT_STATUSES.UnderReview;
   *
   * Duas coisas erradas numa linha:
   *
   *   1. é uma REGRA de negócio em React — qual estado permite aprovar;
   *   2. ela é uma SEGUNDA implementação dessa regra, e a primeira mora no
   *      backend, que hoje também considera a VARIAÇÃO acima da tolerância.
   *
   * O resultado medido: com variação pendente, o botão aparecia HABILITADO e o
   * comando respondia 409 — o operador via a tela afirmar algo que o sistema
   * recusava.
   *
   * Agora a página lê `availableCommands` do workbench. `capabilities.*` continua
   * sendo usado para o que ele É (projeção de permissão de sessão), não para
   * compor a regra.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * NENHUMA CONDIÇÃO LOCAL É SOMADA — NEM A DE PERMISSÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `availableCommands[].enabled` já carrega TODAS as condições: estado, variação,
   * política e — inclusive — `NOT_AUTHORIZED`, que o backend publica como motivo
   * próprio quando o ator não tem a permissão.
   *
   * Somar `capabilities.canRead` aqui seria uma SEGUNDA fonte para a mesma
   * decisão, e um bloqueio silencioso enquanto o `/me` não resolve, mesmo com o
   * workbench já carregado.
   *
   * A única condição que a TELA acrescenta é de INTERFACE: enquanto um comando
   * está em voo ou há conflito de versão, nada é clicável — reenviar por cima de
   * um 409 seria last-write-wins.
   */
  const commandEnabled = (code: string): boolean =>
    workbench?.availableCommands.find((command) => command.code === code)?.enabled === true;

  const canCreate =
    capabilities.canCreate && !measurement && order.status === SERVICE_ORDER_STATUSES.Completed;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * VISIBILIDADE (backend) × HABILITAÇÃO (interface)
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * São duas perguntas DIFERENTES e misturá-las apaga justamente a informação de
   * que o operador precisa:
   *
   *   `*Visible`  o comando existe PARA ESTE ESTADO da medição?  → backend
   *   `*Enabled`  ele pode ser clicado AGORA?                     → backend E interface
   *
   * `actionsBlocked` (submissão em voo / conflito de versão) é um bloqueio de
   * INTERFACE. Aplicá-lo em `visible` faria o botão DESAPARECER num conflito —
   * e o operador leria a tela como se a decisão não existisse mais, quando o que
   * aconteceu foi uma corrida com outro usuário.
   *
   * O comportamento correto num 409 é o botão continuar VISÍVEL e
   * DESABILITADO, ao lado do banner que explica o conflito e oferece recarregar.
   */
  const canSubmitVisible = commandEnabled('SUBMIT');
  const canStartReviewVisible = commandEnabled('START_REVIEW');
  const canApproveVisible = commandEnabled('APPROVE');
  const canRejectVisible = commandEnabled('REJECT');
  const canResubmitVisible = commandEnabled('RESUBMIT');

  return (
    <EnterpriseObjectPage
      className="measurement-page gap-3"
      breadcrumb={[{ label: 'Ordens de serviço', href: '/app/service-orders' }]}
      header={
        <EnterpriseObjectHeader
          className="border-gray-200 px-5 py-4 shadow-none"
          reference={order.orderNumber}
          title={order.orderNumber}
          subtitle={order.serviceSnapshot.serviceName}
          status={{ label: statusLabel, description: 'Estado atual da medição' }}
          metadata={[{ label: 'Cliente', value: readClientLabel(order) }, { label: 'Itens', value: measurement?.items.length ?? 0 }, { label: 'Ordem', value: order.orderNumber }]}
          secondaryActions={[
            { id: 'planning', label: 'Planejamento', to: `/app/service-orders/${serviceOrderId}/planning` },
            { id: 'execution', label: 'Execução', to: `/app/service-orders/${serviceOrderId}/execution` },
            { id: 'billing', label: 'Faturamento', to: `/app/service-orders/${serviceOrderId}/billing` },
          ]}
        />
      }
      aside={
        <div className="border-l border-gray-200 pl-4">
          <ObjectPanel title="Trilha da medição" className="shadow-none">
            {measurement ? <MeasurementTimeline events={measurement.historyEvents} /> : null}
          </ObjectPanel>
        </div>
      }
    >
      <main className="space-y-6">
      <p className="m-0 text-sm font-medium text-gray-600">Conferência de medição</p>
      <nav aria-label="Atalhos da ordem de serviço" className="flex flex-wrap gap-3 text-sm">
        <Link to={`/app/service-orders/${serviceOrderId}/planning`}>Planejamento</Link>
        <Link to={`/app/service-orders/${serviceOrderId}/execution`}>Execução</Link>
        <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Faturamento</Link>
      </nav>
      {versionConflict ? <MeasurementVersionConflictBanner onReload={() => void reload()} /> : null}

      <div
        id={feedbackId}
        className={
          feedback
            ? `measurement-feedback measurement-feedback--${feedback.tone}`
            : 'measurement-sr-only'
        }
        role={feedback ? 'status' : undefined}
        aria-live="polite"
      >
        {feedback?.message}
      </div>

      {!measurement ? (
        <section className="measurement-section" aria-labelledby="measurement-empty-title">
          <h2 id="measurement-empty-title">Medição ainda não gerada</h2>
          <p className="measurement-hint">
            A medição será derivada dos registros de execução (realizado) com referência comercial
            capturada no momento da criação.
          </p>
          {order.status !== SERVICE_ORDER_STATUSES.Completed ? (
            <p className="measurement-feedback measurement-feedback--info" role="status">
              A ordem de serviço precisa estar concluída para gerar medição.
            </p>
          ) : null}
          {canCreate ? (
            <button type="button" disabled={submitting} onClick={() => void handleCreateMeasurement()}>
              Gerar medição
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <MeasurementSummaryPanel
            rows={comparisonRows}
            itemCount={measurement.items.length}
            totalAmount={totalAmount}
          />

          <section className="measurement-section" aria-labelledby="measurement-compare-title">
            <h2 id="measurement-compare-title">Planejado · Realizado · Medido</h2>
            <p className="measurement-hint measurement-legend" aria-hidden="true">
              <span className="measurement-legend__item measurement-legend__item--planned">Planejado</span>
              <span className="measurement-legend__item measurement-legend__item--actual">Realizado</span>
              <span className="measurement-legend__item measurement-legend__item--measured">Medido</span>
            </p>

            <div className="measurement-compare measurement-compare--desktop">
              <MeasurementComparisonTable rows={comparisonRows} />
            </div>
            <div className="measurement-compare measurement-compare--mobile">
              <MeasurementComparisonCards rows={comparisonRows} />
            </div>
          </section>

          <section className="measurement-section measurement-actions" aria-labelledby="measurement-actions-title">
            <h2 id="measurement-actions-title">Decisão</h2>
            <div className="measurement-actions__row">
              {canSubmitVisible ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        submitMeasurement(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Medição submetida para análise.',
                    )
                  }
                >
                  Submeter medição
                </button>
              ) : null}
              {canStartReviewVisible ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        startMeasurementReview(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Análise iniciada.',
                    )
                  }
                >
                  Iniciar análise
                </button>
              ) : null}
              {canApproveVisible ? (
                <button
                  type="button"
                  className="measurement-actions__approve"
                  disabled={actionsBlocked}
                  onClick={() => setApproveOpen(true)}
                >
                  Aprovar medição…
                </button>
              ) : null}
              {canRejectVisible ? (
                <button
                  type="button"
                  className="measurement-actions__reject"
                  disabled={actionsBlocked}
                  onClick={() => setRejectOpen(true)}
                >
                  Rejeitar…
                </button>
              ) : null}
              {canResubmitVisible ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        resubmitMeasurement(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Medição reenviada. Revise os itens antes de submeter novamente.',
                    )
                  }
                >
                  Reenviar medição
                </button>
              ) : null}
            </div>
          </section>

        </>
      )}

      {measurement && measurement.status === MEASUREMENT_STATUSES.Approved ? (
        <section className="measurement-section" aria-labelledby="measurement-billing-next">
          <h2 id="measurement-billing-next">Preparação de faturamento</h2>
          <p className="measurement-hint">
            A medição foi aprovada. A preparação do faturamento usa esta medição como referência
            comercial.
          </p>
          <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Abrir faturamento</Link>
        </section>
      ) : null}

      {measurement ? (
        <MeasurementApprovalDialog
          open={approveOpen}
          rows={comparisonRows}
          itemCount={measurement.items.length}
          totalAmount={totalAmount}
          submitting={submitting}
          onCancel={() => setApproveOpen(false)}
          onConfirm={() =>
            void runTransition(
              () =>
                approveMeasurement(serviceOrderId, measurement.id, {
                  rowVersion: measurement.rowVersion,
                }),
              'Medição aprovada.',
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={rejectOpen}
        title="Rejeitar medição"
        description="Informe o motivo da rejeição. A medição ficará registrada como rejeitada."
        confirmLabel={submitting ? 'Rejeitando…' : 'Confirmar rejeição'}
        cancelLabel="Cancelar"
        confirmDisabled={submitting || rejectReason.trim().length < 3 || versionConflict}
        onCancel={() => setRejectOpen(false)}
        onConfirm={() => {
          if (!measurement) {
            return;
          }
          void runTransition(
            () =>
              rejectMeasurement(serviceOrderId, measurement.id, {
                rowVersion: measurement.rowVersion,
                rejectionReason: rejectReason.trim(),
              }),
            'Medição rejeitada.',
          );
        }}
      >
        <label htmlFor="measurement-reject-reason">
          Motivo da rejeição
          <textarea
            id="measurement-reject-reason"
            className="measurement-textarea"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={4}
          />
        </label>
      </ConfirmDialog>
      </main>
    </EnterpriseObjectPage>
  );
}
