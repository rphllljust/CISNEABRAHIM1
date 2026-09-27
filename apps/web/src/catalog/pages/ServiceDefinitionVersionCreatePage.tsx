import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  CatalogApiError,
  createServiceDefinitionVersion,
  getServiceDefinition,
  getServiceDefinitionVersion,
} from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import { ServiceDefinitionForm, listFormBlockers } from '../components/ServiceDefinitionForm';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';
import { useCatalogReferenceData } from '../hooks/useCatalogReferenceData';
import { Alert, Button, PageHeader, StickyActionBar } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  createEmptyFormState,
  formStateFromVersion,
  toVersionMutationPayload,
  validateServiceDefinitionForm,
  type ServiceDefinitionFormState,
} from '../utils/catalog-form-state';

type PageState =
  | { phase: 'loading' }
  | { phase: 'blocked'; reason: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; formState: ServiceDefinitionFormState; sourceVersion: number | null };

/**
 * BUILDER — nova versão do serviço.
 *
 * A base copiada da versão publicada é dita no cabeçalho (contexto real da edição) e o builder
 * edita a mesma estrutura das outras telas do catálogo.
 */
export function ServiceDefinitionVersionCreatePage() {
  const { definitionId = '' } = useParams();
  const navigate = useNavigate();
  const formId = useId();
  const errorId = useId();
  const { capabilities } = useCatalogCapabilities();
  const { data: referenceData, loading: referenceLoading } = useCatalogReferenceData();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateServiceDefinitionForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const definition = await getServiceDefinition(definitionId);
      if (definition.currentDraftVersion !== null) {
        setState({
          phase: 'blocked',
          reason: `Já existe o rascunho v${definition.currentDraftVersion}. Publique ou edite o rascunho atual antes de criar outra versão.`,
        });
        return;
      }

      const sourceVersion = definition.latestPublishedVersion;
      if (sourceVersion) {
        const version = await getServiceDefinitionVersion(definitionId, sourceVersion);
        setState({
          phase: 'ready',
          formState: formStateFromVersion(version),
          sourceVersion,
        });
        return;
      }

      setState({ phase: 'ready', formState: createEmptyFormState(), sourceVersion: null });
    } catch (error) {
      setState({
        phase: 'error',
        message:
          error instanceof CatalogApiError
            ? mapCatalogErrorToMessage(error.code, error.status)
            : 'Não foi possível preparar a nova versão.',
      });
    }
  }, [definitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const blockers =
    state.phase === 'ready' ? listFormBlockers(state.formState, { includeCode: false }) : [];

  if (state.phase === 'loading' || referenceLoading) {
    return (
      <ModulePage>
        <PageHeader title="Criar nova versão" />
        <p aria-busy="true" aria-live="polite" className="text-sm text-gray-500">
          Preparando nova versão…
        </p>
      </ModulePage>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <ModulePage>
        <PageHeader title="Criar nova versão" />
        <Alert tone="error">Você não tem permissão para criar versões.</Alert>
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

  if (state.phase === 'blocked' || state.phase === 'error') {
    return (
      <ModulePage>
        <PageHeader title="Criar nova versão" />
        <Alert tone={state.phase === 'blocked' ? 'warning' : 'error'}>
          {state.phase === 'blocked' ? state.reason : state.message}
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
      const payload = {
        ...toVersionMutationPayload(readyState.formState),
        ...(readyState.sourceVersion ? { sourceVersion: readyState.sourceVersion } : {}),
      };
      const created = await createServiceDefinitionVersion(definitionId, payload);
      void navigate(`/app/catalog/${definitionId}/versions/${created.version}`, { replace: true });
    } catch (error) {
      setSubmitError(
        error instanceof CatalogApiError
          ? mapCatalogErrorToMessage(error.code, error.status)
          : 'Não foi possível criar a nova versão.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <PageHeader
        title="Criar nova versão"
        description="Configure preço, recursos, mão de obra e evidências exigidas."
        meta={
          state.sourceVersion ? (
            <span role="note">
              Base inicial copiada da versão publicada v{state.sourceVersion}. Ajuste os campos antes
              de salvar o rascunho.
            </span>
          ) : (
            <span role="note">
              Sem versão publicada anterior: a nova versão começa vazia, exceto pelos padrões do
              catálogo.
            </span>
          )
        }
        className="mb-4"
      />

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
            : 'O rascunho da nova versão é validado e criado pelo servidor.'
        }
      >
        <Link to={`/app/catalog/${definitionId}`} className="button-link button-secondary">
          Cancelar
        </Link>
        <Button
          type="button"
          disabled={submitting || blockers.length > 0}
          loading={submitting}
          loadingText="Criando…"
          onClick={() => void handleSubmit()}
        >
          Criar rascunho da nova versão
        </Button>
      </StickyActionBar>
    </ModulePage>
  );
}
