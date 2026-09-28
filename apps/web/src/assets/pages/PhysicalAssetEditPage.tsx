import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../ui';
import { mapAssetErrorToMessage } from '../api/asset-error-messages';
import { AssetsApiError, getPhysicalAsset, updatePhysicalAsset } from '../api/physical-assets-api';
import { AssetForm } from '../components/AssetForm';
import { AssetVersionConflictNotice } from '../components/AssetVersionConflictNotice';
import { useAssetCapabilities, useAssetResourceTypes } from '../hooks/useAssetCapabilities';
import type { PhysicalAsset } from '../types/physical-asset.types';
import {
  assetToFormValues,
  buildUpdatePayload,
  validateAssetForm,
  type AssetFormFieldErrors,
  type AssetFormValues,
} from '../utils/asset-form-state';

type EditState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; asset: PhysicalAsset; values: AssetFormValues };

const BACK_LINK_CLASS = 'text-sm font-medium text-brand-600 no-underline hover:text-brand-700';
const EDIT_DESCRIPTION =
  'Atualize o nome e os dados do veículo. Tipo de recurso e unidade operacional são definidos no cadastro.';

/**
 * EDITAR ATIVO FÍSICO — mesma moldura estruturada do cadastro.
 *
 * A edição altera o que o contrato permite alterar (nome e perfil de veículo) e MOSTRA, como
 * fato somente leitura, a classificação e a disponibilidade que não se editam aqui: tipo de
 * recurso, unidade, situação e a ordem de serviço que detém o ativo. Nenhuma regra, validação ou
 * payload mudou — `validateAssetForm`, `buildUpdatePayload` e o tratamento de conflito de versão
 * continuam exatamente os mesmos.
 */
export function PhysicalAssetEditPage() {
  const { assetId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useAssetCapabilities();
  const { resourceTypes, loading: resourceTypesLoading } = useAssetResourceTypes();
  const [state, setState] = useState<EditState>({ phase: 'loading' });
  const [fieldErrors, setFieldErrors] = useState<AssetFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setSubmitError(null);
    setVersionConflict(false);
    try {
      const asset = await getPhysicalAsset(assetId);
      setState({ phase: 'ready', asset, values: assetToFormValues(asset) });
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar ativo" description={EDIT_DESCRIPTION} />
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Carregando ativo…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar ativo" description={EDIT_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          Você não tem permissão para editar este ativo.
        </p>
        <p className="mt-3 mb-0">
          <Link to="/app/assets" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar ativo" description={EDIT_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          Ativo não encontrado.
        </p>
        <p className="mt-3 mb-0">
          <Link to="/app/assets" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar ativo" description={EDIT_DESCRIPTION} />
        <p
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
          role="alert"
        >
          {state.message}
        </p>
        <p className="mt-3 mb-0">
          <button
            type="button"
            onClick={() => void reload()}
            className="text-sm font-medium text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            Tentar novamente
          </button>
        </p>
      </main>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar ativo" description={EDIT_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          Você não tem permissão para editar ativos.
        </p>
        <p className="mt-3 mb-0">
          <Link to={`/app/assets/${assetId}`} className={BACK_LINK_CLASS}>
            Voltar ao detalhe
          </Link>
        </p>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || state.phase !== 'ready') {
      return;
    }

    const errors = validateAssetForm(state.values, resourceTypes, 'edit');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const updated = await updatePhysicalAsset(
        state.asset.id,
        buildUpdatePayload(state.asset.version, state.values, resourceTypes),
      );
      void navigate(`/app/assets/${updated.id}`, { replace: true });
    } catch (error) {
      if (error instanceof AssetsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setSubmitError(mapAssetErrorToMessage(error.code, error.status));
      } else {
        setSubmitError(
          error instanceof AssetsApiError
            ? mapAssetErrorToMessage(error.code, error.status)
            : 'Não foi possível salvar o ativo.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="shell-page">
      <PageHeader
        title={`Editar ${state.asset.assetCode}`}
        description={EDIT_DESCRIPTION}
      />
      {versionConflict ? <AssetVersionConflictNotice onReload={() => void reload()} /> : null}
      <AssetForm
        mode="edit"
        values={state.values}
        resourceTypes={resourceTypes}
        resourceTypesLoading={resourceTypesLoading}
        asset={state.asset}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={(values) => setState({ ...state, values })}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref={`/app/assets/${assetId}`}
      />
    </main>
  );
}
