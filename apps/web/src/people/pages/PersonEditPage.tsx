import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
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
      <ModulePage>
        <ModulePageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <ModuleLoadingState title="Editar pessoa" message="Carregando…" />
      </ModulePage>
    );
  }

  if (loadError || !person) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <ModuleErrorState
          title="Editar pessoa"
          message={loadError ?? 'Pessoa não encontrada.'}
          retryable={false}
        />
        <p className="mt-3 mb-0">
          <Link to="/app/people" className={BACK_LINK_CLASS}>
            Voltar à lista
          </Link>
        </p>
      </ModulePage>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar pessoa" description={EDIT_DESCRIPTION} />
        <ModuleDeniedState
          title="Editar pessoa"
          message="Você não tem permissão para editar Pessoas."
        />
        <p className="mt-3 mb-0">
          <Link to={`/app/people/${person.id}`} className={BACK_LINK_CLASS}>
            Voltar ao detalhe
          </Link>
        </p>
      </ModulePage>
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
    <ModulePage>
      <ModulePageHeader
        title={`Editar ${person.preferredName ?? person.legalName}`}
        description={EDIT_DESCRIPTION}
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
    </ModulePage>
  );
}
