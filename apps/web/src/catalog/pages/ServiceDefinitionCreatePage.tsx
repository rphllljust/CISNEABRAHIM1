import { Link, useNavigate } from 'react-router-dom';
import { useId, useState } from 'react';
import { CatalogApiError, createServiceDefinition } from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import { ServiceDefinitionForm, listFormBlockers } from '../components/ServiceDefinitionForm';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';
import { useCatalogReferenceData } from '../hooks/useCatalogReferenceData';
import { Alert, Button, PageHeader, StickyActionBar } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  createEmptyFormState,
  toCreatePayload,
  validateServiceDefinitionForm,
  type ServiceDefinitionFormState,
} from '../utils/catalog-form-state';

/**
 * BUILDER — nova definição de serviço.
 *
 * Cabeçalho com o que está sendo configurado, resumo da edição atual dentro do formulário,
 * seções com ação própria e barra de ação fixa. Nenhuma regra mudou: a validação, o payload e a
 * criação continuam sendo os mesmos de `catalog-form-state.ts` e da API do catálogo.
 */
export function ServiceDefinitionCreatePage() {
  const navigate = useNavigate();
  const formId = useId();
  const errorId = useId();
  const { capabilities, loading: capabilitiesLoading } = useCatalogCapabilities();
  const { data: referenceData, loading: referenceLoading } = useCatalogReferenceData();
  const [formState, setFormState] = useState<ServiceDefinitionFormState>(createEmptyFormState);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateServiceDefinitionForm>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mesma validação autoritativa, traduzida para o rodapé da barra: a ação principal nunca fica
  // desabilitada sem dizer o que falta.
  const blockers = listFormBlockers(formState, { includeCode: true });

  if (capabilitiesLoading || referenceLoading) {
    return (
      <ModulePage>
        <PageHeader title="Nova definição de serviço" />
        <p aria-busy="true" aria-live="polite" className="text-sm text-gray-500">
          Carregando formulário…
        </p>
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <PageHeader title="Nova definição de serviço" />
        <Alert tone="error">Você não tem permissão para criar definições.</Alert>
        <p className="mt-3">
          <Link
            to="/app/catalog"
            className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
          >
            Voltar à lista
          </Link>
        </p>
      </ModulePage>
    );
  }

  async function handleSubmit(): Promise<void> {
    const errors = validateServiceDefinitionForm(formState, { includeCode: true });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await createServiceDefinition(toCreatePayload(formState));
      void navigate(`/app/catalog/${created.serviceDefinitionId}/versions/${created.version}`, {
        replace: true,
      });
    } catch (error) {
      setSubmitError(
        error instanceof CatalogApiError
          ? mapCatalogErrorToMessage(error.code, error.status)
          : 'Não foi possível criar a definição.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <PageHeader
        title="Nova definição de serviço"
        description="Configure preço, recursos, mão de obra e evidências exigidas."
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
        state={formState}
        errors={fieldErrors}
        referenceData={referenceData}
        includeCode
        showInternalCost={capabilities.canCreate}
        onChange={setFormState}
      />

      <StickyActionBar
        note={
          blockers.length > 0
            ? `Faltam: ${blockers.join(', ')}.`
            : 'A publicação e a validação de regras são executadas exclusivamente pelo backend.'
        }
      >
        <Link to="/app/catalog" className="button-link button-secondary">
          Cancelar
        </Link>
        <Button
          type="button"
          disabled={submitting || blockers.length > 0}
          loading={submitting}
          loadingText="Salvando…"
          onClick={() => void handleSubmit()}
        >
          Criar rascunho
        </Button>
      </StickyActionBar>
    </ModulePage>
  );
}
