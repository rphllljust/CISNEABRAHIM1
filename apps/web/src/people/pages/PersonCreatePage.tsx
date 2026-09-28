import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import { PageHeader } from '../../ui';
import { PeopleApiError, createPerson } from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { PersonForm, type PersonFormValues } from '../components/PersonForm';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';

const EMPTY_VALUES: PersonFormValues = {
  legalName: '',
  preferredName: '',
  defaultLaborTypeCode: '',
  externalErpId: '',
};

const BACK_LINK_CLASS = 'text-sm font-medium text-brand-600 no-underline hover:text-brand-700';
const CREATE_DESCRIPTION = 'Cadastre a pessoa e defina a função operacional padrão do vínculo.';

/**
 * NOVA PESSOA — cadastro no contrato estruturado do CISNE.
 *
 * Nada da regra mudou: continua sendo obrigatório o nome legal, o payload de criação é o mesmo
 * (`legalName` + opcionais não vazios), o erro do servidor é mapeado pelo mesmo catálogo e a
 * proteção contra dupla ativação continua aqui.
 */
export function PersonCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = usePersonCapabilities();
  const submittingRef = useRef(false);

  const [values, setValues] = useState<PersonFormValues>(EMPTY_VALUES);
  const [laborTypes, setLaborTypes] = useState<Array<{ code: string; name: string }>>([]);
  const [legalNameError, setLegalNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void listLaborTypes(controller.signal)
      .then((items) => setLaborTypes(items))
      .catch(() => setLaborTypes([]));
    return () => controller.abort();
  }, []);

  if (capabilitiesLoading) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Nova pessoa" description={CREATE_DESCRIPTION} />
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Verificando permissões…
        </p>
      </main>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Nova pessoa" description={CREATE_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          Você não tem permissão para cadastrar Pessoas.
        </p>
        <p className="mt-3 mb-0">
          <Link to="/app/people" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </main>
    );
  }

  function handleChange(patch: Partial<PersonFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    if (patch.legalName !== undefined && legalNameError) {
      setLegalNameError(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    if (values.legalName.trim().length === 0) {
      setLegalNameError('Informe o nome legal.');
      setSubmitError(null);
      return;
    }

    submittingRef.current = true;
    setLegalNameError(null);
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createPerson({
        legalName: values.legalName.trim(),
        preferredName: values.preferredName.trim() || undefined,
        defaultLaborTypeCode: values.defaultLaborTypeCode || undefined,
        externalErpId: values.externalErpId.trim() || undefined,
      });
      void navigate(`/app/people/${created.id}`, { replace: true });
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      if (error instanceof PeopleApiError) {
        setSubmitError(mapPersonErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar a Pessoa.');
      }
    }
  }

  return (
    <main id="main-content" className="shell-page">
      <PageHeader title="Nova pessoa" description={CREATE_DESCRIPTION} />
      <PersonForm
        mode="create"
        values={values}
        laborTypes={laborTypes}
        legalNameError={legalNameError}
        submitError={submitError}
        submitting={submitting}
        onChange={handleChange}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref="/app/people"
      />
    </main>
  );
}
