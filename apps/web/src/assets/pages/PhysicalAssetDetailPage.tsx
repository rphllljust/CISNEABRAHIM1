import { Link, useParams } from 'react-router-dom';
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
import { AssetLifecycleStatusBadge } from '../components/AssetLifecycleStatusBadge';
import { AssetOperationalLifecyclePanel } from '../components/AssetOperationalLifecycle';
import { AssetOperationalStatusCell } from '../components/AssetOperationalStatusCell';
import { AssetVersionConflictNotice } from '../components/AssetVersionConflictNotice';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { useAssetCapabilities } from '../hooks/useAssetCapabilities';
import { ASSET_LIFECYCLE_STATUSES, type PhysicalAsset } from '../types/physical-asset.types';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; asset: PhysicalAsset };

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('pt-BR');
}

export function PhysicalAssetDetailPage() {
  const { assetId = '' } = useParams();
  const { capabilities } = useAssetCapabilities();
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando ativo…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Ativo físico</h1>
        <p role="alert">Você não tem permissão para visualizar este ativo.</p>
        <Link to="/app/assets">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Ativo físico</h1>
        <p role="alert">Ativo não encontrado.</p>
        <Link to="/app/assets">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Ativo físico</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { asset } = state;
  const isActive = asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Active;

  return (
    <main id="main-content" className="shell-page assets-page">
      <header className="assets-page__header">
        <div>
          <p>
            <Link to="/app/assets">Ativos físicos</Link>
          </p>
          <h1>{asset.assetCode}</h1>
          <p>{asset.name}</p>
        </div>
        <div className="button-row">
          {capabilities.canUpdate ? (
            <Link to={`/app/assets/${asset.id}/edit`} className="button-link">
              Editar
            </Link>
          ) : null}
          {isActive && capabilities.canDeactivate ? (
            <button type="button" className="button-secondary" onClick={() => setDeactivateOpen(true)}>
              Desativar
            </button>
          ) : null}
          {!isActive && capabilities.canActivate ? (
            <button type="button" onClick={() => setActivateOpen(true)}>
              Reativar
            </button>
          ) : null}
        </div>
      </header>

      {versionConflict ? <AssetVersionConflictNotice onReload={() => void reload()} /> : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {asset.operationalLifecycle ? (
        <section className="assets-section" aria-label="Vida operacional do recurso">
          <AssetOperationalLifecyclePanel lifecycle={asset.operationalLifecycle} />
        </section>
      ) : null}

      <section className="assets-section" aria-labelledby="asset-status-heading">
        <h2 id="asset-status-heading">Status</h2>
        <p className="form-hint">
          Cadastro (ativo/inativo) e disponibilidade operacional são independentes. Um ativo ativo
          pode estar indisponível por alocação em ordem de serviço.
        </p>
        <dl className="assets-details">
          <div>
            <dt>Cadastro</dt>
            <dd>
              <AssetLifecycleStatusBadge status={asset.lifecycleStatus} />
            </dd>
          </div>
          <div>
            <dt>Disponibilidade operacional</dt>
            <dd>
              <AssetOperationalStatusCell asset={asset} />
            </dd>
          </div>
          <div>
            <dt>Desativado em</dt>
            <dd>{formatDateTime(asset.deactivatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="assets-section" aria-labelledby="asset-identification-heading">
        <h2 id="asset-identification-heading">Identificação</h2>
        <dl className="assets-details">
          <div>
            <dt>Tipo de recurso</dt>
            <dd>
              {asset.resourceTypeCode} ({asset.resourceTypeClassification})
            </dd>
          </div>
          <div>
            <dt>Unidade operacional</dt>
            <dd>{asset.unitId}</dd>
          </div>
          <div>
            <dt>Versão</dt>
            <dd>{asset.version}</dd>
          </div>
          <div>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(asset.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      {asset.vehicle ? (
        <section className="assets-section" aria-labelledby="asset-vehicle-heading">
          <h2 id="asset-vehicle-heading">Veículo</h2>
          <dl className="assets-details">
            <div>
              <dt>Placa</dt>
              <dd>{asset.vehicle.plate}</dd>
            </div>
            <div>
              <dt>Chassi</dt>
              <dd>{asset.vehicle.chassis ?? '—'}</dd>
            </div>
            <div>
              <dt>Modelo</dt>
              <dd>{asset.vehicle.model ?? '—'}</dd>
            </div>
          </dl>
        </section>
      ) : null}

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
