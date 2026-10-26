import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ModulePage, ModulePageHeader } from '../../ui';
import { WorkbenchFloorplan } from '../../ui/workbench-floorplan';
import { MeasurementQueue } from '../components/MeasurementQueue';
import { MeasurementKpiStrip, MeasurementQueueStrip } from '../components/MeasurementKpiStrip';
import {
  ActiveMeasurementPanel,
  MeasurementVariancePanel,
} from '../components/MeasurementWorkbenchPanels';
import {
  AcceptancePanel,
  AdjustmentsPanel,
  BillingEligibilityPanel,
  ContractPanel,
  DocumentFlowPanel,
  ExecutionBasisPanel,
  MeasurementProcessBar,
  MeasurementTimelinePanel,
  NextActionPanel,
  SituationsPanel,
} from '../components/MeasurementDecisionContext';
import {
  MeasurementAcceptanceDialog,
  MeasurementAdjustmentDialog,
  MeasurementConcurrencyBanner,
  type AcceptanceDialogMode,
} from '../components/MeasurementCommandDialogs';
import { useMeasurementCommand, useMeasurementQueue, useMeasurementWorkbench } from '../hooks/useMeasurementWorkbench';
import {
  createIdempotencyKey,
} from '../utils/create-idempotency-key';
import type { DetectedVariance } from '../types/measurement-workbench.types';

/**
 * MEASUREMENT WORKBENCH — a estação de trabalho da medição.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A PÁGINA É COMPOSIÇÃO, NÃO LÓGICA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Três colunas, seguindo o floorplan que o produto já usa em outras estações:
 *
 *   FILA          o que exige ação (WorkQueueItem, ordenado pelo backend)
 *   MEDIÇÃO ATIVA o objeto em decisão (três verdades + itens + variações)
 *   CONTEXTO      por que, qual o impacto, o que fazer, o que posso fazer
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA PÁGINA **NÃO** DECIDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   ✗ se a aprovação está liberada        → availableCommands[APPROVE].enabled
 *   ✗ se o aceite é exigível              → acceptance.required (política)
 *   ✗ se o faturamento está liberado      → billingEligibility.result
 *   ✗ qual é o próximo passo              → nextAction
 *   ✗ se a variação está dentro da tolerância → variance.severity / requiresDecision
 *   ✗ qual é o ciclo do aceite            → acceptance.latest.cycleNumber
 *
 * A página reage a esses fatos e apresenta. É a única forma de a tela e o
 * comando não divergirem.
 */
export function MeasurementWorkbenchPage() {
  const { serviceOrderId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedServiceOrderId = serviceOrderId || searchParams.get('serviceOrderId') || '';

  /**
   * UNIDADE — vem da URL porque a fila é escopada por unidade.
   *
   * O backend recusa a fila sem unidade: sem escopo operacional não há projeção
   * a devolver. A página não inventa uma unidade padrão.
   */
  const unitId = searchParams.get('unitId') ?? '';

  const queue = useMeasurementQueue(unitId, { limit: 100 });
  const workbench = useMeasurementWorkbench(selectedServiceOrderId);
  const command = useMeasurementCommand();

  const [acceptanceDialog, setAcceptanceDialog] = useState<AcceptanceDialogMode | null>(null);
  const [adjustmentVariance, setAdjustmentVariance] = useState<DetectedVariance | null>(null);
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  /**
   * CHAVE DE IDEMPOTÊNCIA POR DIÁLOGO ABERTO.
   *
   * Criada quando o operador ABRE o diálogo e mantida enquanto ele estiver
   * aberto: um retry do MESMO comando reenvia a MESMA chave, e o backend
   * devolve o mesmo resultado sem segundo efeito.
   *
   * Reabrir o diálogo gera outra chave — porque aí é outra decisão.
   */
  const [acceptanceKey, setAcceptanceKey] = useState<string>('');

  const openAcceptance = useCallback((mode: AcceptanceDialogMode) => {
    setAcceptanceKey(createIdempotencyKey());
    setFeedback(null);
    setAcceptanceDialog(mode);
  }, []);

  /**
   * O AJUSTE NÃO TEM CHAVE AQUI, PORQUE NÃO É ENVIADO DAQUI.
   *
   * O comando de ajuste pertence à superfície de medição existente, com o MESMO
   * contrato de autoridade (`expectedVersion` + `idempotencyKey` + motivo). Esta
   * estação apresenta o desvio, o impacto e a recomendação, e encaminha a
   * decisão para lá.
   *
   * Criar uma segunda chave de idempotência aqui sugeriria um segundo ponto de
   * envio para a MESMA decisão — e duas portas para um comando é como o efeito
   * duplicado passa a ser possível.
   */
  const openAdjustment = useCallback((variance: DetectedVariance) => {
    setFeedback(null);
    setAdjustmentVariance(variance);
  }, []);

  const selectQueueItem = useCallback(
    (item: { serviceOrderId: string }) => {
      const next = new URLSearchParams(searchParams);
      next.set('serviceOrderId', item.serviceOrderId);
      setSearchParams(next, { replace: true });
      setConflict(false);
      setFeedback(null);
    },
    [searchParams, setSearchParams],
  );

  const reload = useCallback(() => {
    setConflict(false);
    setFeedback(null);
    void workbench.refresh();
    void queue.refresh();
  }, [workbench, queue]);

  const submitAcceptance = useCallback(
    async (input: {
      observation: string;
      rejectionReason: string | null;
      customerSignerName: string | null;
    }) => {
      if (workbench.state.phase !== 'ready' || acceptanceDialog === null) {
        return;
      }
      const data = workbench.state.data;
      if (!data.identity.measurementId || data.identity.rowVersion === null) {
        return;
      }

      const outcome = await command.runRecordAcceptance(
        data.identity.serviceOrderId,
        data.identity.measurementId,
        {
          // `expectedVersion` é a versão que o operador está VENDO.
          expectedVersion: data.identity.rowVersion,
          idempotencyKey: acceptanceKey,
          result: acceptanceDialog === 'accept' ? 'ACCEPTED' : 'REJECTED',
          observation: input.observation,
          rejectionReason: input.rejectionReason,
          customerSignerName: input.customerSignerName,
        },
      );

      if (outcome.kind === 'success') {
        // O READ MODEL INTEIRO é trocado pelo que o backend recompôs — com a
        // elegibilidade REAVALIADA na mesma transação. Nenhum campo é mutado.
        workbench.replace(outcome.data);
        setAcceptanceDialog(null);
        setFeedback({
          tone: 'success',
          message:
            acceptanceDialog === 'accept'
              ? 'Aceite do cliente registrado.'
              : 'Recusa do cliente registrada.',
        });
        // A fila mudou de estágio: recarrega para refletir a nova projeção.
        void queue.refresh();
        return;
      }

      if (outcome.kind === 'conflict') {
        setConflict(true);
        setAcceptanceDialog(null);
        return;
      }

      setFeedback({
        tone: 'error',
        message: outcome.kind === 'denied' ? 'Sem permissão para registrar aceite.' : outcome.message,
      });
    },
    [acceptanceDialog, acceptanceKey, command, queue, workbench],
  );

  const kpiAndWork = useMemo(() => {
    if (workbench.state.phase !== 'ready') {
      return null;
    }
    return workbench.state.data;
  }, [workbench.state]);

  const queueData = queue.state.phase === 'ready' ? queue.state.data : null;

  return (
    <ModulePage className="measurement-workbench">
      <ModulePageHeader title="Conferência de medição" />

      <MeasurementConcurrencyBanner
        open={conflict}
        expectedVersion={kpiAndWork?.identity.rowVersion ?? null}
        submitting={command.submitting}
        onReload={reload}
      />

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={
            feedback.tone === 'success'
              ? 'mb-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900'
              : 'mb-2 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900'
          }
        >
          {feedback.message}
        </div>
      ) : null}

      {kpiAndWork ? <MeasurementKpiStrip workbench={kpiAndWork} /> : null}

      {!unitId ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Informe a unidade (<code>unitId</code>) para carregar a fila de trabalho desta operação.
        </p>
      ) : null}

      <WorkbenchFloorplan
        queueLabel="Fila de trabalho da medição"
        activeLabel="Medição ativa"
        contextLabel="Contexto da decisão"
        queue={
          <div>
            {queueData ? (
              <MeasurementQueueStrip counts={queueData.counts} total={queueData.items.length} />
            ) : null}
            {queue.state.phase === 'loading' ? (
              <p className="text-xs text-gray-500">Carregando fila…</p>
            ) : queue.state.phase === 'denied' ? (
              <p className="text-xs text-gray-600">Sem acesso à fila desta unidade.</p>
            ) : queue.state.phase === 'error' ? (
              <p className="text-xs text-red-700">Não foi possível carregar a fila.</p>
            ) : queueData ? (
              <MeasurementQueue
                items={queueData.items}
                selectedServiceOrderId={selectedServiceOrderId}
                onSelect={selectQueueItem}
                refreshing={queue.refreshing}
              />
            ) : null}
          </div>
        }
        active={
          <div>
            {workbench.state.phase === 'idle' ? (
              <p className="text-xs text-gray-600">
                Selecione uma ordem da fila para abrir a conferência de medição.
              </p>
            ) : workbench.state.phase === 'loading' ? (
              <p className="text-xs text-gray-500">Carregando medição…</p>
            ) : workbench.state.phase === 'denied' ? (
              <p className="text-xs text-gray-600">
                Você não tem permissão para conferir medições desta ordem.
              </p>
            ) : workbench.state.phase === 'not_found' ? (
              <p className="text-xs text-gray-600">Ordem de serviço não encontrada.</p>
            ) : workbench.state.phase === 'error' ? (
              <p className="text-xs text-red-700">Não foi possível carregar a medição.</p>
            ) : (
              <div className="space-y-2">
                <ActiveMeasurementPanel workbench={workbench.state.data} />
                <MeasurementVariancePanel variances={workbench.state.data.variances} />
              </div>
            )}
          </div>
        }
        context={
          kpiAndWork ? (
            <div>
              <NextActionPanel
                nextAction={kpiAndWork.nextAction}
                commands={kpiAndWork.availableCommands}
                submitting={command.submitting}
                onExecute={(code) => {
                  if (code === 'RECORD_ACCEPTANCE') {
                    openAcceptance('accept');
                    return;
                  }
                  if (code === 'AUTHORIZE_ADJUSTMENT') {
                    const variance = kpiAndWork.variances.find(
                      (item) => item.requiresDecision && item.blockingReason !== null,
                    );
                    if (variance) {
                      openAdjustment(variance);
                    }
                    return;
                  }
                  /*
                   * DEMAIS COMANDOS NÃO SÃO EXECUTADOS AQUI.
                   *
                   * Aprovar, submeter e preparar faturamento têm superfícies
                   * próprias nesta vertical. A tela não simula o efeito: ela
                   * declara a próxima ação e deixa o comando real acontecer
                   * onde ele já existe, com a mesma autoridade.
                   */
                  setFeedback({
                    tone: 'success',
                    message:
                      'Este comando é executado na superfície própria dele; o estado acima reflete a decisão vigente.',
                  });
                }}
              />

              <AcceptancePanel
                workbench={kpiAndWork}
                commands={kpiAndWork.availableCommands}
                onRecordAcceptance={() => openAcceptance('accept')}
                onRecordRejection={() => openAcceptance('reject')}
              />

              <BillingEligibilityPanel decision={kpiAndWork.billingEligibility} />
              <SituationsPanel situations={kpiAndWork.situations} />
              <ContractPanel workbench={kpiAndWork} />
              <ExecutionBasisPanel workbench={kpiAndWork} />
              <AdjustmentsPanel workbench={kpiAndWork} />
              <MeasurementProcessBar workbench={kpiAndWork} />
              <DocumentFlowPanel steps={kpiAndWork.documentFlow} />
              <MeasurementTimelinePanel events={kpiAndWork.timeline} />
            </div>
          ) : null
        }
      />

      {kpiAndWork ? (
        <>
          <MeasurementAcceptanceDialog
            open={acceptanceDialog !== null}
            mode={acceptanceDialog ?? 'accept'}
            workbench={kpiAndWork}
            submitting={command.submitting}
            errorMessage={feedback?.tone === 'error' ? feedback.message : null}
            onCancel={() => setAcceptanceDialog(null)}
            onConfirm={(input) => void submitAcceptance(input)}
          />
          <MeasurementAdjustmentDialog
            open={adjustmentVariance !== null}
            variance={adjustmentVariance}
            workbench={kpiAndWork}
            submitting={command.submitting}
            errorMessage={feedback?.tone === 'error' ? feedback.message : null}
            onCancel={() => setAdjustmentVariance(null)}
            onConfirm={() => {
              /*
               * O AJUSTE NÃO É ENVIADO DAQUI.
               *
               * O comando de ajuste vive na superfície de medição existente, com
               * o MESMO contrato de autoridade. Esta vertical declara o impacto
               * e o motivo; enviar um segundo caminho criaria duas portas para a
               * mesma decisão — e o backend tem uma só.
               */
              setAdjustmentVariance(null);
              setFeedback({
                tone: 'success',
                message:
                  'Decisão de ajuste preparada. Ela é registrada pelo comando de ajuste da medição, que reavalia a elegibilidade.',
              });
            }}
          />
        </>
      ) : null}
    </ModulePage>
  );
}

