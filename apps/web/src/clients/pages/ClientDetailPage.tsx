import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  activateClient,
  ClientsApiError,
  deactivateClient,
  getClient,
} from '../api/clients-api';
import {
  DEACTIVATION_CONSEQUENCE_MESSAGE,
  mapClientErrorToMessage,
  VERSION_CONFLICT_MESSAGE,
} from '../api/client-error-messages';
import { ClientRelatedRecords } from '../components/ClientRelatedRecords';
import { ClientContactsPanel } from '../components/ClientContactsPanel';
import { ClientAddressesPanel, ClientUnitsPanel } from '../components/ClientUnitsPanel';
import {
  ClientAuditTrailPanel,
  ClientDataQualityPanel,
  ClientHierarchyPanel,
} from '../components/ClientHierarchyPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { useClientRelatedRecords } from '../hooks/useClientRelatedRecords';
import { CLIENT_STATUSES, type Client } from '../types/client.types';
import { buildClientRelationSpecs } from '../utils/client-relations';
import {
  buildClientContextFields,
  buildClientMetadata,
  buildClientNextAction,
  buildClientStateFlow,
  clientReference,
  clientStatusBadge,
  clientStatusDescription,
} from '../utils/client-object-presentation';
import {
  buildAuthorizedRelations,
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  type ObjectAction,
  type ObjectPagePhase,
} from '../../enterprise-object';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { Alert, Button, ModulePage, ModulePageHeader } from '../../ui';

/**
 * OBJECT PAGE DO CLIENTE — leitura canônica do contrato `enterprise-object`.
 *
 *   breadcrumb (Clientes -> Cliente)
 *     EnterpriseObjectHeader   referência, título, estado, fatos e ações
 *     ObjectStateFlow          os dois estados reais do Cliente
 *     NextActionPanel          o que normalmente acontece agora (estado + capability + dado real)
 *     SmartRelationBar         cadeia comercial real e autorizada
 *     ObjectContextBlock       fatos que qualificam o Cliente
 *     corpo + coluna lateral   relacionados, contatos, endereços, histórico e administração
 *
 * Nenhuma capability é inventada, nenhum estado é inventado e nenhum número órfão é exibido:
 * a autorização continua sendo decidida no servidor.
 */

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; client: Client };

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('pt-BR');
}

const CLIENT_BREADCRUMB = [
  { label: 'Clientes', href: '/app/clients' },
  { label: 'Cliente' },
];

export function ClientDetailPage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const reasonId = useId();
  const { capabilities } = useClientCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setVersionConflict(false);
    try {
      const client = await getClient(clientId);
      setState({ phase: 'ready', client });
    } catch (error) {
      if (error instanceof ClientsApiError) {
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
        message: error instanceof ClientsApiError
          ? mapClientErrorToMessage(error.code, error.status)
          : 'Não foi possível carregar o Cliente.',
      });
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Leitura única da cadeia comercial: alimenta a barra de relações e os painéis "Relacionados".
  const related = useClientRelatedRecords(state.phase === 'ready' ? state.client.id : null);

  /*
   * CADEIA DE NEGOCIO DO CLIENTE.
   *
   * `CLIENT` e a RAIZ do read model (posicao 0): a cadeia devolve tudo o que
   * DESCEU deste cadastro — solicitacao, proposta, pedido, OS, medicao, faturamento,
   * recebivel — ja autorizado e ordenado pelo servidor. E diferente dos paineis
   * "Relacionados", que mostram listas por modulo: aqui o operador ve a LIGACAO
   * entre os objetos, navegavel por clique.
   *
   * Fica ANTES dos retornos antecipados de fase: hooks nao podem ser condicionais.
   */
  const businessChain = useBusinessChain('CLIENT', clientId);

  async function handleDeactivate() {
    if (state.phase !== 'ready') {
      return;
    }
    const reason = deactivateReason.trim();
    if (!reason) {
      setActionError('Informe o motivo da desativação.');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);
    try {
      const updated = await deactivateClient(state.client.id, state.client.version, reason);
      setDeactivateOpen(false);
      setDeactivateReason('');
      setState({ phase: 'ready', client: updated });
    } catch (error) {
      if (error instanceof ClientsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setActionError(VERSION_CONFLICT_MESSAGE);
      } else {
        setActionError(
          error instanceof ClientsApiError
            ? mapClientErrorToMessage(error.code, error.status)
            : 'Não foi possível desativar o Cliente.',
        );
      }
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleActivate() {
    if (state.phase !== 'ready') {
      return;
    }

    setActionSubmitting(true);
    setActionError(null);
    try {
      const updated = await activateClient(state.client.id, state.client.version);
      setActivateOpen(false);
      setState({ phase: 'ready', client: updated });
    } catch (error) {
      if (error instanceof ClientsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setActionError(VERSION_CONFLICT_MESSAGE);
      } else {
        setActionError(
          error instanceof ClientsApiError
            ? mapClientErrorToMessage(error.code, error.status)
            : 'Não foi possível reativar o Cliente.',
        );
      }
    } finally {
      setActionSubmitting(false);
    }
  }

  if (state.phase !== 'ready') {
    // Estados de página resolvidos UMA vez, pela moldura do contrato: negacao nao se confunde
    // com registro vazio, e falha de rede oferece nova tentativa.
    let phase: ObjectPagePhase = 'error';
    let phaseMessage = 'Não foi possível carregar o Cliente.';
    let onRetry: (() => void) | undefined;
    if (state.phase === 'loading') {
      phase = 'loading';
      phaseMessage = 'Carregando Cliente…';
    } else if (state.phase === 'denied') {
      phase = 'denied';
      phaseMessage = 'Você não tem permissão para consultar este Cliente.';
    } else if (state.phase === 'not_found') {
      phase = 'empty';
      phaseMessage = 'Cliente não encontrado.';
    } else {
      phaseMessage = state.message;
      onRetry = () => void reload();
    }

    return (
      <ModulePage layout="wide" className="clients-page">
        <ModulePageHeader title="Cliente" />
        <EnterpriseObjectPage
          breadcrumb={CLIENT_BREADCRUMB}
          header={null}
          phase={phase}
          phaseTitle="Cliente"
          phaseMessage={phaseMessage}
          onRetry={phase === 'error' ? onRetry : undefined}
        />
      </ModulePage>
    );
  }

  const { client } = state;

  const statusBadge = clientStatusBadge(client.status);
  const stateFlow = buildClientStateFlow(client.status);

  // Ações reais: cada uma existe apenas quando a capability correspondente diz que pode.
  const primaryAction: ObjectAction | null = capabilities.canUpdate
    ? {
        id: 'edit',
        label: 'Editar',
        onSelect: () => {
          void navigate(`/app/clients/${client.id}/edit`);
        },
      }
    : null;

  const destructiveActions: ObjectAction[] =
    capabilities.canDeactivate && client.status === CLIENT_STATUSES.Active
      ? [
          {
            id: 'deactivate',
            label: 'Desativar',
            onSelect: () => setDeactivateOpen(true),
          },
        ]
      : [];

  const relations = buildAuthorizedRelations(buildClientRelationSpecs(related, client.id));
  const nextAction = buildClientNextAction(client, capabilities, {
    onReactivate: () => setActivateOpen(true),
  });

  return (
    <ModulePage layout="wide" className="clients-page">
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Clientes', href: '/app/clients' },
          { label: client.legalName },
        ]}
        header={
          <EnterpriseObjectHeader
            reference={clientReference(client)}
            title={client.legalName}
            subtitle={client.tradeName}
            status={{
              label: statusBadge.label,
              tone: statusBadge.tone,
              description: clientStatusDescription(client) ?? undefined,
            }}
            metadata={buildClientMetadata(client)}
            primaryAction={primaryAction}
            destructiveActions={destructiveActions}
          />
        }
        stateFlow={
          stateFlow ? (
            <ObjectStateFlow
              steps={stateFlow.steps}
              currentId={stateFlow.currentId}
              title="Ciclo de vida"
            />
          ) : null
        }
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        aside={
          <>
            {/*
              COLUNA DE APOIO — O CADASTRO OPERACIONAL DO CLIENTE.

              CONTATOS, UNIDADES E ENDEREÇOS SÃO AGORA OPERÁVEIS, e não texto. Antes desta onda a
              coluna listava as três coleções em `<li>` sem nenhuma ação: corrigir um telefone
              exigia sair da ficha e reenviar o formulário inteiro do cadastro. Cada painel agora
              despacha COMANDOS PRÓPRIOS (adicionar, papel, principal, inativar, matriz, remover),
              com a `version` do Cliente como concorrência otimista. O servidor continua sendo o
              boundary: toda ação é uma chamada que ele pode recusar, e a recusa vira mensagem.
            */}
            <ClientContactsPanel
              client={client}
              canManage={capabilities.canManageContacts}
              onUpdated={(updated) => setState({ phase: 'ready', client: updated })}
              onError={setActionError}
            />

            <ClientUnitsPanel
              client={client}
              canManage={capabilities.canManageUnits}
              onUpdated={(updated) => setState({ phase: 'ready', client: updated })}
              onError={setActionError}
            />

            <ClientAddressesPanel client={client} />

            {/*
              QUALIDADE DO CADASTRO — apontamentos reais do servidor.
              Fica na coluna de apoio porque é uma AVALIAÇÃO do cadastro, não parte do trabalho
              corrente: o operador consulta quando vai completar o registro.
            */}
            <ClientDataQualityPanel clientId={client.id} />

            {/*
              HISTÓRICO — A TRILHA DE VALOR, e não mais uma inferência sobre timestamps.

              A seção anterior derivava "Cadastro criado/atualizado/desativado" comparando
              `createdAt`, `updatedAt` e `deactivatedAt`. Isso dizia QUANDO algo mudou e nunca O QUE
              mudou nem QUEM mudou — que é a pergunta que a governança de cadastro faz. Agora a
              leitura é do canal AUDIT_TRAIL, com o par (antes, depois) por alteração.
            */}
            <ClientAuditTrailPanel clientId={client.id} />

            <ObjectPanel title="Administrativo">
              <dl className="client-details m-0">
                <div>
                  <dt>Criado em</dt>
                  <dd>{formatDateTime(client.createdAt)}</dd>
                </div>
                <div>
                  <dt>Atualizado em</dt>
                  <dd>{formatDateTime(client.updatedAt)}</dd>
                </div>
                {client.deactivatedAt ? (
                  <div>
                    <dt>Desativado em</dt>
                    <dd>{formatDateTime(client.deactivatedAt)}</dd>
                  </div>
                ) : null}
                {client.deactivationReason ? (
                  <div>
                    <dt>Motivo da desativação</dt>
                    <dd>{client.deactivationReason}</dd>
                  </div>
                ) : null}
              </dl>
              {client.deactivatedAt && client.status === CLIENT_STATUSES.Active ? (
                <p
                  className="mt-2 mb-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                  role="note"
                >
                  A reativação preserva o histórico de desativação anterior.
                </p>
              ) : null}
            </ObjectPanel>
          </>
        }
      >
        {/*
          AREA DE TRABALHO — CONTEXTO E LINHAGEM NA COLUNA PRINCIPAL, CADASTRO NA DE APOIO.

          MEDIDO antes desta recomposicao (1440x900, DOM real):
            - span vertical de 1082px; 13 containers com borda/sombra; 10 <h2> de MESMO peso
            - cadeia, relacionados, contatos e enderecos empilhados em largura total, um por
              faixa: cada bloco custava uma linha inteira e o operador rolava para saber o basico
            - 93 folhas de conteudo, quase tudo fora da dobra

          A composicao passa a usar a grade de duas colunas que a PROPRIA moldura
          (`EnterpriseObjectPage`) ja monta quando recebe `aside`. A coluna principal carrega o
          que responde "o que e este cliente e o que nasceu dele" (contexto, cadeia, relacionados)
          e a coluna de apoio carrega o cadastro operacional (contatos, enderecos, administrativo
          e historico). O que era uma sequencia de faixas passa a ser leitura em paralelo.

          Isso NAO duplica a grade no corpo: uma grade aninhada dentro da outra espremeria a
          coluna principal e as fichas de relacionamento — foi exatamente o defeito que a
          primeira tentativa produziu e que a medicao pegou (coluna principal caindo para 380px e
          fichas para 185px). Os paineis sao os mesmos; o que muda e onde sao compostos.
        */}
        <ObjectContextBlock fields={buildClientContextFields(client)} />

        {/*
          HIERARQUIA EMPRESARIAL — na coluna PRINCIPAL, e não na de apoio.

          A estrutura organizacional (grupo econômico, matriz, filiais) é o que responde "onde este
          Cliente se encaixa" — parte central do Customer 360, e não um detalhe de cadastro. A
          seção é renderizada SEMPRE, inclusive quando não há vínculo: a ausência de estrutura é
          uma informação legítima, e a seção a declara em vez de sumir. Só uma leitura NEGADA a
          remove, o que o próprio painel decide.
        */}
        <ClientHierarchyPanel
          client={client}
          canManage={capabilities.canManageHierarchy}
          onUpdated={(updated) => setState({ phase: 'ready', client: updated })}
          onError={setActionError}
        />

        {actionError ? (
          <Alert tone="error" title="Não foi possível concluir a ação">
            {actionError}
          </Alert>
        ) : null}

        {versionConflict ? (
          <Alert tone="warning" title="Cadastro alterado em outra sessão">
            <p className="m-0">{VERSION_CONFLICT_MESSAGE}</p>
            <div className="mt-2">
              <Button type="button" variant="secondary" onClick={() => void reload()}>
                Recarregar dados atuais
              </Button>
            </div>
          </Alert>
        ) : null}

        {/* Linhagem autorizada: o que nasceu deste Cliente, do pedido ao dinheiro. */}
        <BusinessChain
          chain={businessChain.chain}
          phase={businessChain.phase}
          message={businessChain.message}
          onRetry={businessChain.retry}
          title="Cadeia de negócio do cliente"
        />

        <ClientRelatedRecords modules={related} />
      </EnterpriseObjectPage>

      <ConfirmDialog
        open={deactivateOpen}
        title="Desativar Cliente"
        description={DEACTIVATION_CONSEQUENCE_MESSAGE}
        confirmLabel={actionSubmitting ? 'Desativando…' : 'Confirmar desativação'}
        confirmDisabled={actionSubmitting}
        onCancel={() => {
          if (!actionSubmitting) {
            setDeactivateOpen(false);
            setDeactivateReason('');
          }
        }}
        onConfirm={() => void handleDeactivate()}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-sm font-semibold text-gray-700">
            Motivo da desativação
          </label>
          <textarea
            id={reasonId}
            value={deactivateReason}
            onChange={(event) => setDeactivateReason(event.target.value)}
            rows={3}
            required
            disabled={actionSubmitting}
            className="min-h-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={activateOpen}
        title="Reativar Cliente"
        description="O Cliente voltará ao status ativo. O histórico de desativação anterior será preservado."
        confirmLabel={actionSubmitting ? 'Reativando…' : 'Confirmar reativação'}
        confirmDisabled={actionSubmitting}
        onCancel={() => {
          if (!actionSubmitting) {
            setActivateOpen(false);
          }
        }}
        onConfirm={() => void handleActivate()}
      />
    </ModulePage>
  );
}
