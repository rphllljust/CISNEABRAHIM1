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
import { ContractServiceOrdersPanel } from '../components/ContractServiceOrdersPanel';
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
  SmartRelationBar,
  UnavailableCapability,
  buildAuthorizedRelations,
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
 * EFEITO REAL DE CADA COMANDO — o que muda quando o operador confirma.
 *
 * Um botao de ciclo de vida sem a consequencia declarada obriga o operador a adivinhar. O texto e do
 * DOMINIO (o que o comando faz de fato), nao uma promessa de interface.
 */
const CONTRACT_COMMAND_EFFECT: Record<string, string> = {
  edit: 'Altera os dados enquanto o contrato ainda é rascunho.',
  activate: 'O contrato passa a produzir efeito a partir da vigência informada.',
  close: 'Encerra o contrato e exige motivo registrado.',
  expire: 'Registra a expiração pela vigência já terminada.',
};

/**
 * PERCENTUAL EM ESCALA DO DOMÍNIO -> TEXTO HUMANO.
 *
 * `commercialTerms.adjustments[].percent` é string em escala 4 onde `5.0000` significa 5%
 * (`parseContractCommercialTerms` no servidor). A conversão é de APRESENTAÇÃO e não altera o dado:
 * o valor cru continua intacto no payload e é ele que o servidor usa no cálculo.
 */
function formatPercent(percent: string): string {
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return percent;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(numeric)}%`;
}

/**
 * RÓTULO HUMANO DO ITEM DE CATÁLOGO.
 *
 * O item guarda `serviceSnapshot` (o serviço CONGELADO no momento da contratação). O snapshot é um
 * `Record<string, unknown>` sem contrato publicado de chaves, então lemos apenas os rótulos que o
 * próprio domínio usa (`name`, `code`, `label`) e NÃO imprimimos nada quando nenhum existe — um
 * snapshot cru com chaves internas na tela seria pior que a ausência de rótulo.
 */
function catalogLabel(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) {
    return null;
  }
  for (const key of ['name', 'label', 'code']) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

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

  /*
   * TERMOS COMERCIAIS — REAJUSTES E LIMITES, lidos de `commercialTerms`.
   *
   * O contrato GRAVA `commercial_terms` (jsonb) com dois blocos tipados e versionados
   * (`parseContractCommercialTerms` no dominio): `adjustments` — a trilha de reajuste, com data
   * efetiva, percentual e indice — e `limits` — o teto contratado e se o estouro e permitido.
   *
   * Isto e leitura de CONTRATO, nao decoracao: um operador que registra medicao precisa saber qual
   * percentual ja incidiu sobre o preco unitario e se o consumo esta dentro do teto. A tela anterior
   * publicava apenas Moeda, Itens e Documentos, entao a informacao existia no payload e nao aparecia.
   *
   * O parse e TOLERANTE e local, com as MESMAS regras do servidor (data YYYY-MM-DD, percentual
   * numerico nao-zero, valor monetario normalizado): campo ausente ou invalido e DESCARTADO, nunca
   * exibido cru. Nada aqui e recalculado — nem o preco reajustado, nem o saldo do limite.
   */
  const commercialAdjustments = Array.isArray(contract.commercialTerms['adjustments'])
    ? (contract.commercialTerms['adjustments'] as unknown[]).filter(
        (entry): entry is { effectiveOn: string; percent: string; indexCode?: string } =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as { effectiveOn?: unknown }).effectiveOn === 'string' &&
          typeof (entry as { percent?: unknown }).percent === 'string',
      )
    : [];

  const commercialLimits =
    contract.commercialTerms['limits'] &&
    typeof contract.commercialTerms['limits'] === 'object'
      ? (contract.commercialTerms['limits'] as {
          maxTotalAmount?: string;
          allowOverrun?: boolean;
        })
      : null;

  /*
   * RELACAO CROSS-DOMAIN COMPROVADA PELO CONTRATO.
   *
   * `clientId` faz parte do payload canonico de Contract. NAO inferimos proposta, solicitacao, pedido
   * ou OS: esses vinculos nao existem neste contrato de leitura e, portanto, nao aparecem.
   *
   * E importante ser explicito sobre POR QUE as OS nao entram: `so.service_orders` PERSISTE
   * `contract_id` (o fato existe no banco), mas a listagem de OS NAO publica `contractId` como
   * parametro — a allow-list de `SERVICE_ORDER_FILTER_SPECS` nao o inclui, e o endpoint nao o aceita.
   * Filtrar por cliente e apresentar o resultado como "OS deste contrato" seria afirmar um vinculo
   * que a leitura nao sustenta. A camada e declarada indisponivel abaixo, nomeando exatamente isso.
   */
  const relations = buildAuthorizedRelations([
    {
      id: 'contract-client',
      label: 'Cliente',
      count: 1,
      to: `/app/clients/${contract.clientId}`,
      allowed: Boolean(contract.clientId),
    },
    {
      id: 'contract-items',
      label: 'Itens',
      count: items.length,
      to: '#itens-contratuais',
      allowed: items.length > 0,
    },
    {
      id: 'contract-documents',
      label: 'Documentos',
      count: documentLinks.length,
      to: '#documentos-vinculados',
      allowed: documentLinks.length > 0,
    },
  ]);

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

  /*
   * CONTEXTO — separado por CAMADA, nao em uma lista unica.
   *
   * A grade unica de contexto misturava identificacao, vigencia, pagamento e encerramento no mesmo
   * plano: o operador lia dez pares rotulo/valor sem hierarquia. Agora sao tres blocos nomeados, na
   * ordem das perguntas — QUEM (identidade), QUANTO TEMPO (vigencia), COMO SE PAGA (comercial) — mais
   * o bloco de encerramento, que so existe quando o contrato saiu de circulacao.
   */
  const identityFields: ObjectContextField[] = [
    ...(clientName === '—' ? [] : [{ label: 'Cliente', value: clientName }]),
    { label: 'Código interno', value: contract.internalCode },
    { label: 'Número', value: contract.contractNumber },
    { label: 'Título', value: contract.title },
    // O `unitId` é dado interno (em HML, um slug sintético): a tela declara o ESCOPO.
    { label: 'Unidade operacional', value: <UnitScopeLabel unitId={contract.unitId} /> },
  ];

  const validityFields: ObjectContextField[] = [
    { label: 'Início da vigência', value: formatDate(contract.validFrom) },
    {
      label: 'Fim da vigência',
      value: contract.validTo ? formatDate(contract.validTo) : 'Sem término definido',
    },
    { label: 'Situação', value: formatContractStatus(contract.status) },
    { label: 'Ativado em', value: contract.activatedAt ? formatDateTime(contract.activatedAt) : null },
  ];

  const commercialFields: ObjectContextField[] = [
    { label: 'Escopo', value: contract.scopeDescription },
    { label: 'Condições de pagamento', value: contract.paymentTerms },
    { label: 'Forma de pagamento', value: contract.paymentMethod },
    {
      label: 'Limite contratado',
      value: commercialLimits?.maxTotalAmount
        ? formatMoney(commercialLimits.maxTotalAmount, contract.currencyCode)
        : null,
    },
    {
      label: 'Estouro de limite',
      value:
        commercialLimits?.allowOverrun === undefined
          ? null
          : commercialLimits.allowOverrun
            ? 'Permitido'
            : 'Não permitido',
    },
  ];

  const closureFields: ObjectContextField[] = [
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

  /**
   * TOTAL CONTRATADO — soma das LINHAS publicadas, e declarada como tal.
   *
   * Isto NAO e o valor do contrato no dominio: e a soma das linhas que o payload trouxe. A soma roda
   * em CENTAVOS INTEIROS para nao introduzir erro de ponto flutuante em dinheiro, e a nota ao lado do
   * numero diz de onde ele vem. Quando nao ha linha com total publicado, o valor e `null` — nao zero.
   */
  const lineTotals = items
    .map((item) => item.lineTotal)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const contractedTotal =
    lineTotals.length === 0
      ? null
      : (lineTotals.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100).toFixed(2);

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
        relations={<SmartRelationBar relations={relations} />}
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

        <ObjectContextBlock title="Identidade" fields={identityFields} columns={3} />
        <ObjectContextBlock title="Vigência e situação" fields={validityFields} columns={3} />
        <ObjectContextBlock title="Contexto comercial" fields={commercialFields} columns={3} />
        {contract.closedAt || contract.closureReason ? (
          <ObjectContextBlock title="Encerramento" fields={closureFields} columns={3} />
        ) : null}

        {/*
          COMANDOS SEMÂNTICOS — os comandos de ciclo de vida do contrato, com o efeito declarado.

          Um ERP nao oferece "mudar status": ele oferece a TRANSICAO, e o operador precisa saber o que
          ela faz antes de confirmar. Aqui cada comando disponivel aparece com a consequencia real
          ("passa a produzir efeito", "encerra e exige motivo"), e quando nao ha comando o bloco diz
          por que — porque a ausencia de botao e uma informacao de processo, nao um vazio.
        */}
        <ObjectPanel title="Comandos disponíveis">
          {availableActions.length === 0 ? (
            <p className="m-0 text-sm text-gray-600">
              {contract.status === CONTRACT_STATUSES.Closed
                ? 'Contrato encerrado: o ciclo de vida terminou e não há comando de transição.'
                : contract.status === CONTRACT_STATUSES.Expired
                  ? 'Contrato expirado pela vigência: não há comando de transição a partir deste estado.'
                  : 'Seu perfil não tem comando autorizado para a situação atual deste contrato. A transição é do servidor.'}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {availableActions.map((action) => (
                <li key={action.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
                    {action.label}
                  </span>
                  <span className="text-[12px] text-[color:var(--color-text-secondary)]">
                    {CONTRACT_COMMAND_EFFECT[action.id] ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ObjectPanel>

        {/*
          REAJUSTES — trilha comercial PERSISTIDA em `commercialTerms.adjustments`.
          Cada linha e um reajuste registrado: quando passa a valer, quanto incide e por qual indice.
          O preco reajustado NAO e calculado aqui — o servidor aplica (`applyUnitPriceAdjustment`) no
          momento em que o preco e usado; a tela publica o REGISTRO, nao o resultado.
        */}
        {commercialAdjustments.length > 0 ? (
          <ObjectPanel title="Reajustes contratuais">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Reajustes do contrato">
                <thead className="text-xs text-gray-500 uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">Efetivo em</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Percentual</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Índice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {commercialAdjustments.map((adjustment, index) => (
                    <tr key={`${adjustment.effectiveOn}-${index}`}>
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">
                        {formatDate(adjustment.effectiveOn)}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 tabular-nums">
                        {formatPercent(adjustment.percent)}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">
                        {adjustment.indexCode ?? 'Sem índice informado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ObjectPanel>
        ) : null}

        <div id="itens-contratuais">
        <ObjectPanel title="Itens contratuais">
          {items.length === 0 ? (
            <p className="m-0 text-sm text-gray-500">Nenhum item registrado no contrato.</p>
          ) : (
            <>
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
                        Unidade
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
                        <td className="py-2 pr-4 text-gray-700">
                          {item.description}
                          {/*
                            VÍNCULO AO CATÁLOGO — declarado, não inventado.
                            O item guarda `serviceDefinitionId` e um `serviceSnapshot`; quando o
                            snapshot publica um rótulo humano, ele aparece como procedência do item.
                          */}
                          {catalogLabel(item.serviceSnapshot) ? (
                            <span className="ml-2 text-[11px] text-gray-500">
                              Catálogo: {catalogLabel(item.serviceSnapshot)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-gray-700 tabular-nums">{item.quantity ?? '—'}</td>
                        <td className="py-2 pr-4 text-gray-700">{item.unitCode ?? '—'}</td>
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
              {/*
                TOTAL DAS LINHAS — dito como tal. Ele NAO e "valor do contrato": e a soma dos totais
                de linha que o payload publicou, e a nota ao lado impede a leitura errada.
              */}
              {contractedTotal ? (
                <p className="m-0 mt-2 text-[12px] text-[color:var(--color-text-secondary)]">
                  Soma das {items.length} linha{items.length === 1 ? '' : 's'} publicada
                  {items.length === 1 ? '' : 's'}:{' '}
                  <span className="font-semibold text-[color:var(--color-text-primary)] tabular-nums">
                    {formatMoney(contractedTotal, contract.currencyCode)}
                  </span>{' '}
                  — valor do contrato no domínio é do servidor, não desta soma.
                </p>
              ) : null}
            </>
          )}
        </ObjectPanel>
        </div>

        <div id="documentos-vinculados">
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
        </div>

        {/*
          CAMADAS DE PROFUNDIDADE NÃO PUBLICADAS — declaradas, nunca inventadas.

          O contrato de leitura do contrato (`ContractDetailResponse`) publica três coisas: o
          contrato, os itens e os vínculos de documento. As camadas abaixo são do VOCABULÁRIO do
          domínio — o operador as procura numa ficha de contrato — mas não têm fonte nesta leitura.
          Esconder cada uma faria o operador concluir "este contrato não tem OS", que é a leitura
          errada; declará-las diz a verdade: elas existem no produto e não estão publicadas aqui.
        */}
        <ContractServiceOrdersPanel contractId={contract.id} />
        <ObjectPanel title="Profundidade não publicada nesta leitura">
          <div className="flex flex-col gap-2">
            <UnavailableCapability
              title="Medições"
              reason="A medição pertence ao ciclo da ordem de serviço e não é publicada no detalhe do contrato."
            />
            <UnavailableCapability
              title="Contexto financeiro"
              reason="O detalhe do contrato não publica títulos, faturamento nem saldo. O financeiro do contrato vive em Contas a Receber, que recorta por título e não por contrato."
            >
              <Link to="/app/finance/receivables" className="text-brand-700 no-underline hover:underline">
                Abrir Contas a Receber
              </Link>
            </UnavailableCapability>
          </div>
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
