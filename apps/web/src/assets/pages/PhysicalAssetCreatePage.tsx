import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ModuleDeniedState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import { mapAssetErrorToMessage } from '../api/asset-error-messages';
import { AssetsApiError, createPhysicalAsset } from '../api/physical-assets-api';
import { AssetForm } from '../components/AssetForm';
import { useAssetCapabilities, useAssetResourceTypes } from '../hooks/useAssetCapabilities';
import { useRegisteredOperationalUnits } from '../hooks/useRegisteredOperationalUnits';
import {
  buildCreatePayload,
  validateAssetForm,
  type AssetFormFieldErrors,
  type AssetFormValues,
} from '../utils/asset-form-state';

const EMPTY_VALUES: AssetFormValues = {
  assetCode: '',
  resourceTypeId: '',
  name: '',
  unitId: '',
  plate: '',
  chassis: '',
  model: '',
};

const BACK_LINK_CLASS = 'text-sm font-medium text-brand-600 no-underline hover:text-brand-700';

/**
 * NOVO ATIVO FÍSICO — cadastro no contrato estruturado do CISNE.
 *
 * A página continua fazendo exatamente o que fazia: sonda a capability de criação, valida com
 * `validateAssetForm`, monta o payload com `buildCreatePayload` e navega para o detalhe. O que
 * mudou é a moldura: título com uma linha do que está sendo cadastrado, seções de negócio e a
 * ação principal sempre visível.
 */
export function PhysicalAssetCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useAssetCapabilities();
  const { resourceTypes, loading: resourceTypesLoading } = useAssetResourceTypes();
  const {
    units: operationalUnits,
    loading: operationalUnitsLoading,
    unavailable: operationalUnitsUnavailable,
  } = useRegisteredOperationalUnits();
  const [values, setValues] = useState<AssetFormValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<AssetFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (capabilitiesLoading) {
    return (
      <ModulePage>
        <ModulePageHeader
          title="Novo ativo físico"
          description="Cadastre uma instância física vinculada a um tipo de recurso do catálogo."
        />
        <ModuleLoadingState title="Novo ativo físico" message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <ModulePageHeader
          title="Novo ativo físico"
          description="Cadastre uma instância física vinculada a um tipo de recurso do catálogo."
        />
        <ModuleDeniedState
          title="Novo ativo físico"
          message="Você não tem permissão para cadastrar ativos."
        />
        <p className="mt-3 mb-0">
          <Link to="/app/assets" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </ModulePage>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validateAssetForm(values, resourceTypes, 'create');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createPhysicalAsset(buildCreatePayload(values, resourceTypes));
      void navigate(`/app/assets/${created.id}`, { replace: true });
    } catch (error) {
      if (error instanceof AssetsApiError) {
        setSubmitError(mapAssetErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar o ativo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Novo ativo físico"
        description="Cadastre uma instância física vinculada a um tipo de recurso do catálogo."
      />
      <AssetForm
        mode="create"
        values={values}
        resourceTypes={resourceTypes}
        resourceTypesLoading={resourceTypesLoading}
        operationalUnits={operationalUnits}
        operationalUnitsLoading={operationalUnitsLoading}
        operationalUnitsUnavailable={operationalUnitsUnavailable}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref="/app/assets"
      />
    </ModulePage>
  );
}
