import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import {
  activatePhysicalAsset,
  AssetsApiError,
  deactivatePhysicalAsset,
  getPhysicalAsset,
} from '../api/physical-assets-api';
import {
  DEACTIVATION_CONSEQUENCE_MESSAGE,
  mapAssetErrorToMessage,
  VERSION_CONFLICT_MESSAGE,
} from '../api/asset-error-messages';
import { AssetOperationalLifecyclePanel } from '../components/AssetOperationalLifecycle';
import { AssetVersionConflictNotice } from '../components/AssetVersionConflictNotice';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { useAssetCapabilities, useAssetResourceTypes } from '../hooks/useAssetCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import { probeServiceOrderListAccess } from '../../service-orders/api/service-orders-api';
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
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { ModulePage, ModulePageHeader } from '../../ui';
import type { StatusBadgeTone } from '../../ui/StatusBadge';
import {
  ASSET_LIFECYCLE_STATUSES,
  type AssetLifecycleStatus,
  type PhysicalAsset,
} from '../types/physical-asset.types';
import { resolveAssetOperationalStatus } from '../utils/asset-operational-status';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; asset: PhysicalAsset };

const LIFECYCLE_LABELS: Record<AssetLifecycleStatus, string> = {
  [ASSET_LIFECYCLE_STATUSES.Active]: 'Ativo',
  [ASSET_LIFECYCLE_STATUSES.Inactive]: 'Inativo',
};

const LIFECYCLE_TONES: Record<AssetLifecycleStatus, StatusBadgeTone> = {
  [ASSET_LIFECYCLE_STATUSES.Active]: 'success',
  [ASSET_LIFECYCLE_STATUSES.Inactive]: 'neutral',
};

/**
 * Leitura de ordens de servico autorizada.
 *
 * A relacao do ativo com a OS leva ao planejamento da ordem; sem autorizacao de
 * leitura naquele dominio a relacao NAO pode ser oferecida. O probe e o mesmo que o
 * modulo de OS usa (`probeServiceOrderListAccess`), e negacao vira `false` — nunca
 * "oculto".
 */
function useServiceOrderReadAccess(): boolean {
  const { status } = useAuth();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') {
      setAllowed(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void probeServiceOrderListAccess(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setAllowed(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [status]);

  return allowed;
}

function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString('pt-BR');
}

/**
 * Etapas persistidas do ativo fisico: `ACTIVE` e `INACTIVE` sao os estados gravados
 * pelo dominio (`ASSET_LIFECYCLE_STATUSES`), com transicoes reais de ativar/desativar.
 */
export function assetStateSteps(asset: PhysicalAsset): ObjectStateStep[] {
  return [
    {
      id: ASSET_LIFECYCLE_STATUSES.Active,
      label: LIFECYCLE_LABELS[ASSET_LIFECYCLE_STATUSES.Active],
      hint: `Cadastrado em ${formatDateTime(asset.createdAt) ?? ''}`.trim(),
    },
    {
      id: ASSET_LIFECYCLE_STATUSES.Inactive,
      label: LIFECYCLE_LABELS[ASSET_LIFECYCLE_STATUSES.Inactive],
      hint: asset.deactivatedAt
        ? `Desativado em ${formatDateTime(asset.deactivatedAt)}`
        : undefined,
    },
  ];
}

/** Historico somente com as marcas temporais persistidas do cadastro. */
export function assetActivityFacts(asset: PhysicalAsset): ActivityFact[] {
  const facts: ActivityFact[] = [
    { at: asset.createdAt, event: 'Ativo cadastrado' },
    { at: asset.updatedAt, event: 'Cadastro atualizado' },
  ];
  if (asset.deactivatedAt) {
    facts.push({ at: asset.deactivatedAt, event: 'Ativo desativado' });
  }
  return facts;
}

export function PhysicalAssetDetailPage() {
  const { assetId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useAssetCapabilities();
  const { resourceTypes } = useAssetResourceTypes();
  const canReadServiceOrders = useServiceOrderReadAccess();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setVersionConflict(false);
    try {
      const asset = await getPhysicalAsset(assetId);
      setState({ phase: 'ready', asset });
    } catch (error) {
      if (error instanceof AssetsApiError) {
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
          error instanceof AssetsApiError
            ? mapAssetErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o ativo.',
      });
    }
  }, [assetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleDeactivate() {
    if (state.phase !== 'ready') {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    try {
      const updated = await deactivatePhysicalAsset(state.asset.id, state.asset.version);
      setDeactivateOpen(false);
      setState({ phase: 'ready', asset: updated });
    } catch (error) {
      if (error instanceof AssetsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setActionError(VERSION_CONFLICT_MESSAGE);
      } else {
        setActionError(
          error instanceof AssetsApiError
            ? mapAssetErrorToMessage(error.code, error.status)
            : 'Não foi possível desativar o ativo.',
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
      const updated = await activatePhysicalAsset(state.asset.id, state.asset.version);
      setActivateOpen(false);
      setState({ phase: 'ready', asset: updated });
    } catch (error) {
      if (error instanceof AssetsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setActionError(VERSION_CONFLICT_MESSAGE);
      } else {
        setActionError(
          error instanceof AssetsApiError
            ? mapAssetErrorToMessage(error.code, error.status)
            : 'Não foi possível reativar o ativo.',
        );
      }
    } finally {
      setActionSubmitting(false);
    }
  }

  if (state.phase !== 'ready') {
    let phase: ObjectPagePhase = 'error';
    let phaseTitle = 'Ativo físico';
    let phaseMessage = 'Não foi possível carregar o ativo.';
    let onRetry: (() => void) | undefined;
    if (state.phase === 'loading') {
      phase = 'loading';
      phaseMessage = 'Carregando ativo…';
    } else if (state.phase === 'denied') {
      phase = 'denied';
      phaseMessage = 'Você não tem permissão para visualizar este ativo.';
    } else if (state.phase === 'not_found') {
      phase = 'empty';
      phaseTitle = 'Ativo não encontrado';
      phaseMessage = 'O servidor não encontrou este ativo.';
    } else {
      phaseMessage = state.message;
      onRetry = () => void reload();
    }
    return (
      <ModulePage layout="wide">
        <ModulePageHeader title="Ativo físico" />
        <EnterpriseObjectPage
          breadcrumb={[{ label: 'Ativos físicos', href: '/app/assets' }, { label: 'Ativo' }]}
          phase={phase}
          phaseTitle={phaseTitle}
          phaseMessage={phaseMessage}
          onRetry={phase === 'error' ? onRetry : undefined}
          header={null}
        />
      </ModulePage>
    );
  }

  const { asset } = state;
  const isActive = asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Active;
  const operationalStatus = resolveAssetOperationalStatus(asset);
  const resourceTypeName =
    resourceTypes.find((type) => type.code === asset.resourceTypeCode)?.name ?? null;
  const allocation = asset.currentAllocation;

  // Relacao real e autorizada: a alocacao vigente leva ao planejamento da OS.
  // Sem autorizacao de leitura de OS, a relacao desaparece por inteiro.
  const relations = buildAuthorizedRelations(
    allocation
      ? [
          {
            id: 'service-order',
            label: 'Ordem de serviço alocada',
            count: 1,
            to: `/app/service-orders/${allocation.serviceOrderId}/planning`,
            hint: allocation.orderNumber,
            allowed: canReadServiceOrders,
          },
        ]
      : [],
  );

  const primaryAction: ObjectAction | null = capabilities.canUpdate
    ? {
        id: 'edit',
        label: 'Editar cadastro',
        onSelect: () => {
          void navigate(`/app/assets/${asset.id}/edit`);
        },
      }
    : null;

  /**
   * Proxima acao a partir do estado REAL do ativo:
   * - inativo e operador autorizado: reativar o cadastro;
   * - ativo com alocacao vigente: aguardar a OS que detem o recurso;
   * - ativo disponivel: aguardar a alocacao, que acontece no planejamento da OS.
   */
  let nextAction: NextAction | null = null;
  if (!isActive && capabilities.canActivate) {
    nextAction = {
      kind: 'act',
      label: 'Reativar o ativo',
      description: 'O cadastro volta ao estado ativo e o recurso pode ser alocado novamente.',
      onSelect: () => setActivateOpen(true),
    };
  } else if (isActive && allocation) {
    nextAction = {
      kind: 'waiting',
      label: 'Aguardar a liberação da alocação',
      description: 'O recurso permanece alocado enquanto a ordem estiver em execução.',
      waitingOn: `Ordem de serviço ${allocation.orderNumber}`,
    };
  } else if (isActive) {
    nextAction = {
      kind: 'waiting',
      label: 'Aguardar alocação em ordem de serviço',
      description: 'A alocação de recurso físico pertence ao planejamento da ordem.',
      waitingOn: 'Planejamento da ordem de serviço',
    };
  }

  const metadata: ObjectMetadataField[] = [
    { label: 'Tipo de recurso', value: resourceTypeName ?? asset.resourceTypeCode },
    { label: 'Disponibilidade', value: operationalStatus.label },
    { label: 'Alocação vigente', value: allocation?.orderNumber ?? null },
    { label: 'Atualizado em', value: formatDateTime(asset.updatedAt) },
  ];

  /*
   * IDENTIDADE OPERACIONAL — separada do CADASTRO.
   *
   * A ficha do ativo respondia "title + campos": nome, codigo e tipo no mesmo plano da situacao e da
   * alocacao. Um ativo e um objeto OPERACIONAL, e o operador precisa ler em blocos distintos:
   *
   *   IDENTIDADE   o que este recurso E (codigo, nome, tipo, classificacao)
   *   ESTADO       em que ponto do ciclo ele esta (cadastro x disponibilidade)
   *   LOCALIZACAO  onde ele esta agora (unidade, alocacao vigente)
   *   PERFIL       o que so existe para veiculo (placa, chassi, modelo)
   *
   * `cadastro` e `disponibilidade` sao DIMENSOES INDEPENDENTES no dominio: um ativo ativo pode estar
   * indisponivel por alocacao. Separa-las em dois blocos nomeados e o que impede o operador de ler
   * "Ativo" e concluir "disponivel".
   */
  const identityFields: ObjectContextField[] = [
    { label: 'Código do ativo', value: asset.assetCode },
    { label: 'Nome', value: asset.name },
    { label: 'Tipo de recurso', value: resourceTypeName ?? asset.resourceTypeCode },
    { label: 'Classificação', value: asset.resourceTypeClassification },
  ];

  const stateFields: ObjectContextField[] = [
    {
      label: 'Situação cadastral',
      value: LIFECYCLE_LABELS[asset.lifecycleStatus],
    },
    { label: 'Disponibilidade', value: operationalStatus.label },
    { label: 'Detalhe da disponibilidade', value: operationalStatus.detail },
    { label: 'Cadastrado em', value: formatDateTime(asset.createdAt) },
    { label: 'Desativado em', value: formatDateTime(asset.deactivatedAt) },
  ];

  const locationFields: ObjectContextField[] = [
    { label: 'Unidade operacional', value: asset.unitId },
    ...(allocation
      ? [{ label: 'Alocação vigente', value: allocation.orderNumber }]
      : []),
    // O ativo NAO publica localizacao fisica nem responsavel: ver a declaracao de profundidade.
  ];

  const vehicleFields: ObjectContextField[] = [
    { label: 'Placa', value: asset.vehicle?.plate ?? null },
    { label: 'Chassi', value: asset.vehicle?.chassis ?? null },
    { label: 'Modelo', value: asset.vehicle?.model ?? null },
  ];

  /*
   * COMANDOS SEMANTICOS — a acao com a CONSEQUENCIA declarada.
   *
   * "Editar cadastro" e uma acao de registro; "Desativar ativo" e uma TRANSICAO de ciclo, e ela muda
   * o que o recurso pode fazer (deixa de ser alocavel). O operador precisa saber disso ANTES de
   * confirmar, e o dialogo de confirmacao continua sendo o lugar da consequencia irreversivel.
   */
  const commandEffects: Array<{ id: string; label: string; effect: string }> = [];
  if (primaryAction) {
    commandEffects.push({
      id: 'edit',
      label: primaryAction.label,
      effect: 'Altera nome e perfil do recurso. Não muda a situação nem a alocação.',
    });
  }
  if (isActive && capabilities.canDeactivate) {
    commandEffects.push({
      id: 'deactivate',
      label: 'Desativar ativo',
      effect: DEACTIVATION_CONSEQUENCE_MESSAGE,
    });
  }
  if (!isActive && capabilities.canActivate) {
    commandEffects.push({
      id: 'activate',
      label: 'Reativar o ativo',
      effect: 'O cadastro volta a ativo e o recurso pode ser alocado em ordens de serviço.',
    });
  }

  return (
    <ModulePage layout="wide">
      <EnterpriseObjectPage
        breadcrumb={[{ label: 'Ativos físicos', href: '/app/assets' }, { label: asset.assetCode }]}
        header={
          <EnterpriseObjectHeader
            reference={asset.assetCode}
            title={asset.name}
            subtitle={resourceTypeName}
            status={{
              label: LIFECYCLE_LABELS[asset.lifecycleStatus],
              tone: LIFECYCLE_TONES[asset.lifecycleStatus],
              description:
                !isActive && asset.deactivatedAt
                  ? `Desativado em ${formatDateTime(asset.deactivatedAt)}`
                  : undefined,
            }}
            metadata={metadata}
            primaryAction={primaryAction}
            destructiveActions={
              isActive && capabilities.canDeactivate
                ? [{ id: 'deactivate', label: 'Desativar ativo', onSelect: () => setDeactivateOpen(true) }]
                : []
            }
          />
        }
        stateFlow={
          <ObjectStateFlow
            steps={assetStateSteps(asset)}
            currentId={asset.lifecycleStatus}
            title="Situação cadastral do ativo"
          />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={assetActivityFacts(asset)}
              title="Histórico do ativo"
              emptyMessage="Este ativo não expõe histórico persistido além dos marcos do cadastro."
            />
          </ObjectPanel>
        }
      >
        {/*
          IDENTIDADE -> ESTADO -> LOCALIZACAO -> PERFIL, em blocos nomeados.
          A grade unica de contexto misturava as quatro camadas no mesmo plano; ver o comentario de
          `identityFields` para por que cadastro e disponibilidade NAO podem ler juntos.
        */}
        <ObjectContextBlock title="Identidade do recurso" fields={identityFields} columns={2} />
        <ObjectContextBlock title="Estado operacional" fields={stateFields} columns={2} />
        <ObjectContextBlock title="Unidade e alocação" fields={locationFields} columns={2} />
        {asset.vehicle ? (
          <ObjectContextBlock title="Perfil de veículo" fields={vehicleFields} columns={3} />
        ) : null}

        {versionConflict ? <AssetVersionConflictNotice onReload={() => void reload()} /> : null}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {/*
          COMANDOS SEMÂNTICOS — o que o operador PODE fazer, e o que cada um produz.
          Um botão de ciclo de vida sem a consequência declarada obriga o operador a adivinhar o
          efeito de uma transição que muda o que o recurso pode fazer.
        */}
        <ObjectPanel title="Comandos disponíveis">
          {commandEffects.length === 0 ? (
            <p className="m-0 text-sm text-gray-600">
              Seu perfil não tem comando autorizado para a situação atual deste ativo. A transição é do
              servidor.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {commandEffects.map((command) => (
                <li key={command.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[color:var(--color-text-primary)]">
                    {command.label}
                  </span>
                  <span className="text-[12px] text-[color:var(--color-text-secondary)]">
                    {command.effect}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ObjectPanel>

        {asset.operationalLifecycle ? (
          <ObjectPanel title="Vida operacional do recurso">
            <AssetOperationalLifecyclePanel lifecycle={asset.operationalLifecycle} />
          </ObjectPanel>
        ) : null}

        <ObjectPanel title="Disponibilidade do recurso">
          <p className="form-hint">
            Cadastro (ativo/inativo) e disponibilidade operacional são independentes. Um ativo
            ativo pode estar indisponível por alocação em ordem de serviço.
          </p>
          <p className="text-sm text-gray-700">{operationalStatus.label}</p>
        </ObjectPanel>

        {/*
          PROFUNDIDADE NÃO PUBLICADA — declarada, nunca inventada.

          A ficha do ativo é operacional, e o operador procura nela localização física, responsável e
          documentos. Nenhuma dessas três camadas tem fonte no payload de `PhysicalAsset`: o contrato
          publica identidade, tipo, situação, unidade, alocação vigente, perfil de veículo e a vida
          operacional derivada. Declarar é a única leitura honesta — esconder faria o operador
          concluir que o ativo não tem documento vinculado.
        */}
        <ObjectPanel title="Profundidade não publicada nesta leitura">
          <div className="flex flex-col gap-2">
            <UnavailableCapability
              title="Localização física"
              reason="O ativo publica a UNIDADE operacional e a alocação vigente, mas não um endereço ou ponto de guarda. Não há campo de localização no cadastro do recurso."
            />
            <UnavailableCapability
              title="Responsável pelo recurso"
              reason="O ativo não publica responsável direto. Quem responde pelo recurso em um período é o membro de mão de obra alocado na ordem de serviço, e essa leitura vive no planejamento da OS."
            >
              {allocation ? (
                <Link
                  to={`/app/service-orders/${allocation.serviceOrderId}/planning`}
                  className="text-brand-700 no-underline hover:underline"
                >
                  Abrir planejamento da {allocation.orderNumber}
                </Link>
              ) : null}
            </UnavailableCapability>
            <UnavailableCapability
              title="Documentos do ativo"
              reason="Não existe vínculo de documento publicado para ativos físicos. O módulo de documentos expõe vínculos para contrato e outras entidades, não para recurso físico."
            >
              <Link to="/app/documents" className="text-brand-700 no-underline hover:underline">
                Abrir documentos
              </Link>
            </UnavailableCapability>
          </div>
        </ObjectPanel>

        <p>
          <Link to="/app/assets">Voltar à lista</Link>
        </p>
      </EnterpriseObjectPage>

      <ConfirmDialog
        open={deactivateOpen}
        title="Desativar ativo"
        description={DEACTIVATION_CONSEQUENCE_MESSAGE}
        confirmLabel="Desativar"
        confirmDisabled={actionSubmitting}
        onCancel={() => setDeactivateOpen(false)}
        onConfirm={() => void handleDeactivate()}
      />

      <ConfirmDialog
        open={activateOpen}
        title="Reativar ativo"
        description="O ativo voltará ao status de cadastro ativo."
        confirmLabel="Reativar"
        confirmDisabled={actionSubmitting}
        onCancel={() => setActivateOpen(false)}
        onConfirm={() => void handleActivate()}
      />
    </ModulePage>
  );
}
