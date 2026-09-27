import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { getProposal, ProposalsApiError, updateProposalDraft } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { ProposalForm } from '../components/ProposalForm';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import {
  PROPOSAL_VERSION_STATUSES,
} from '../types/proposal.types';
import {
  buildUpdateProposalPayload,
  createProposalItemRow,
  EMPTY_PROPOSAL_FORM,
  validateProposalForm,
  type ProposalFormFieldErrors,
  type ProposalFormValues,
} from '../utils/proposal-form-validation';

export function ProposalEditPage() {
  const { proposalId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useProposalCapabilities();
  const [values, setValues] = useState<ProposalFormValues>(EMPTY_PROPOSAL_FORM);
  const [rowVersion, setRowVersion] = useState(0);
  const [versionNumber, setVersionNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProposalFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setVersionConflict(false);
    try {
      const detail = await getProposal(proposalId);
      const version = detail.currentVersion;
      if (!version || version.status !== PROPOSAL_VERSION_STATUSES.Draft) {
        setCanEdit(false);
        setLoading(false);
        return;
      }
      setCanEdit(true);
      setRowVersion(version.rowVersion);
      setVersionNumber(version.versionNumber);
      setValues({
        clientId: detail.proposal.clientId,
        unitId: detail.proposal.unitId,
        title: detail.proposal.title,
        pricingStructure: version.pricingStructure,
        currencyCode: version.currencyCode,
        globalSalePrice: version.globalSalePrice ?? '',
        validUntil: version.validUntil ?? '',
        notes: version.notes ?? '',
        items: version.items.map((item) =>
          createProposalItemRow(item.description, item.lineSaleAmount ?? ''),
        ),
      });
    } catch (error) {
      setLoadError(
        error instanceof ProposalsApiError
          ? mapProposalErrorToMessage(error.code, error.status)
          : 'Não foi possível carregar a proposta.',
      );
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando proposta…
        </p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main id="main-content" className="shell-page">
        <p className="form-error" role="alert">
          {loadError}
        </p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  if (!capabilities.canUpdate || !canEdit) {
    return (
      <main id="main-content" className="shell-page">
        <h1>Editar proposta</h1>
        <p role="alert">
          Esta proposta não pode ser editada no status atual ou você não tem permissão.
        </p>
        <Link to={`/app/proposals/${proposalId}`}>Voltar ao detalhe</Link>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validateProposalForm(values, 'edit');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      await updateProposalDraft(
        proposalId,
        versionNumber,
        buildUpdateProposalPayload(values, rowVersion),
      );
      void navigate(`/app/proposals/${proposalId}`, { replace: true });
    } catch (error) {
      if (error instanceof ProposalsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setSubmitError(
        error instanceof ProposalsApiError
          ? mapProposalErrorToMessage(error.code, error.status)
          : 'Não foi possível salvar a proposta.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <h1>Editar proposta</h1>
      </header>
      {versionConflict ? <VersionConflictNotice onReload={() => void load()} /> : null}
      <ProposalForm
        mode="edit"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref={`/app/proposals/${proposalId}`}
      />
    </main>
  );
}
