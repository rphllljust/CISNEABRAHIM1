import { Link, useParams } from 'react-router-dom';
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
import { ClientStatusBadge } from '../components/ClientStatusBadge';
import { ClientRelatedRecords } from '../components/ClientRelatedRecords';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { CLIENT_STATUSES, type Client } from '../types/client.types';
import { formatCnpjDisplay } from '../utils/format-cnpj';

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

export function ClientDetailPage() {
  const { clientId = '' } = useParams();
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando Cliente…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Cliente</h1>
        <p role="alert">Você não tem permissão para consultar este Cliente.</p>
        <Link to="/app/clients">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Cliente</h1>
        <p role="alert">Cliente não encontrado.</p>
        <Link to="/app/clients">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Cliente</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { client } = state;

  return (
    <main id="main-content" className="shell-page clients-page">
      <header className="clients-page__header">
        <div>
          <h1>{client.legalName}</h1>
          <ClientStatusBadge status={client.status} />
        </div>
        <div className="button-row">
          {capabilities.canUpdate ? (
            <Link to={`/app/clients/${client.id}/edit`} className="button-link button-secondary">
              Editar
            </Link>
          ) : null}
          {capabilities.canDeactivate && client.status === CLIENT_STATUSES.Active ? (
            <button type="button" className="button-secondary" onClick={() => setDeactivateOpen(true)}>
              Desativar
            </button>
          ) : null}
          {capabilities.canActivate && client.status === CLIENT_STATUSES.Inactive ? (
            <button type="button" onClick={() => setActivateOpen(true)}>
              Reativar
            </button>
          ) : null}
        </div>
      </header>

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

      {/* Contexto antes do cadastro: o Cliente e a contraparte da cadeia comercial inteira. */}
      <ClientRelatedRecords clientId={client.id} />

      <section className="client-section" aria-labelledby="client-identification-heading">
        <h2 id="client-identification-heading">Identificação jurídica</h2>
        <dl className="client-details">
          <div>
            <dt>Razão social</dt>
            <dd>{client.legalName}</dd>
          </div>
          <div>
            <dt>Nome fantasia</dt>
            <dd>{client.tradeName ?? '—'}</dd>
          </div>
          <div>
            <dt>CNPJ</dt>
            <dd>{formatCnpjDisplay(client.taxId)}</dd>
          </div>
          <div>
            <dt>Referência externa</dt>
            <dd>{client.externalErpId ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="client-section" aria-labelledby="client-contacts-heading">
        <h2 id="client-contacts-heading">Contatos</h2>
        {client.contacts.length === 0 ? (
          <p>Nenhum contato cadastrado.</p>
        ) : (
          <ul className="client-card-list">
            {client.contacts.map((contact) => (
              <li key={contact.id ?? `${contact.name}-${contact.purpose}`}>
                <strong>{contact.name}</strong> — {formatPurposeLabel(contact.purpose)}
                <div>
                  {contact.email ? <span>E-mail: {contact.email}</span> : null}
                  {contact.email && contact.phone ? <span> · </span> : null}
                  {contact.phone ? <span>Telefone: {contact.phone}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="client-section" aria-labelledby="client-addresses-heading">
        <h2 id="client-addresses-heading">Endereços</h2>
        {client.addresses.length === 0 ? (
          <p>Nenhum endereço cadastrado.</p>
        ) : (
          <ul className="client-card-list">
            {client.addresses.map((address) => (
              <li key={address.id ?? address.purpose}>
                <strong>{formatPurposeLabel(address.purpose)}</strong>
                <div>
                  {[address.street, address.number, address.complement, address.district, address.city, address.state]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </div>
                {address.postalCode ? <div>CEP: {address.postalCode}</div> : null}
                {address.country ? <div>País: {address.country}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="client-section" aria-labelledby="client-admin-heading">
        <h2 id="client-admin-heading">Informações administrativas</h2>
        <dl className="client-details">
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
          <p className="form-notice" role="note">
            A reativação preserva o histórico de desativação anterior.
          </p>
        ) : null}
      </section>

      <p>
        <Link to="/app/clients">Voltar à lista</Link>
      </p>

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
    </main>
  );
}
