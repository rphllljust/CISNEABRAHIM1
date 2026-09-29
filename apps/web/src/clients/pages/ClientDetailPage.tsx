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
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { useClientRelatedRecords } from '../hooks/useClientRelatedRecords';
import { CLIENT_STATUSES, type Client } from '../types/client.types';
import { buildClientRelationSpecs } from '../utils/client-relations';
import {
  buildClientContextFields,
  buildClientHistoryFacts,
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
import { ActivityTimeline } from '../../operator';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { ModulePage, ModulePageHeader } from '../../ui';

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

function formatPurposeLabel(purpose: string): string {
  switch (purpose) {
    case 'operational':
      return 'Operacional';
    case 'commercial':
      return 'Comercial';
    case 'billing':
      return 'Faturamento';
    case 'correspondence':
      return 'Correspondência';
    default:
      return purpose;
  }
}

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
      <ModulePage className="clients-page">
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
    <ModulePage className="clients-page">
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
            <ObjectPanel>
              <ActivityTimeline facts={buildClientHistoryFacts(client)} title="Histórico" />
            </ObjectPanel>

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
                <p className="form-notice mt-2" role="note">
                  A reativação preserva o histórico de desativação anterior.
                </p>
              ) : null}
            </ObjectPanel>
          </>
        }
      >
        {/*
          CONTEXTO: a moldura declara um slot `context`, mas o primitivo não o renderiza hoje
          (`EnterpriseObjectPage` o recebe e não o compõe). Como este trabalho não altera o contrato
          compartilhado, o bloco entra como PRIMEIRO conteúdo do corpo — logo depois de estado,
          próxima ação e relações, que é a ordem canônica de leitura do contrato.
        */}
        <ObjectContextBlock fields={buildClientContextFields(client)} />

        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {versionConflict ? (
          <div className="form-notice" role="status">
            <p>{VERSION_CONFLICT_MESSAGE}</p>
            <button type="button" onClick={() => void reload()}>
              Recarregar dados atuais
            </button>
          </div>
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

        <ObjectPanel title="Contatos">
          {client.contacts.length === 0 ? (
            <p className="m-0 text-sm text-gray-500">Nenhum contato cadastrado.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {client.contacts.map((contact) => (
                <li key={contact.id ?? `${contact.name}-${contact.purpose}`}>
                  <strong>{contact.name}</strong> — {formatPurposeLabel(contact.purpose)}
                  <div className="text-xs text-gray-600">
                    {contact.email ? <span>E-mail: {contact.email}</span> : null}
                    {contact.email && contact.phone ? <span> · </span> : null}
                    {contact.phone ? <span>Telefone: {contact.phone}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ObjectPanel>

        <ObjectPanel title="Endereços">
          {client.addresses.length === 0 ? (
            <p className="m-0 text-sm text-gray-500">Nenhum endereço cadastrado.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {client.addresses.map((address) => (
                <li key={address.id ?? address.purpose}>
                  <strong>{formatPurposeLabel(address.purpose)}</strong>
                  <div className="text-xs text-gray-600">
                    {[address.street, address.number, address.complement, address.district, address.city, address.state]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </div>
                  {address.postalCode ? <div className="text-xs text-gray-600">CEP: {address.postalCode}</div> : null}
                  {address.country ? <div className="text-xs text-gray-600">País: {address.country}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </ObjectPanel>
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
        <div className="form-field">
          <label htmlFor={reasonId}>Motivo da desativação</label>
          <textarea
            id={reasonId}
            value={deactivateReason}
            onChange={(event) => setDeactivateReason(event.target.value)}
            rows={3}
            required
            disabled={actionSubmitting}
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
