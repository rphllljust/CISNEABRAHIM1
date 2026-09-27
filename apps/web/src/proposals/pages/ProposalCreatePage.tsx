import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { createProposal, ProposalsApiError } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { ProposalForm } from '../components/ProposalForm';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import {
  buildCreateProposalPayload,
  EMPTY_PROPOSAL_FORM,
  validateProposalForm,
  type ProposalFormFieldErrors,
  type ProposalFormValues,
} from '../utils/proposal-form-validation';

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
      <main id="main-content" className="shell-page requests-page">
        <p className="text-sm text-gray-500" aria-busy="true" aria-live="polite">
          Verificando permissões…
        </p>
      </main>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <main id="main-content" className="shell-page requests-page">
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-gray-900">Nova proposta</h1>
        <p className="text-sm text-red-700" role="alert">
          Você não tem permissão para registrar propostas.
        </p>
        <Link className="button-link button-secondary" to="/app/proposals">
          Voltar à lista
        </Link>
      </main>
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
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-gray-900">Nova proposta</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Abre a proposta comercial do Cliente com o tipo de preço, a composição e a validade
            desta versão.
          </p>
        </div>
      </header>
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
    </main>
  );
}
