import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { ActionBar, DynamicForm, DynamicTimeline, toDisplayText, useEntitySchema } from '../../engine';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  UnavailableCapability,
  type NextAction,
  type ObjectContextField,
  type ObjectStateStep,
  type SmartRelation,
} from '../../enterprise-object';
import { ConfirmAction, Money } from '../../ui';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import {
  serviceOrderEngineRow,
  type ServiceOrderEngineRow,
} from './service-order-engine-rows';
import { OperationsControlCenter } from '../components/OperationsControlCenter';
import { ServiceOrderCostToServePanel } from '../components/ServiceOrderCostToServePanel';
import type { ServiceOrderControlCenter, ServiceOrderDetail } from '../types/service-order.types';

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
  /**
   * DETALHE CANÔNICO — guardado inteiro, e não só a projeção da engine.
   *
   * `serviceOrderEngineRow` projeta os campos de trabalho do metadata store; ele DESCARTA
   * `contractSnapshot`, `purchaseOrderSnapshot`, `serviceSnapshot`, `origin` e os instantes
   * persistidos. A coluna de contexto da OS 360 precisa exatamente desses fatos para dizer de onde a
   * ordem veio e sob qual contrato ela corre — então o payload autorizado é preservado aqui.
   */
  const [detail, setDetail] = useState<ServiceOrderDetail | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rowStatus, setRowStatus] = useState<'loading' | 'ready' | 'denied' | 'missing' | 'error'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  // Fetch the authorized, persisted lineage only after the OS itself is readable.
  const businessChain = useBusinessChain(
    'SERVICE_ORDER',
    rowStatus === 'ready' ? serviceOrderId ?? '' : '',
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceOrderId) {
        return;
      }
      setRowStatus('loading');
      try {
        const detail = await getServiceOrder(serviceOrderId, signal);
        setRow(serviceOrderEngineRow(detail));
        setDetail(detail);
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
   * `start`, `pause`, `resume` e `complete` pertencem à tela de execução, que tem o contexto
   * operacional (alocações, evidências) — aqui elas aparecem como indisponíveis, não como botões
   * que falhariam.
   *
   * CANCELAMENTO EXIGE MOTIVO, E O MOTIVO É DO OPERADOR.
   *
   * Antes esta tela enviava `cancellationReason: 'Cancelamento solicitado na visão geral da ordem de
   * serviço.'` — uma justificativa INVENTADA pelo frontend para satisfazer a validação do servidor.
   * O backend exige o motivo porque ele é registro de auditoria: quem cancelou, e por quê. Gravar
   * uma frase fixa produzia um histórico de cancelamento sem razão real, e o operador não tinha como
   * corrigi-lo depois. Agora o comando ABRE o diálogo, e o motivo digitado é o que vai ao servidor.
   */
  async function runCommand(command: string, reason?: string): Promise<void> {
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
        const cancellationReason = (reason ?? '').trim();
        if (cancellationReason.length === 0) {
          setCommandError('Informe o motivo do cancelamento: ele é registrado na auditoria da ordem.');
          return;
        }
        await cancelServiceOrder(serviceOrderId, { rowVersion, cancellationReason });
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
  const relations = relationsFromRow(row, detail);
  const nextAction = nextActionFromControlCenter(controlCenter, row.id);

  /*
   * IDENTIDADE — o que a ordem É, antes de como ela está.
   * `origin` é o token persistido da origem da demanda e `internalCode` é o código interno: os dois
   * vêm do payload e nenhum é derivado na tela.
   */
  const identityFields: ObjectContextField[] = [
    { label: 'Número da OS', value: detail?.orderNumber ?? orderNumber },
    { label: 'Código interno', value: detail?.internalCode ?? null },
    { label: 'Cliente', value: client },
    { label: 'Unidade operacional', value: detail?.unitId ?? toDisplayText(row['unit_id']) },
    { label: 'Situação', value: currentState },
    { label: 'Origem', value: detail?.origin ?? null },
  ];

  /*
   * ORIGEM E VÍNCULOS — de onde a ordem veio e sob qual contrato ela corre.
   *
   * Cada linha só existe quando o vínculo veio PERSISTIDO. `contractReference` é o rótulo humano do
   * contrato; quando ele não veio, o degrau não aparece — afirmar um contrato que não está registrado
   * seria mentir sobre a origem do dinheiro.
   */
  const originFields: ObjectContextField[] = [
    { label: 'Contrato', value: detail?.contractId ? (
      <Link className="text-brand-700 no-underline hover:underline" to={`/app/contracts/${detail.contractId}`}>
        {detail.contractReference || 'Abrir contrato vinculado'}
      </Link>
    ) : detail?.contractReference ?? null },
    {
      label: 'Solicitação',
      value: detail?.serviceRequestId ? 'Vinculada à ordem' : null,
    },
    {
      label: 'Proposta',
      value: snapshotText(detail?.proposalSnapshot, 'proposalNumber'),
    },
    {
      label: 'Pedido de compra',
      value: snapshotText(detail?.purchaseOrderSnapshot, 'poNumber'),
    },
    { label: 'Descrição', value: detail?.description ?? null },
  ];

  /*
   * DOWNSTREAM REAL — medição e faturamento, do control center DERIVADO pelo backend.
   *
   * O contador e o valor são do servidor; a tela não soma nada. Quando o ator não tem autorização no
   * módulo dono, o backend devolve o bloco zerado/nulo — e é por isso que a leitura abaixo só afirma
   * o que existe (`count > 0`), em vez de exibir zero como se fosse fato.
   */
  const measurementDownstream = controlCenter?.downstream.measurement ?? null;
  const billingDownstream = controlCenter?.downstream.billing ?? null;

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
            { label: 'Versão', value: detail?.rowVersion === undefined ? null : String(detail.rowVersion) },
            { label: 'Contrato', value: detail?.contractReference ?? null },
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
              availableCommands={controlCenter?.nextAction.availableTransitions}
              busy={busy}
              onCommand={(command) =>
                /*
                 * CANCELAMENTO ABRE DIÁLOGO — o motivo é do OPERADOR, não do frontend.
                 * Ver o comentário de `runCommand`: a frase fixa que existia aqui virou registro de
                 * auditoria sem razão real. Os demais comandos seguem diretos, porque não exigem
                 * justificativa no contrato do servidor.
                 */
                command === 'cancel' ? setCancelOpen(true) : void runCommand(command)
              }
            />
            {commandError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {commandError}
              </p>
            ) : null}
          </ObjectPanel>
          <BusinessChain
            chain={businessChain.chain}
            phase={businessChain.phase}
            message={businessChain.message}
            onRetry={businessChain.retry}
            title="Cadeia empresarial da OS"
          />
          <ObjectPanel title="Histórico" className="service-order-context-panel shadow-none">
            <DynamicTimeline schema={schema} recordId={row.id} />
          </ObjectPanel>
        </div>
      }
    >
      <main className="service-order-main-canvas space-y-6">
        {/*
          IDENTIDADE E ORIGEM — a leitura que situa a OS.

          A OS 360 abria pela operação e pelos campos da engine; o operador tinha de reconstruir de
          cabeça de onde a ordem veio e sob qual contrato ela corre. Estes dois blocos trazem os fatos
          que o DETALHE já publicava (`origin`, `contractReference`, `contractSnapshot`, `unitId`) e
          que a projeção da engine descartava.
        */}
        <ObjectContextBlock title="Identidade da ordem" fields={identityFields} columns={3} />
        <ObjectContextBlock title="Origem e vínculos" fields={originFields} columns={3} />
        <ServiceOrderCostToServePanel serviceOrderId={row.id} />

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

        {/*
          DOWNSTREAM — medição e faturamento como CONSEQUÊNCIA da ordem.
          A OS produz medição, e a medição produz faturamento. Sem esta seção o operador lia a ordem
          como um fim em si; com ela, a cadeia que continua depois da execução fica na própria ficha.
          Todos os números são do control center do SERVIDOR.
        */}
        <section aria-label="Desdobramento" className="service-order-record-canvas">
          <div className="service-order-section-heading mb-3 flex items-end gap-3">
            <div>
              <p className="m-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Depois da execução</p>
              <h2 className="m-0 text-base font-semibold text-gray-900">Medição e faturamento</h2>
            </div>
            <span className="mb-1 h-px flex-1 bg-gray-200" aria-hidden="true" />
          </div>
          {controlCenter ? (
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
              <div className="min-w-0">
                <dt className="cisne-meta-label">Medições</dt>
                <dd className="m-0 text-sm text-gray-900">
                  {measurementDownstream && measurementDownstream.count > 0 ? (
                    <>
                      {measurementDownstream.count}{' '}
                      {measurementDownstream.count === 1 ? 'medição' : 'mediações'}
                      {measurementDownstream.status ? ` · ${measurementDownstream.status}` : ''}{' '}
                      <Link
                        to={`/app/service-orders/${row.id}/measurement`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Abrir medição
                      </Link>
                    </>
                  ) : (
                    <span className="text-gray-600">Nenhuma medição registrada nesta ordem.</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="cisne-meta-label">Faturamento</dt>
                <dd className="m-0 text-sm text-gray-900">
                  {billingDownstream && billingDownstream.count > 0 ? (
                    <>
                      {billingDownstream.count}{' '}
                      {billingDownstream.count === 1 ? 'documento' : 'documentos'}
                      {billingDownstream.status ? ` · ${billingDownstream.status}` : ''}
                      {billingDownstream.totalAmount && billingDownstream.currencyCode ? (
                        <>
                          {' · '}
                          <Money
                            value={billingDownstream.totalAmount}
                            currencyCode={billingDownstream.currencyCode}
                          />
                        </>
                      ) : null}{' '}
                      <Link
                        to={`/app/service-orders/${row.id}/billing`}
                        className="text-brand-700 no-underline hover:underline"
                      >
                        Abrir faturamento
                      </Link>
                    </>
                  ) : (
                    <span className="text-gray-600">Nenhum faturamento registrado nesta ordem.</span>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="m-0 text-sm text-gray-600">
              O desdobramento não foi publicado para esta ordem nesta leitura.
            </p>
          )}
        </section>

        {/*
          PROFUNDIDADE NÃO PUBLICADA — declarada, nunca inventada.

          O detalhe da OS publica identidade, origem, contrato (referência e snapshot), serviço
          congelado, instantes do ciclo, histórico e o control center derivado. Não publica responsável
          nominal, documentos anexos nem uma lista de medições — só a CONTAGEM derivada. Declarar cada
          camada impede que o operador conclua "esta OS não tem documento".
        */}
        <section aria-label="Profundidade não publicada" className="service-order-record-canvas">
          <div className="flex flex-col gap-2">
            <UnavailableCapability
              title="Responsável nominal pela ordem"
              reason="O detalhe não publica o responsável. Quem executa são os recursos ALOCADOS, e a leitura nominal vive no planejamento da ordem."
            >
              <Link
                to={`/app/service-orders/${row.id}/planning`}
                className="text-brand-700 no-underline hover:underline"
              >
                Abrir planejamento
              </Link>
            </UnavailableCapability>
            <UnavailableCapability
              title="Documentos da ordem"
              reason="O detalhe da ordem de serviço não publica vínculos de documento. Evidências de execução vivem na tela de execução, e o acervo documental é do módulo de documentos."
            >
              <Link to="/app/documents" className="text-brand-700 no-underline hover:underline">
                Abrir documentos
              </Link>
            </UnavailableCapability>
          </div>
        </section>
      </main>

      {/*
        DIÁLOGO DE CANCELAMENTO — o motivo é registro de AUDITORIA.
        O backend exige `cancellationReason` porque ele grava quem cancelou e por quê. A tela anterior
        enviava uma frase fixa para satisfazer a validação, o que produzia histórico de cancelamento
        sem razão real. Aqui o operador digita o motivo, e ele é obrigatório para confirmar.
      */}
      <ConfirmAction
        open={cancelOpen}
        title="Cancelar ordem de serviço"
        description="O cancelamento encerra a ordem e é registrado na auditoria. Informe o motivo real: ele fica no histórico da OS."
        confirmLabel="Confirmar cancelamento"
        confirmDisabled={busy || cancelReason.trim().length === 0}
        loading={busy}
        onConfirm={() => {
          void runCommand('cancel', cancelReason).then(() => {
            setCancelOpen(false);
            setCancelReason('');
          });
        }}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="service-order-cancel-reason" className="text-xs font-semibold text-gray-700">
            Motivo do cancelamento
            <span className="text-red-600" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> (obrigatório)</span>
          </label>
          <textarea
            id="service-order-cancel-reason"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
            className="block w-full min-h-[5.5rem] resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </ConfirmAction>
    </EnterpriseObjectPage>
  );
}

/**
 * RÓTULO HUMANO DE UM SNAPSHOT.
 *
 * Os snapshots (`proposalSnapshot`, `purchaseOrderSnapshot`) são `Record<string, unknown>` sem chave
 * publicada. Lemos apenas os rótulos que o domínio usa e NÃO imprimimos nada quando nenhum existe —
 * um snapshot cru com chaves internas na tela seria pior que a ausência de rótulo.
 */
function snapshotText(snapshot: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = snapshot?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function relationsFromRow(row: ServiceOrderEngineRow, detail: ServiceOrderDetail | null): SmartRelation[] {
  const relations: SmartRelation[] = [];
  if (detail?.clientId) {
    relations.push({ id: 'client', label: 'Cliente', count: 1, to: `/app/clients/${detail.clientId}` });
  }
  if (detail?.contractId) {
    relations.push({ id: 'contract', label: 'Contrato', count: 1, to: `/app/contracts/${detail.contractId}` });
  }
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
