import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { ActionBar, DynamicBusinessChain, DynamicForm, DynamicTimeline, toDisplayText, useEntitySchema, type ChainNode } from '../../engine';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  type NextAction,
  type ObjectStateStep,
  type SmartRelation,
} from '../../enterprise-object';
import {
  serviceOrderEngineRow,
  type ServiceOrderEngineRow,
} from './service-order-engine-rows';
import { OperationsControlCenter } from '../components/OperationsControlCenter';
import type { ServiceOrderControlCenter } from '../types/service-order.types';

/**
 * Detalhe de ordem de serviço RENDERIZADO PELA ENGINE.
 *
 * Não há campo, rótulo, grupo nem ordem escritos aqui: `DynamicForm` lê a view `form` do
 * metadata store e `ActionBar` lê `meta.workflow_transitions`. Os 7 botões de ciclo de vida
 * deixaram de vir de `TRANSITIONS` (constante TypeScript) e passaram a vir do metadado —
 * a transição nova é um INSERT.
 *
 * O que permanece é APENAS o despacho do comando para as mutações que já existem no módulo:
 * a engine decide QUAIS comandos existem e QUAIS o ator pode executar; este despachante
 * decide apenas COMO cada um chega ao backend.
 */
export function ServiceOrderEngineDetailPage() {
  const { serviceOrderId } = useParams<{ serviceOrderId: string }>();
  const { schema, status } = useEntitySchema('service-orders');
  const [row, setRow] = useState<ServiceOrderEngineRow | null>(null);
  const [controlCenter, setControlCenter] = useState<ServiceOrderControlCenter | null>(null);
  const [rowStatus, setRowStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceOrderId) {
        return;
      }
      setRowStatus('loading');
      try {
        const detail = await getServiceOrder(serviceOrderId, signal);
        setRow(serviceOrderEngineRow(detail));
        /*
         * OPERATIONS CONTROL CENTER — o backend DERIVA a progressão, planejado x realizado,
         * downstream (medição/faturamento) e o próximo passo com blockers; o frontend apenas
         * renderiza o que veio autorizado. É capturado AQUI porque `serviceOrderEngineRow`
         * projeta somente os campos de trabalho da engine, e descartá-lo apagaria o passo
         * "FACTS + EXECUTION + EXCEPTIONS" da gramática de object page.
         */
        setControlCenter(detail.controlCenter ?? null);
        setRowStatus('ready');
      } catch (error) {
        if (error instanceof ServiceOrdersApiError) {
          if (error.kind === 'denied') {
            setRowStatus('denied');
            return;
          }
          if (error.kind === 'not_found') {
            setRowStatus('missing');
            return;
          }
        }
        setRowStatus('error');
      }
    },
    [serviceOrderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * Despacha o comando que a ENGINE ofereceu.
   *
   * `cancel` exige justificativa no backend (`cancellationReason`), por isso a tela informa
   * uma justificativa explícita em vez de inventar uma vazia. `start`, `pause`, `resume` e
   * `complete` pertencem à tela de execução, que tem o contexto operacional (alocações,
   * evidências) — aqui elas aparecem como indisponíveis, não como botões que falhariam.
   */
  async function runCommand(command: string): Promise<void> {
    if (!serviceOrderId || !row) {
      return;
    }
    const rowVersion = Number(row['row_version'] ?? 1);
    setBusy(true);
    setCommandError(null);
    try {
      if (command === 'prepare') {
        await prepareServiceOrder(serviceOrderId, rowVersion);
      } else if (command === 'release') {
        await releaseServiceOrder(serviceOrderId, rowVersion);
      } else if (command === 'cancel') {
        await cancelServiceOrder(serviceOrderId, {
          rowVersion,
          cancellationReason: 'Cancelamento solicitado na visão geral da ordem de serviço.',
        });
      } else {
        setCommandError(`O comando "${command}" não é executado nesta tela.`);
        return;
      }
      await load();
    } catch (error) {
      setCommandError(
        error instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(error.code, error.status)
          : 'Não foi possível executar o comando.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (rowStatus === 'loading' || status === 'loading') {
    return (
      <EnterpriseObjectPage
        phase="loading"
        phaseTitle="Ordem de serviço"
        phaseMessage="Carregando ordem de serviço…"
        header={null}
      />
    );
  }

  if (rowStatus === 'denied') {
    return (
      <EnterpriseObjectPage
        phase="denied"
        phaseTitle="Ordem de serviço"
        phaseMessage="Você não tem acesso a esta ordem de serviço."
        header={null}
      />
    );
  }

  if (rowStatus === 'missing') {
    return (
      <EnterpriseObjectPage
        phase="empty"
        phaseTitle="Ordem de serviço não encontrada"
        phaseMessage="A ordem solicitada não está disponível no seu escopo atual."
        breadcrumb={[{ label: 'Ordens de serviço', href: '/app/service-orders' }]}
        header={null}
      />
    );
  }

  if (rowStatus === 'error' || !row || !schema) {
    return (
      <EnterpriseObjectPage
        phase="error"
        phaseTitle="Ordem de serviço"
        phaseMessage="Não foi possível carregar a ordem de serviço."
        onRetry={() => void load()}
        header={null}
      />
    );
  }

  const currentState = toDisplayText(row['status']);
  const orderNumber = toDisplayText(row['order_number']);
  const client = toDisplayText(row['client_snapshot']);
  const deadline = toDisplayText(row['deadline_at']);
  const stateFlowSteps = stateStepsFromSchema(schema);
  const relations = relationsFromRow(row);
  const nextAction = nextActionFromControlCenter(controlCenter, row.id);

  /*
   * CADEIA DE NEGÓCIO — montada do que o PAYLOAD trouxe, sem chamada nova e sem inventar
   * degrau. Cada nó só existe se o vínculo correspondente veio persistido: uma OS sem pedido de
   * compra não exibe "PO", porque afirmar uma relação que não está registrada seria mentir
   * sobre a origem do dinheiro.
   *
   * A ORDEM é do domínio (solicitação → proposta → PO → OS), e é a TELA que a conhece — a
   * engine só desenha os nós na ordem em que chegam.
   */
  const chainNodes: ChainNode[] = [
    ...(toDisplayText(row['service_request_id']).trim() !== ''
      ? [{
          kind: 'Solicitação',
          id: toDisplayText(row['service_request_id']),
          businessReference: toDisplayText(row['service_request_id']),
          route: `/app/requests/${toDisplayText(row['service_request_id'])}`,
          relation: 'ORIGIN',
        }]
      : []),
    ...(toDisplayText(row['proposal_number'] ?? row['proposal_id']).trim() !== ''
      ? [{
          kind: 'Proposta',
          id: toDisplayText(row['proposal_id']),
          businessReference: toDisplayText(row['proposal_number'] ?? row['proposal_id']),
          route: `/app/proposals/${toDisplayText(row['proposal_id'])}`,
          status: toDisplayText(row['status']),
          relation: 'ORIGIN',
        }]
      : []),
    ...(toDisplayText(row['purchase_order_number'] ?? row['purchase_order_id']).trim() !== ''
      ? [{
          kind: 'Pedido de compra',
          id: toDisplayText(row['purchase_order_id']),
          businessReference: toDisplayText(
            row['purchase_order_number'] ?? row['purchase_order_id'],
          ),
          route: `/app/purchase-orders/${toDisplayText(row['purchase_order_id'])}`,
          relation: 'ORIGIN',
        }]
      : []),
    {
      kind: 'Ordem de serviço',
      id: row.id,
      businessReference: toDisplayText(row['order_number']),
      status: currentState,
      relation: 'ROOT',
    },
  ];

  return (
    <EnterpriseObjectPage
      className="service-order-object-page gap-3"
      breadcrumb={[{ label: 'Ordens de serviço', href: '/app/service-orders' }]}
      header={
        <EnterpriseObjectHeader
          className="service-order-object-header border-gray-200 px-5 py-4 shadow-none"
          reference={orderNumber}
          title={orderNumber || schema.label}
          subtitle={client}
          status={{ label: currentState, description: 'Estado atual da ordem' }}
          metadata={[
            { label: 'Cliente', value: client },
            { label: 'Unidade', value: toDisplayText(row['unit_id']) },
            { label: 'Prazo', value: deadline, emphasis: true },
          ]}
          secondaryActions={[
            { id: 'planning', label: 'Planejamento', to: `/app/service-orders/${row.id}/planning` },
            { id: 'execution', label: 'Execução', to: `/app/service-orders/${row.id}/execution` },
          ]}
        />
      }
      stateFlow={
        <ObjectStateFlow
          steps={stateFlowSteps}
          currentId={currentState}
          title="Fluxo da OS"
          className="service-order-state-flow border-gray-200 px-5 shadow-none"
        />
      }
      nextAction={
        <NextActionPanel
          action={nextAction}
          className="service-order-next-action border-gray-200 shadow-none"
        />
      }
      relations={
        relations.length > 0 ? (
          <SmartRelationBar
            relations={relations}
            className="service-order-relations border-gray-200 shadow-none"
          />
        ) : undefined
      }
      aside={
        <div className="service-order-context-rail border-l border-gray-200 pl-4">
          <ObjectPanel title="Comandos" className="service-order-command-surface shadow-none">
            <ActionBar
              schema={schema}
              currentState={currentState}
              busy={busy}
              onCommand={(command) => void runCommand(command)}
            />
            {commandError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {commandError}
              </p>
            ) : null}
          </ObjectPanel>
          <ObjectPanel title="Cadeia de negócio" className="service-order-context-panel shadow-none">
            <DynamicBusinessChain nodes={chainNodes} title="Cadeia de negócio" />
          </ObjectPanel>
          <ObjectPanel title="Histórico" className="service-order-context-panel shadow-none">
            <DynamicTimeline schema={schema} recordId={row.id} />
          </ObjectPanel>
        </div>
      }
    >
      <main className="service-order-main-canvas space-y-6">
        <section aria-label="Operação" className="service-order-operational-canvas border-b border-gray-200 pb-6">
          <div className="service-order-section-heading mb-3 flex items-end gap-3">
            <div>
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Trabalho atual</p>
              <h2 className="m-0 text-base font-semibold text-gray-900">Operação da ordem</h2>
            </div>
            <span className="mb-1 h-px flex-1 bg-gray-200" aria-hidden="true" />
          </div>
          {controlCenter ? (
            <OperationsControlCenter
              controlCenter={controlCenter}
              measurementHref={`/app/service-orders/${row.id}/measurement`}
            />
          ) : (
            <p className="m-0 text-sm text-gray-500">
              Sem controle operacional disponível para esta ordem.
            </p>
          )}
        </section>

        <section aria-label="Dados da ordem" className="service-order-record-canvas">
          <div className="service-order-section-heading mb-3 flex items-end gap-3">
            <div>
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Registro</p>
              <h2 className="m-0 text-base font-semibold text-gray-900">Dados da ordem</h2>
            </div>
            <span className="mb-1 h-px flex-1 bg-gray-200" aria-hidden="true" />
          </div>
          <DynamicForm schema={schema} values={row} readOnly />
        </section>
      </main>
    </EnterpriseObjectPage>
  );
}

function stateStepsFromSchema(schema: NonNullable<ReturnType<typeof useEntitySchema>['schema']>): ObjectStateStep[] {
  const stateField = schema.workflow?.stateField;
  const field = schema.fields.find((candidate) => candidate.name === stateField);
  const options = field?.options?.options ?? [];
  return options.map((option) => ({
    id: option.value,
    label: option.label,
    terminal: option.value === 'COMPLETED' || option.value === 'CANCELLED',
  }));
}

function relationsFromRow(row: ServiceOrderEngineRow): SmartRelation[] {
  const relations: SmartRelation[] = [];
  const serviceRequestId = toDisplayText(row['service_request_id']);
  const proposalId = toDisplayText(row['proposal_id']);
  const purchaseOrderId = toDisplayText(row['purchase_order_id']);
  if (serviceRequestId.trim() !== '') {
    relations.push({ id: 'request', label: 'Solicitação', count: 1, to: `/app/requests/${serviceRequestId}` });
  }
  if (proposalId.trim() !== '') {
    relations.push({ id: 'proposal', label: 'Proposta', count: 1, to: `/app/proposals/${proposalId}` });
  }
  if (purchaseOrderId.trim() !== '') {
    relations.push({
      id: 'purchase-order',
      label: 'Pedido de compra',
      count: 1,
      to: `/app/purchase-orders/${purchaseOrderId}`,
    });
  }
  return relations;
}

function nextActionFromControlCenter(
  controlCenter: ServiceOrderControlCenter | null,
  serviceOrderId: string,
): NextAction | null {
  if (!controlCenter) {
    return null;
  }
  const { nextAction } = controlCenter;
  if (nextAction.blockers.length > 0) {
    return {
      kind: 'waiting',
      label: nextAction.step,
      description: nextAction.blockers.join(' · '),
      waitingOn: 'Operação',
    };
  }
  if (nextAction.transition) {
    return null;
  }
  if (nextAction.step === 'PLANNING') {
    return { kind: 'act', label: 'Planejar OS', to: `/app/service-orders/${serviceOrderId}/planning` };
  }
  if (nextAction.step === 'EXECUTION') {
    return { kind: 'act', label: 'Executar OS', to: `/app/service-orders/${serviceOrderId}/execution` };
  }
  if (nextAction.step === 'MEASUREMENT') {
    return { kind: 'act', label: 'Medir OS', to: `/app/service-orders/${serviceOrderId}/measurement` };
  }
  return null;
}
