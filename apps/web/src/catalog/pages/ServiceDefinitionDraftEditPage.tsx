import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  CatalogApiError,
  getServiceDefinition,
  getServiceDefinitionVersion,
  updateServiceDefinitionDraft,
} from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import { ServiceDefinitionForm, listFormBlockers } from '../components/ServiceDefinitionForm';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { VersionStatusBadge } from '../components/VersionStatusBadge';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';
import { useCatalogReferenceData } from '../hooks/useCatalogReferenceData';
import { VERSION_STATUSES } from '../types/service-catalog.types';
import { Alert, Button, PageHeader, StickyActionBar } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  formStateFromVersion,
  toUpdateDraftPayload,
  validateServiceDefinitionForm,
  type ServiceDefinitionFormState,
} from '../utils/catalog-form-state';

type EditState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_editable' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; formState: ServiceDefinitionFormState; lineageVersion: number; version: number };

/**
 * BUILDER — edição do rascunho.
 *
 * O status de versão é do domínio e continua no cabeçalho; o restante da tela é o mesmo builder
 * do catálogo (resumo da edição, seções com ação própria, barra de ação sempre visível).
 */
export function ServiceDefinitionDraftEditPage() {
  const { definitionId = '', versionNumber = '' } = useParams();
  const parsedVersion = Number(versionNumber);
  const navigate = useNavigate();
  const formId = useId();
  const errorId = useId();
  const { capabilities } = useCatalogCapabilities();
  const { data: referenceData, loading: referenceLoading } = useCatalogReferenceData();
  const [state, setState] = useState<EditState>({ phase: 'loading' });
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateServiceDefinitionForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setVersionConflict(false);
    try {
      const [definition, version] = await Promise.all([
        getServiceDefinition(definitionId),
        getServiceDefinitionVersion(definitionId, parsedVersion),
      ]);
      if (version.status !== VERSION_STATUSES.Draft) {
        setState({ phase: 'not_editable' });
        return;
      }
      setState({
        phase: 'ready',
        formState: formStateFromVersion(version),
        lineageVersion: definition.version,
        version: version.version,
      });
    } catch (error) {
      if (error instanceof CatalogApiError && error.kind === 'denied') {
        setState({ phase: 'denied' });
        return;
      }
      setState({
        phase: 'error',
        message:
          error instanceof CatalogApiError
            ? mapCatalogErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o rascunho.',
      });
    }
  }, [definitionId, parsedVersion]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const blockers =
    state.phase === 'ready' ? listFormBlockers(state.formState, { includeCode: false }) : [];

  if (state.phase === 'loading' || referenceLoading) {
    return (
      <ModulePage>
        <PageHeader title="Editar rascunho" />
        <p aria-busy="true" aria-live="polite" className="text-sm text-gray-500">
          Carregando rascunho…
        </p>
      </ModulePage>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <ModulePage>
        <PageHeader title="Editar rascunho" />
        <Alert tone="error">Você não tem permissão para editar rascunhos.</Alert>
        <p className="mt-3">
          <Link
            to={`/app/catalog/${definitionId}`}
            className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
          >
            Voltar à definição
          </Link>
        </p>
      </ModulePage>
    );
  }

  if (state.phase === 'not_editable') {
    return (
      <ModulePage>
        <PageHeader title="Editar rascunho" />
        <Alert tone="warning">
          Apenas versões em rascunho podem ser editadas. Versões publicadas exigem criação de nova
          versão.
        </Alert>
        <p className="mt-3">
          <Link
            to={`/app/catalog/${definitionId}/versions/${parsedVersion}`}
            className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
          >
            Ver versão
          </Link>
        </p>
      </ModulePage>
    );
  }

  if (state.phase === 'denied' || state.phase === 'error') {
    return (
      <ModulePage>
        <PageHeader title="Editar rascunho" />
        <Alert tone="error">
          {state.phase === 'denied' ? 'Acesso negado.' : state.message}
        </Alert>
        <p className="mt-3">
          <Link
            to={`/app/catalog/${definitionId}`}
            className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
          >
            Voltar à definição
          </Link>
        </p>
      </ModulePage>
    );
  }

  async function handleSubmit(): Promise<void> {
    if (state.phase !== 'ready') {
      return;
    }
    const readyState = state;

    const errors = validateServiceDefinitionForm(readyState.formState, { includeCode: false });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      await updateServiceDefinitionDraft(
        definitionId,
        readyState.version,
        toUpdateDraftPayload(readyState.formState, readyState.lineageVersion),
      );
      void navigate(`/app/catalog/${definitionId}/versions/${readyState.version}`, { replace: true });
    } catch (error) {
      if (error instanceof CatalogApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setSubmitError(
        error instanceof CatalogApiError
          ? mapCatalogErrorToMessage(error.code, error.status)
          : 'Não foi possível salvar o rascunho.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <PageHeader
        title={`Editar rascunho v${state.version}`}
        description="Configure preço, recursos, mão de obra e evidências exigidas."
        meta={<VersionStatusBadge status={VERSION_STATUSES.Draft} />}
        className="mb-4"
      />

      {versionConflict ? (
        <div className="mb-3">
          <VersionConflictNotice onReload={() => void reload()} />
        </div>
      ) : null}
      {submitError ? (
        <div className="mb-3">
          <Alert tone="error" id={errorId}>
            {submitError}
          </Alert>
        </div>
      ) : null}

      <ServiceDefinitionForm
        formId={formId}
        state={state.formState}
        errors={fieldErrors}
        referenceData={referenceData}
        includeCode={false}
        showInternalCost={capabilities.canUpdate}
        onChange={(formState) => setState({ ...state, formState })}
      />

      <StickyActionBar
        note={
          blockers.length > 0
            ? `Faltam: ${blockers.join(', ')}.`
            : 'Salvar mantém a versão em rascunho; a publicação é feita na tela da versão.'
        }
      >
        <Link
          to={`/app/catalog/${definitionId}/versions/${state.version}`}
          className="button-link button-secondary"
        >
          Cancelar
        </Link>
        <Button
          type="button"
          disabled={submitting || blockers.length > 0}
          loading={submitting}
          loadingText="Salvando…"
          onClick={() => void handleSubmit()}
        >
          Salvar rascunho
        </Button>
      </StickyActionBar>
    </ModulePage>
  );
}
