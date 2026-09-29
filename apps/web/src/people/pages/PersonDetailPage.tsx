import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  toHumanText,
  type NextAction,
  type ObjectAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { ModulePage, ModulePageHeader } from '../../ui';
import type { StatusBadgeTone } from '../../ui/StatusBadge';
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
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import {
  PERSON_STATUSES,
  type Person,
  type PersonHistoryEvent,
  type PersonStatus,
} from '../types/person.types';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; person: Person; history: PersonHistoryEvent[] };

const STATUS_LABELS: Record<PersonStatus, string> = {
  [PERSON_STATUSES.Active]: 'Ativa',
  [PERSON_STATUSES.Inactive]: 'Inativa',
};

const STATUS_TONES: Record<PersonStatus, StatusBadgeTone> = {
  [PERSON_STATUSES.Active]: 'success',
  [PERSON_STATUSES.Inactive]: 'neutral',
};

/**
 * Etapas persistidas da Pessoa.
 *
 * `ACTIVE` e `INACTIVE` sao os dois estados gravados pelo dominio (`person-status.ts`)
 * e as transicoes reais sao `activate` / `deactivate`. Nada aqui e derivado no front.
 */
export function personStateSteps(person: Person): ObjectStateStep[] {
  return [
    {
      id: PERSON_STATUSES.Active,
      label: STATUS_LABELS[PERSON_STATUSES.Active],
      hint: `Criada em ${formatDateTime(person.createdAt)}`,
    },
    {
      id: PERSON_STATUSES.Inactive,
      label: STATUS_LABELS[PERSON_STATUSES.Inactive],
      hint: person.deactivatedAt
        ? `Inativada em ${formatDateTime(person.deactivatedAt)}`
        : undefined,
    },
  ];
}

const HISTORY_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Cadastro criado',
  UPDATED: 'Cadastro atualizado',
  DEACTIVATED: 'Pessoa inativada',
  ACTIVATED: 'Pessoa reativada',
};

function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString('pt-BR');
}

/**
 * Historico da Pessoa a partir dos eventos PERSISTIDOS.
 *
 * O payload guarda `event_type`, `occurred_at`, `actor_identity_id` e, na inativacao,
 * `reason`. O identificador do ator e tecnico e por isso nao entra na tela; o motivo
 * gravado entra como fato.
 */
export function personActivityFacts(history: PersonHistoryEvent[]): ActivityFact[] {
  return history.map((event) => {
    const reason = typeof event.payload?.['reason'] === 'string' ? event.payload['reason'] : null;
    const toState =
      event.eventType === 'DEACTIVATED'
        ? STATUS_LABELS[PERSON_STATUSES.Inactive]
        : event.eventType === 'ACTIVATED'
          ? STATUS_LABELS[PERSON_STATUSES.Active]
          : null;
    return {
      at: event.occurredAt,
      event: HISTORY_EVENT_LABELS[event.eventType] ?? toHumanText(event.eventType) ?? 'Evento registrado',
      toState,
      reference: reason === null ? null : toHumanText(reason),
    };
  });
}

export function PersonDetailPage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
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

  if (state.phase !== 'ready') {
    let phase: ObjectPagePhase = 'error';
    let phaseTitle = 'Pessoa';
    let phaseMessage = 'Não foi possível carregar a Pessoa.';
    let onRetry: (() => void) | undefined;
    if (state.phase === 'loading') {
      phase = 'loading';
      phaseMessage = 'Carregando…';
    } else if (state.phase === 'denied') {
      phase = 'denied';
      phaseMessage = 'Você não tem permissão para visualizar esta Pessoa.';
    } else if (state.phase === 'not_found') {
      phase = 'empty';
      phaseTitle = 'Pessoa não encontrada';
      phaseMessage = 'O servidor não encontrou esta Pessoa.';
    } else {
      phaseMessage = state.message;
      onRetry = () => void reload();
    }
    return (
      <ModulePage>
        <ModulePageHeader title="Pessoa" />
        <EnterpriseObjectPage
          breadcrumb={[{ label: 'Pessoas', href: '/app/people' }, { label: 'Pessoa' }]}
          phase={phase}
          phaseTitle={phaseTitle}
          phaseMessage={phaseMessage}
          onRetry={phase === 'error' ? onRetry : undefined}
          header={null}
        />
      </ModulePage>
    );
  }

  const { person, history } = state;
  const isActive = person.status === PERSON_STATUSES.Active;

  // Acao primaria: a mais provavel AGORA para este estado e esta capability.
  const primaryAction: ObjectAction | null = capabilities.canUpdate
    ? {
        id: 'edit',
        label: 'Editar cadastro',
        onSelect: () => {
          void navigate(`/app/people/${person.id}/edit`);
        },
      }
    : null;

  /**
   * Proxima acao: derivada do estado REAL e do dado REAL.
   *
   * - Pessoa inativa e operador autorizado: o proximo passo e reativa-la.
   * - Pessoa ativa e elegivel a alocacao em OS: o proximo passo acontece no
   *   planejamento da OS (`serviceOrderAllocationSupported`), nao nesta tela.
   * Sem estado/data/capability que sustente um passo, a secao desaparece.
   */
  let nextAction: NextAction | null = null;
  if (!isActive && capabilities.canActivate) {
    nextAction = {
      kind: 'act',
      label: 'Reativar a Pessoa',
      description: 'O cadastro volta ao estado ativo e pode ser alocado novamente.',
      onSelect: () => void handleActivate(),
    };
  } else if (isActive && person.serviceOrderAllocationSupported) {
    nextAction = {
      kind: 'waiting',
      label: 'Aguardar alocação em ordem de serviço',
      description: 'Somente a Pessoa alocada executa a ordem.',
      waitingOn: 'Planejamento da ordem de serviço',
    };
  }

  const metadata: ObjectMetadataField[] = [
    {
      label: 'Função operacional',
      value: person.defaultLaborTypeName ?? person.defaultLaborTypeCode,
    },
    { label: 'Referência externa', value: person.externalErpId },
    {
      label: 'Alocação em OS',
      value: person.serviceOrderAllocationSupported ? 'Permitida' : 'Não permitida',
    },
    { label: 'Atualizado em', value: formatDateTime(person.updatedAt) },
  ];

  const contextFields: ObjectContextField[] = [
    { label: 'Nome legal', value: person.legalName },
    { label: 'Nome de uso', value: person.preferredName },
    { label: 'Função operacional padrão', value: person.defaultLaborTypeName },
    { label: 'Código da função', value: person.defaultLaborTypeCode },
    { label: 'Referência externa', value: person.externalErpId },
    { label: 'Criada em', value: formatDateTime(person.createdAt) },
    { label: 'Inativada em', value: formatDateTime(person.deactivatedAt) },
    { label: 'Motivo da inativação', value: person.deactivationReason },
  ];

  return (
    <ModulePage>
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Pessoas', href: '/app/people' },
          { label: person.memberCode },
        ]}
        header={
          <EnterpriseObjectHeader
            reference={person.memberCode}
            title={person.preferredName ?? person.legalName}
            subtitle={person.preferredName ? person.legalName : null}
            status={{
              label: STATUS_LABELS[person.status],
              tone: STATUS_TONES[person.status],
              description:
                !isActive && person.deactivatedAt
                  ? `Inativada em ${formatDateTime(person.deactivatedAt)}`
                  : undefined,
            }}
            metadata={metadata}
            primaryAction={primaryAction}
          />
        }
        stateFlow={
          <ObjectStateFlow
            steps={personStateSteps(person)}
            currentId={person.status}
            title="Situação cadastral da Pessoa"
          />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={personActivityFacts(history)}
              title="Histórico da Pessoa"
              emptyMessage="O servidor não registrou eventos para esta Pessoa."
            />
          </ObjectPanel>
        }
      >
        {/* O contexto entra no corpo: a moldura do contrato nesta revisao nao renderiza o
            slot `context` (so breadcrumb, header, fluxo, proxima acao, relacoes e corpo). */}
        <ObjectContextBlock fields={contextFields} columns={3} />

        {actionError ? (
          <p role="alert" className="shell-form-error">
            {actionError}
          </p>
        ) : null}

        <ObjectPanel title="Alocação em ordens de serviço">
          <p className="text-sm text-gray-600">
            A atribuição deste empregado a uma ordem de serviço é feita no planejamento da OS,
            depois da liberação. Somente o empregado atribuído executa a ordem.
          </p>
        </ObjectPanel>

        {capabilities.canDeactivate && isActive ? (
          <ObjectPanel title="Inativação">
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
          </ObjectPanel>
        ) : null}

        <p>
          <Link to="/app/people">Voltar à lista</Link>
        </p>
      </EnterpriseObjectPage>
    </ModulePage>
  );
}
