import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { ContractsApiError, createContract } from '../api/contracts-api';
import { mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractFormFields, type ClientOption } from '../components/ContractFormFields';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  FieldError,
  StickyActionBar,
} from '../../ui';
import {
  ModuleDeniedState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import {
  buildCreateContractPayload,
  EMPTY_CONTRACT_FORM,
  validateContractCreateForm,
} from '../utils/contract-form-values';

const CREATE_DESCRIPTION =
  'Cadastre o contrato comercial com o Cliente, a vigência e as condições de pagamento.';

/** Link de cancelamento com a mesma linguagem do botão secundário (sem biblioteca nova). */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-gray-300 ring-inset hover:bg-gray-50';

export function ContractsCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useContractCapabilities();
  const [values, setValues] = useState({ ...EMPTY_CONTRACT_FORM });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void listClients({ limit: 100, offset: 0 }, controller.signal)
      .then((response) => {
        setClients(
          response.items.map((client) => ({
            id: client.id,
            label: client.tradeName || client.legalName,
          })),
        );
      })
      .catch(() => setClients([]))
      .finally(() => {
        if (!controller.signal.aborted) {
          setClientsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (capabilitiesLoading) {
    return (
      <ModulePage>
        <ModulePageHeader title="Novo contrato" description={CREATE_DESCRIPTION} />
        <ModuleLoadingState title="Novo contrato" message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Novo contrato" description={CREATE_DESCRIPTION} />
        <ModuleDeniedState
          title="Novo contrato"
          message="Você não tem permissão para cadastrar contratos."
        />
        <p className="mt-3 mb-0">
          <Link to="/app/contracts" className={SECONDARY_LINK_CLASS}>
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

    const errors = validateContractCreateForm(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createContract(buildCreateContractPayload(values));
      void navigate(`/app/contracts/${created.contract.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ContractsApiError) {
        setSubmitError(mapContractErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar o contrato.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader title="Novo contrato" description={CREATE_DESCRIPTION} />
      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-col gap-3"
        aria-describedby={submitError ? 'contract-create-error' : undefined}
      >
        {submitError ? (
          <div className="mb-1">
            <FieldError id="contract-create-error">{submitError}</FieldError>
          </div>
        ) : null}

        <BuilderSummary
          items={[
            { label: 'Número', value: values.contractNumber.trim() || null },
            { label: 'Título', value: values.title.trim() || null },
            { label: 'Vigência', value: values.validFrom || null },
            { label: 'Vigência final', value: values.validTo || null },
            { label: 'Moeda', value: values.currencyCode.trim().toUpperCase() || null },
          ]}
        />

        <BuilderSection
          title="Dados do contrato"
          description="Cliente, unidade, identificação comercial e vigência desta versão."
        >
          <ContractFormFields
            mode="create"
            values={values}
            clients={clients}
            clientsLoading={clientsLoading}
            disabled={submitting}
            fieldErrors={fieldErrors}
            onChange={setValues}
          />
        </BuilderSection>

        <StickyActionBar note="Somente o número, o título, o cliente e a vigência inicial são obrigatórios.">
          <Link to="/app/contracts" className={SECONDARY_LINK_CLASS}>
            Cancelar
          </Link>
          <Button type="submit" disabled={submitting} loading={submitting} loadingText="Cadastrando">
            Cadastrar contrato
          </Button>
        </StickyActionBar>
      </form>
    </ModulePage>
  );
}
