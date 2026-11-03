import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useId, useState } from 'react';
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
import {
  Alert,
  Button,
  ConfirmAction,
  Field,
  ModulePage,
  ModulePageHeader,
  Textarea,
} from '../../ui';
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
  const [openDeactivate, setOpenDeactivate] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((value) => value + 1);

  /**
   * Ficha 360 e trilha historica devem representar A MESMA Pessoa.
   * Trocar de URL ou atualizar apos comando aborta as leituras do recorte antigo.
   * Respostas tardias nao podem expor contexto ou autorizar acao com rowVersion antigo.
   */
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setState({ phase: 'loading' });
      setActionError(null);
      try {
        const [person, historyResponse] = await Promise.all([
          getPerson(personId, controller.signal),
          listPersonHistory(personId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setState({ phase: 'ready', person, history: historyResponse.items });
      } catch (error) {
        if (controller.signal.aborted) return;
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
    };
    void load();
    return () => controller.abort();
  }, [personId, reloadToken]);

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
      setOpenDeactivate(false);
      setState({
        phase: 'ready',
        person: updated,
        history: state.history,
      });
      void reload();
    } catch (error) {
      setOpenDeactivate(false);
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

  if (state.phase !== 'ready' || state.person.id !== personId) {
    let phase: ObjectPagePhase = 'error';
    let phaseTitle = 'Pessoa';
    let phaseMessage = 'Não foi possível carregar a Pessoa.';
    let onRetry: (() => void) | undefined;
    if (state.phase === 'loading' || (state.phase === 'ready' && state.person.id !== personId)) {
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
          <Alert tone="error" title="Não foi possível concluir a ação">
            {actionError}
          </Alert>
        ) : null}

        <ObjectPanel title="Alocação em ordens de serviço">
          <p className="text-sm text-gray-600">
            A atribuição deste empregado a uma ordem de serviço é feita no planejamento da OS,
            depois da liberação. Somente o empregado atribuído executa a ordem.
          </p>
        </ObjectPanel>

        {capabilities.canDeactivate && isActive ? (
          /*
            COMANDO DE INATIVACAO — superficie governada, nao controle cru.

            MEDIDO no DOM real (1440x900) antes desta correcao:
            - o botao "Inativar" era um `<button>` sem estilo do design system:
              `background rgb(29,78,216)` — azul generico do Tailwind, enquanto a acao
              primaria da MESMA pagina renderiza `rgb(22,104,96)` (teal `brand-700`).
              Duas cores de acao no mesmo produto;
            - o rotulo "Motivo" era um `<label>` cru em `16px/400` (tamanho de corpo),
              contra os `12px/600` do rotulo de campo do CISNE;
            - o `<textarea>` estava em `border: 0px; padding: 0px` — sem moldura alguma,
              sem raio e sem anel de foco visivel;
            - o erro do comando entrava por `<p class="shell-form-error">`, classe legada.

            A acao agora e uma COMMAND de verdade: confirmacao governada (`ConfirmAction`,
            que ja exige o motivo para habilitar), motivo em `Field` + `Textarea` com a
            mesma gramatica dos demais formularios, erro em `Alert` e disparo por `Button`.
            O backend continua decidindo — capabilities e autorizacao nao mudaram.
          */
          <ObjectPanel title="Inativação">
            <p className="m-0 text-sm text-gray-600">{DEACTIVATION_CONSEQUENCE_MESSAGE}</p>
            <div className="mt-3">
              <Button
                type="button"
                variant="danger"
                disabled={actionSubmitting}
                loading={actionSubmitting}
                loadingText="Inativando"
                onClick={() => setOpenDeactivate(true)}
              >
                Inativar Pessoa
              </Button>
            </div>
          </ObjectPanel>
        ) : null}

        <p>
          <Link to="/app/people">Voltar à lista</Link>
        </p>
      </EnterpriseObjectPage>

      {/*
        CONFIRMACAO GOVERNADA DO COMANDO.

        Inativar e um comando empresarial, nao um clique de botao: a confirmacao declara a
        consequencia, exige o motivo (o botao so habilita com motivo preenchido) e mantem a
        acao destrutiva em `danger`. A mesma primitiva usada pelas transicoes de contrato.
      */}
      <ConfirmAction
        open={openDeactivate}
        title="Inativar Pessoa"
        description={DEACTIVATION_CONSEQUENCE_MESSAGE}
        confirmLabel="Confirmar inativação"
        confirmVariant="danger"
        confirmDisabled={!deactivateReason.trim()}
        loading={actionSubmitting}
        onConfirm={() => void handleDeactivate()}
        onCancel={() => {
          setOpenDeactivate(false);
          setActionError(null);
        }}
      >
        <Field label="Motivo" htmlFor={reasonId} required>
          <Textarea
            id={reasonId}
            value={deactivateReason}
            rows={3}
            onChange={(event) => setDeactivateReason(event.target.value)}
            placeholder="Descreva o motivo da inativação deste cadastro."
          />
        </Field>
      </ConfirmAction>
    </ModulePage>
  );
}
