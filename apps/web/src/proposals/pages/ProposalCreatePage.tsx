import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { createProposal, ProposalsApiError } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { ProposalForm } from '../components/ProposalForm';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import {
  ModuleDeniedState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import {
  buildCreateProposalPayload,
  EMPTY_PROPOSAL_FORM,
  validateProposalForm,
  type ProposalFormFieldErrors,
  type ProposalFormValues,
} from '../utils/proposal-form-validation';

const CREATE_DESCRIPTION =
  'Abre a proposta comercial do Cliente com o tipo de preço, a composição e a validade desta versão.';

export function ProposalCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useProposalCapabilities();
  const [values, setValues] = useState<ProposalFormValues>(EMPTY_PROPOSAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<ProposalFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
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
        <ModulePageHeader title="Nova proposta" description={CREATE_DESCRIPTION} />
        <ModuleLoadingState title="Nova proposta" message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Nova proposta" description={CREATE_DESCRIPTION} />
        <ModuleDeniedState
          title="Nova proposta"
          message="Você não tem permissão para registrar propostas."
        />
        <p className="mt-3 mb-0">
          <Link className="button-link button-secondary" to="/app/proposals">
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

    const errors = validateProposalForm(values, 'create');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createProposal(buildCreateProposalPayload(values));
      void navigate(`/app/proposals/${created.proposal.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ProposalsApiError) {
        setSubmitError(mapProposalErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível registrar a proposta.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader title="Nova proposta" description={CREATE_DESCRIPTION} />
      <ProposalForm
        mode="create"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref="/app/proposals"
      />
    </ModulePage>
  );
}
