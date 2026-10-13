import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { listClients } from '../../clients/api/clients-api';
import {
  activateContract,
  closeContract,
  ContractsApiError,
  expireContract,
  getContract,
  updateContractDraft,
} from '../api/contracts-api';
import { CONTRACT_VERSION_CONFLICT_MESSAGE, mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractFormFields, type ClientOption } from '../components/ContractFormFields';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import { CONTRACT_STATUSES, type ContractDetail } from '../types';
import {
  buildUpdateContractDraftPayload,
  contractFormToValues,
  type ContractFormValues,
} from '../utils/contract-form-values';
import {
  formatClientSnapshot,
  formatContractDocumentLinkPurpose,
  formatContractStatus,
  contractStatusTone,
  formatDate,
  formatDateTime,
  formatMoney,
} from '../utils/contract-status-labels';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  type NextAction,
  type ObjectAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import {
  Button,
  ConfirmAction,
  Modal,
  ModulePage,
  ModulePageHeader,
  UnitScopeLabel,
  VersionConflictBanner,
} from '../../ui';

/**
 * OBJECT PAGE DO CONTRATO COMERCIAL — leitura canônica do contrato `enterprise-object`.
 *
 *   breadcrumb (Contratos -> Contrato)
 *     EnterpriseObjectHeader   número, título, cliente, estado, fatos e ações
 *     ObjectStateFlow          os estados REAIS do domínio (rascunho -> ativo -> encerrado/expirado)
 *     NextActionPanel          declarado apenas quando o próximo passo NÃO é um botão desta tela
 *     ObjectContextBlock       fatos que qualificam o contrato, em grade compacta
 *     corpo + coluna lateral   itens, documentos vinculados e histórico persistido
 *
 * Nenhuma capability é inventada, nenhuma transição é inventada e nenhum identificador técnico
 * vai para a tela: a autorização continua sendo decidida no servidor e as mesmas chamadas de API
 * seguem sendo as únicas mutações disponíveis.
 */

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: ContractDetail };

type ActionKind = 'update' | 'activate' | 'close' | 'expire';

/**
 * FLUXO REAL DE ESTADO.
 *
 * Os quatro estados do domínio e os três comandos que os produzem (`activate`, `close`,
 * `expire`) já existem no módulo. O fluxo apenas os REPRESENTA — sem transição calculada no
 * front. `expire` é alternativo a `close`: um contrato expira pela vigência ou é encerrado por
 * decisão, nunca passa por um para chegar ao outro.
 */
export function contractStateSteps(status: string): ObjectStateStep[] {
  return [
    { id: CONTRACT_STATUSES.Draft, label: formatContractStatus(CONTRACT_STATUSES.Draft) },
    { id: CONTRACT_STATUSES.Active, label: formatContractStatus(CONTRACT_STATUSES.Active) },
    status === CONTRACT_STATUSES.Expired
      ? {
          id: CONTRACT_STATUSES.Expired,
          label: formatContractStatus(CONTRACT_STATUSES.Expired),
          terminal: true,
        }
      : {
          id: CONTRACT_STATUSES.Closed,
          label: formatContractStatus(CONTRACT_STATUSES.Closed),
          terminal: true,
        },
  ];
}

export function ContractsDetailPage() {
  const { contractId = '' } = useParams();
  const { capabilities } = useContractCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [openDialog, setOpenDialog] = useState<ActionKind | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [editValues, setEditValues] = useState<ContractFormValues | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void listClients({ limit: 100, offset: 0 }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setClients(
            response.items.map((client) => ({
              id: client.id,
              label: client.tradeName || client.legalName,
            })),
          );
        }
      })
      .catch(() => setClients([]))
      .finally(() => {
        if (!controller.signal.aborted) {
          setClientsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setVersionConflict(false);
    try {
      const detail = await getContract(contractId);
      setState({ phase: 'ready', detail });
    } catch (error) {
      if (error instanceof ContractsApiError) {
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
          error instanceof ContractsApiError
            ? mapContractErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o contrato.',
      });
    }
  }, [contractId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openEditDialog() {
    if (state.phase !== 'ready') {
      return;
    }
    setEditValues(contractFormToValues(state.detail.contract));
    setActionError(null);
    setOpenDialog('update');
  }

  function closeDialog() {
    setOpenDialog(null);
    setCloseReason('');
  }

  /** Executa uma ação versionada; 409 de versão vira banner com recarga. */
  async function runAction(action: () => Promise<void>) {
    if (state.phase !== 'ready') {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    setVersionConflict(false);
    try {
      await action();
      await reload();
      setOpenDialog(null);
      setCloseReason('');
    } catch (error) {
      if (error instanceof ContractsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setOpenDialog(null);
      } else {
        setActionError(
          error instanceof ContractsApiError
            ? mapContractErrorToMessage(error.code, error.status)
            : 'Não foi possível concluir a operação.',
        );
      }
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleEditSubmit(): Promise<void> {
    if (state.phase !== 'ready' || !editValues || actionSubmitting) {
      return;
    }
    const { id, rowVersion } = state.detail.contract;
    await runAction(async () => {
      await updateContractDraft(id, buildUpdateContractDraftPayload(rowVersion, editValues));
    });
  }

  if (state.phase !== 'ready') {
    /*
     * ESTADOS DE PAGINA — resolvidos uma única vez, DENTRO da moldura compartilhada.
     * A página mantém o próprio cabeçalho enquanto carrega, nega ou falha: o operador
     * nunca perde a referência de onde está, e negação não se confunde com registro vazio.
     */
    const denied = state.phase === 'denied';
    const notFound = state.phase === 'not_found';
    const message =
      state.phase === 'error'
        ? state.message
        : denied
          ? 'Você não tem permissão para consultar este contrato.'
          : notFound
            ? 'Contrato não encontrado.'
            : null;

    return (
      <ModulePage>
        <ModulePageHeader title="Contrato" />
        <EnterpriseObjectPage
          breadcrumb={[{ label: 'Contratos', href: '/app/contracts' }, { label: 'Contrato' }]}
          phase={denied ? 'denied' : notFound ? 'empty' : state.phase === 'loading' ? 'loading' : 'error'}
          phaseTitle="Contrato"
          phaseMessage={message ?? 'Carregando contrato…'}
          onRetry={
            state.phase === 'error' || state.phase === 'loading' ? () => void reload() : undefined
          }
          header={null}
        />
      </ModulePage>
    );
  }

  const { contract, items, documentLinks } = state.detail;
  const isDraft = contract.status === CONTRACT_STATUSES.Draft;
  const isActive = contract.status === CONTRACT_STATUSES.Active;

  const canEdit = capabilities.canUpdate && isDraft;
  const canActivate = capabilities.canActivate && isDraft;
  const canClose = capabilities.canClose && isActive;
  const canExpire = capabilities.canExpire && isActive;

  /*
   * AÇÕES REAIS — cada uma existe somente quando a capability correspondente permite E o
   * estado a aceita. A ação primária é a que AVANÇA o ciclo de vida; edição de rascunho entra
   * como alternativa secundária, e nunca disputa a primeira leitura.
   */
  const availableActions: ObjectAction[] = [];
  if (canEdit) {
    availableActions.push({ id: 'edit', label: 'Editar dados', onSelect: openEditDialog });
  }
  if (canActivate) {
    availableActions.push({
      id: 'activate',
      label: 'Ativar contrato',
      onSelect: () => setOpenDialog('activate'),
    });
  }
  if (canClose) {
    availableActions.push({
      id: 'close',
      label: 'Encerrar contrato',
      onSelect: () => {
        setCloseReason('');
        setOpenDialog('close');
      },
    });
  }
  if (canExpire) {
    availableActions.push({
      id: 'expire',
      label: 'Expirar contrato',
      onSelect: () => setOpenDialog('expire'),
    });
  }

  const primaryAction: ObjectAction | null =
    availableActions.find((action) => action.id === 'activate') ??
    availableActions.find((action) => action.id === 'close') ??
    availableActions.find((action) => action.id === 'expire') ??
    availableActions.find((action) => action.id === 'edit') ??
    null;
  const secondaryActions = availableActions.filter((action) => action.id !== primaryAction?.id);

  /**
   * PRÓXIMA AÇÃO — declarada SOMENTE quando o próximo passo não é um botão desta tela.
   * Rascunho que este operador não pode ativar: o passo pertence a quem tem a capability, e a
   * tela declara a espera em vez de oferecer o que o servidor recusaria.
   */
  const nextAction: NextAction | null =
    isDraft && !canActivate
      ? {
          kind: 'waiting',
          label: 'Aguardar a ativação do contrato',
          description: 'O contrato só produz efeito depois da ativação registrada pelo servidor.',
          waitingOn: 'Perfil autorizado a ativar contratos',
        }
      : null;

  const clientName = formatClientSnapshot(contract.clientSnapshot);

  const metadata: ObjectMetadataField[] = [
    {
      label: 'Vigência',
      value: contract.validTo
        ? `${formatDate(contract.validFrom)} → ${formatDate(contract.validTo)}`
        : `Desde ${formatDate(contract.validFrom)}`,
    },
    { label: 'Moeda', value: contract.currencyCode },
    { label: 'Itens', value: items.length > 0 ? String(items.length) : null },
    { label: 'Documentos vinculados', value: documentLinks.length > 0 ? String(documentLinks.length) : null },
    { label: 'Atualizado em', value: formatDateTime(contract.updatedAt) },
  ];

  const contextFields: ObjectContextField[] = [
    ...(clientName === '—' ? [] : [{ label: 'Cliente', value: clientName }]),
    { label: 'Código interno', value: contract.internalCode },
    // O `unitId` é dado interno (em HML, um slug sintético): a tela declara o ESCOPO.
    { label: 'Unidade operacional', value: <UnitScopeLabel unitId={contract.unitId} /> },
    { label: 'Escopo', value: contract.scopeDescription },
    { label: 'Condições de pagamento', value: contract.paymentTerms },
    { label: 'Forma de pagamento', value: contract.paymentMethod },
    { label: 'Ativado em', value: contract.activatedAt ? formatDateTime(contract.activatedAt) : null },
    { label: 'Encerrado em', value: contract.closedAt ? formatDateTime(contract.closedAt) : null },
    { label: 'Motivo do encerramento', value: contract.closureReason },
    { label: 'Criado em', value: formatDateTime(contract.createdAt) },
  ];

  /*
   * HISTÓRICO — somente marcos PERSISTIDOS. O payload não guarda trilha de eventos nem ator:
   * o que existe são timestamps, e é exatamente isso que a linha do tempo mostra.
   */
  const historyFacts: ActivityFact[] = [
    { at: contract.createdAt, event: 'Contrato criado' },
    ...(contract.activatedAt ? [{ at: contract.activatedAt, event: 'Contrato ativado' }] : []),
    ...(contract.closedAt ? [{ at: contract.closedAt, event: 'Contrato encerrado' }] : []),
    { at: contract.updatedAt, event: 'Cadastro atualizado' },
  ];

  return (
    <ModulePage>
      <EnterpriseObjectPage
        breadcrumb={[{ label: 'Contratos', href: '/app/contracts' }, { label: contract.contractNumber }]}
        header={
          <EnterpriseObjectHeader
            reference={contract.internalCode}
            title={contract.contractNumber}
            subtitle={contract.title}
            status={{
              label: formatContractStatus(contract.status),
              tone: contractStatusTone(contract.status),
            }}
            metadata={metadata}
            primaryAction={primaryAction}
            secondaryActions={secondaryActions}
          />
        }
        stateFlow={
          <ObjectStateFlow
            steps={contractStateSteps(contract.status)}
            currentId={contract.status}
            title="Ciclo de vida do contrato"
          />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={historyFacts}
              title="Histórico do contrato"
              emptyMessage="Este contrato não expõe marcos persistidos."
            />
          </ObjectPanel>
        }
      >
        {versionConflict ? (
          <VersionConflictBanner
            message={CONTRACT_VERSION_CONFLICT_MESSAGE}
            onReload={() => void reload()}
          />
        ) : null}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

        <ObjectContextBlock title="Contexto do contrato" fields={contextFields} columns={3} />

        <ObjectPanel title="Itens">
          {items.length === 0 ? (
            <p className="m-0 text-sm text-gray-500">Nenhum item registrado no contrato.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Itens do contrato">
                <thead className="text-xs text-gray-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Linha
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Descrição
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Qtd.
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Preço unit.
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">{item.lineNumber}</td>
                      <td className="py-2 pr-4 text-gray-700">{item.description}</td>
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">{item.quantity ?? '—'}</td>
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">
                        {formatMoney(item.unitPrice, contract.currencyCode)}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-700 tabular-nums">
                        {formatMoney(item.lineTotal, contract.currencyCode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ObjectPanel>

        <ObjectPanel title="Documentos vinculados">
          {documentLinks.length === 0 ? (
            <p className="m-0 text-sm text-gray-500">Nenhum documento vinculado ao contrato.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-gray-700">
              {documentLinks.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-3">
                  <Link
                    to={`/app/documents/${link.documentId}`}
                    className="text-brand-700 no-underline hover:text-brand-800"
                  >
                    Documento vinculado
                  </Link>
                  <span className="text-gray-400">·</span>
                  <span>{formatContractDocumentLinkPurpose(link.linkPurpose)}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">{formatDateTime(link.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </ObjectPanel>

        <p>
          <Link to="/app/contracts">Voltar à lista</Link>
        </p>
      </EnterpriseObjectPage>

      <Modal
        open={openDialog === 'update'}
        title="Editar dados do contrato"
        description="As alterações são permitidas somente enquanto o contrato estiver em rascunho."
        onClose={() => setOpenDialog(null)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={actionSubmitting}
              onClick={() => setOpenDialog(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={actionSubmitting}
              loading={actionSubmitting}
              loadingText="Salvando"
              onClick={() => void handleEditSubmit()}
            >
              Salvar alterações
            </Button>
          </>
        }
      >
        {editValues ? (
          <ContractFormFields
            mode="edit"
            values={editValues}
            clients={clients}
            clientsLoading={clientsLoading}
            disabled={actionSubmitting}
            onChange={setEditValues}
          />
        ) : null}
      </Modal>

      <ConfirmAction
        open={openDialog === 'activate'}
        title="Ativar contrato"
        description="A ativação efetiva o contrato com base na vigência informada."
        confirmLabel="Confirmar ativação"
        loading={actionSubmitting}
        onConfirm={() => {
          void runAction(async () => {
            await activateContract(contract.id, { rowVersion: contract.rowVersion });
          });
        }}
        onCancel={closeDialog}
      />

      <ConfirmAction
        open={openDialog === 'close'}
        title="Encerrar contrato"
        description="Informe o motivo do encerramento."
        confirmLabel="Confirmar encerramento"
        confirmDisabled={!closeReason.trim()}
        loading={actionSubmitting}
        onConfirm={() => {
          void runAction(async () => {
            await closeContract(contract.id, {
              rowVersion: contract.rowVersion,
              closureReason: closeReason.trim(),
            });
          });
        }}
        onCancel={closeDialog}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contract-close-reason" className="text-xs font-semibold text-gray-700">
            Motivo do encerramento
            <span className="text-red-600" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> (obrigatório)</span>
          </label>
          <textarea
            id="contract-close-reason"
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value)}
            rows={3}
            className="block w-full min-h-[5.5rem] resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </ConfirmAction>

      <ConfirmAction
        open={openDialog === 'expire'}
        title="Expirar contrato"
        description="O backend expira o contrato quando a vigência já terminou; esta ação não exige motivo nem versão."
        confirmLabel="Confirmar expiração"
        loading={actionSubmitting}
        onConfirm={() => {
          void runAction(async () => {
            await expireContract(contract.id);
          });
        }}
        onCancel={closeDialog}
      />
    </ModulePage>
  );
}
