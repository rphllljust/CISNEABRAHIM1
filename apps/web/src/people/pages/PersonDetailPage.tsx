import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  activatePerson,
  deactivatePerson,
  getPerson,
  listPersonHistory,
  PeopleApiError,
} from '../api/people-api';
import {
  DEACTIVATION_CONSEQUENCE_MESSAGE,
  mapPersonErrorToMessage,
  VERSION_CONFLICT_MESSAGE,
} from '../api/person-error-messages';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import { PERSON_STATUSES, type Person, type PersonHistoryEvent } from '../types/person.types';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; person: Person; history: PersonHistoryEvent[] };

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('pt-BR');
}

export function PersonDetailPage() {
  const { personId = '' } = useParams();
  const reasonId = useId();
  const { capabilities } = usePersonCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    try {
      const [person, historyResponse] = await Promise.all([
        getPerson(personId),
        listPersonHistory(personId),
      ]);
      setState({ phase: 'ready', person, history: historyResponse.items });
    } catch (error) {
      if (error instanceof PeopleApiError) {
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
          error instanceof PeopleApiError
            ? mapPersonErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a Pessoa.',
      });
    }
  }, [personId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleDeactivate() {
    if (state.phase !== 'ready') {
      return;
    }
    const reason = deactivateReason.trim();
    if (!reason) {
      setActionError('Informe o motivo da inativação.');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);
    try {
      const updated = await deactivatePerson(state.person.id, state.person.version, reason);
      setDeactivateReason('');
      setState({
        phase: 'ready',
        person: updated,
        history: state.history,
      });
      void reload();
    } catch (error) {
      setActionError(
        error instanceof PeopleApiError
          ? error.kind === 'version_conflict'
            ? VERSION_CONFLICT_MESSAGE
            : mapPersonErrorToMessage(error.code, error.status)
          : 'Não foi possível inativar a Pessoa.',
      );
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
      await activatePerson(state.person.id, state.person.version);
      void reload();
    } catch (error) {
      setActionError(
        error instanceof PeopleApiError
          ? mapPersonErrorToMessage(error.code, error.status)
          : 'Não foi possível reativar a Pessoa.',
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true">Carregando…</p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <p role="alert">Você não tem permissão para visualizar esta Pessoa.</p>
        <Link to="/app/people">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <p role="status">Pessoa não encontrada.</p>
        <Link to="/app/people">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <p role="alert">{state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { person, history } = state;

  return (
    <main id="main-content" className="shell-page">
      <header className="shell-page-header">
        <div>
          <p className="text-sm text-gray-500">{person.memberCode}</p>
          <h1>{person.preferredName ?? person.legalName}</h1>
          <PersonStatusBadge status={person.status} />
        </div>
        <div className="shell-page-actions">
          {capabilities.canUpdate ? (
            <Link to={`/app/people/${person.id}/edit`}>Editar</Link>
          ) : null}
        </div>
      </header>

      <section aria-labelledby="person-details-heading">
        <h2 id="person-details-heading">Dados cadastrais</h2>
        <dl className="shell-description-list">
          <div>
            <dt>Nome legal</dt>
            <dd>{person.legalName}</dd>
          </div>
          <div>
            <dt>Nome de uso</dt>
            <dd>{person.preferredName ?? '—'}</dd>
          </div>
          <div>
            <dt>Função operacional padrão</dt>
            <dd>{person.defaultLaborTypeName ?? person.defaultLaborTypeCode ?? '—'}</dd>
          </div>
          <div>
            <dt>Referência externa</dt>
            <dd>{person.externalErpId ?? '—'}</dd>
          </div>
          <div>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(person.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="person-os-heading">
        <h2 id="person-os-heading">Ordens de serviço</h2>
        <p className="text-sm text-gray-600">
          A atribuição deste empregado a uma ordem de serviço é feita no planejamento da OS, depois
          da liberação. Somente o empregado atribuído executa a ordem.
        </p>
      </section>

      {capabilities.canDeactivate && person.status === PERSON_STATUSES.Active ? (
        <section aria-labelledby="person-deactivate-heading">
          <h2 id="person-deactivate-heading">Inativação</h2>
          <p className="text-sm text-gray-600">{DEACTIVATION_CONSEQUENCE_MESSAGE}</p>
          <label htmlFor={reasonId}>Motivo</label>
          <textarea
            id={reasonId}
            value={deactivateReason}
            onChange={(event) => setDeactivateReason(event.target.value)}
          />
          <button type="button" disabled={actionSubmitting} onClick={() => void handleDeactivate()}>
            Inativar
          </button>
        </section>
      ) : null}

      {capabilities.canActivate && person.status === PERSON_STATUSES.Inactive ? (
        <section aria-labelledby="person-activate-heading">
          <h2 id="person-activate-heading">Reativação</h2>
          <button type="button" disabled={actionSubmitting} onClick={() => void handleActivate()}>
            Reativar
          </button>
        </section>
      ) : null}

      <section aria-labelledby="person-history-heading">
        <h2 id="person-history-heading">Histórico</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum evento registrado.</p>
        ) : (
          <ul>
            {history.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType}</strong> — {formatDateTime(event.occurredAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {actionError ? (
        <p role="alert" className="shell-form-error">
          {actionError}
        </p>
      ) : null}

      <Link to="/app/people">Voltar à lista</Link>
    </main>
  );
}
