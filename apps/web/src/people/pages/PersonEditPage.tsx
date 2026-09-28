import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import { PageHeader } from '../../ui';
import { getPerson, PeopleApiError, updatePerson } from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { PersonForm, type PersonFormValues } from '../components/PersonForm';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import type { Person } from '../types/person.types';

const BACK_LINK_CLASS = 'text-sm font-medium text-brand-600 no-underline hover:text-brand-700';
const EDIT_DESCRIPTION =
  'Atualize identificação e vínculo. Situação e inativação são tratadas no detalhe da pessoa.';

/**
 * EDITAR PESSOA — mesma moldura estruturada do cadastro.
 *
 * A edição mostra, como fato persistido, o código e a situação da pessoa (que não se editam
 * aqui) e mantém intactos a validação do nome legal, o payload de atualização com `version`, o
 * mapeamento de erro e a navegação para o detalhe.
 */
export function PersonEditPage() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = usePersonCapabilities();

  const [person, setPerson] = useState<Person | null>(null);
  const [values, setValues] = useState<PersonFormValues>({
    legalName: '',
    preferredName: '',
    defaultLaborTypeCode: '',
    externalErpId: '',
  });
  const [laborTypes, setLaborTypes] = useState<Array<{ code: string; name: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getPerson(personId, controller.signal), listLaborTypes(controller.signal)])
      .then(([loaded, types]) => {
        setPerson(loaded);
        setValues({
          legalName: loaded.legalName,
          preferredName: loaded.preferredName ?? '',
          defaultLaborTypeCode: loaded.defaultLaborTypeCode ?? '',
          externalErpId: loaded.externalErpId ?? '',
        });
        setLaborTypes(types);
      })
      .catch((error: unknown) => {
        if (error instanceof PeopleApiError) {
          setLoadError(mapPersonErrorToMessage(error.code, error.status));
        } else {
          setLoadError('Não foi possível carregar a Pessoa.');
        }
      });
    return () => controller.abort();
  }, [personId]);

  if (capabilitiesLoading || (!person && !loadError)) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Carregando…
        </p>
      </main>
    );
  }

  if (loadError || !person) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          {loadError ?? 'Pessoa não encontrada.'}
        </p>
        <p className="mt-3 mb-0">
          <Link to="/app/people" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </main>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <main id="main-content" className="shell-page">
        <PageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <p
          role="alert"
          className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          Você não tem permissão para editar Pessoas.
        </p>
        <p className="mt-3 mb-0">
          <Link to={`/app/people/${person.id}`} className={BACK_LINK_CLASS}>
            Voltar ao detalhe
          </Link>
        </p>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) {
      return;
    }
    const currentPerson = person;
    if (submitting || values.legalName.trim().length === 0) {
      setSubmitError('Informe o nome legal.');
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const updated = await updatePerson(currentPerson.id, {
        version: currentPerson.version,
        legalName: values.legalName.trim(),
        preferredName: values.preferredName.trim() || null,
        defaultLaborTypeCode: values.defaultLaborTypeCode || null,
        externalErpId: values.externalErpId.trim() || null,
      });
      void navigate(`/app/people/${updated.id}`, { replace: true });
    } catch (error) {
      setSubmitError(
        error instanceof PeopleApiError
          ? mapPersonErrorToMessage(error.code, error.status)
          : 'Não foi possível salvar a Pessoa.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="shell-page">
      <PageHeader
        title={`Editar ${person.preferredName ?? person.legalName}`}
        description={EDIT_DESCRIPTION}
        meta={<span className="font-mono text-xs text-gray-500">{person.memberCode}</span>}
      />
      <PersonForm
        mode="edit"
        values={values}
        laborTypes={laborTypes}
        submitError={submitError}
        submitting={submitting}
        person={person}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref={`/app/people/${person.id}`}
      />
    </main>
  );
}
