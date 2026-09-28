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
  buildAuthorizedRelations,
  type NextAction,
  type ObjectAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
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
      <main id="main-content" className="shell-page">
        <EnterpriseObjectPage
          breadcrumb={[{ label: 'Ativos físicos', href: '/app/assets' }, { label: 'Ativo' }]}
          phase={phase}
          phaseTitle={phaseTitle}
          phaseMessage={phaseMessage}
          onRetry={phase === 'error' ? onRetry : undefined}
          header={null}
        />
      </main>
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

  const contextFields: ObjectContextField[] = [
    { label: 'Código do tipo', value: asset.resourceTypeCode },
    { label: 'Classificação', value: asset.resourceTypeClassification },
    { label: 'Unidade operacional', value: asset.unitId },
    {
      label: 'Detalhe da disponibilidade',
      value: operationalStatus.detail,
    },
    { label: 'Cadastrado em', value: formatDateTime(asset.createdAt) },
    { label: 'Desativado em', value: formatDateTime(asset.deactivatedAt) },
    { label: 'Placa', value: asset.vehicle?.plate ?? null },
    { label: 'Chassi', value: asset.vehicle?.chassis ?? null },
    { label: 'Modelo', value: asset.vehicle?.model ?? null },
  ];

  return (
    <main id="main-content" className="shell-page">
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
        {/* O contexto entra no corpo: a moldura do contrato nesta revisao nao renderiza o
            slot `context` (so breadcrumb, header, fluxo, proxima acao, relacoes e corpo). */}
        <ObjectContextBlock fields={contextFields} columns={3} />

        {versionConflict ? <AssetVersionConflictNotice onReload={() => void reload()} /> : null}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

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
    </main>
  );
}
