import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import { Button, Field, FormSection, Input, PageHeader, Select } from '../../ui';
import { PeopleApiError, createPerson } from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';

export function PersonCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = usePersonCapabilities();
  const legalNameId = useId();
  const preferredNameId = useId();
  const laborTypeId = useId();
  const externalErpIdId = useId();
  const formErrorId = useId();
  const legalNameErrorId = `${legalNameId}-error`;
  const submittingRef = useRef(false);

  const [legalName, setLegalName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [defaultLaborTypeCode, setDefaultLaborTypeCode] = useState('');
  const [externalErpId, setExternalErpId] = useState('');
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
        <p aria-busy="true" aria-live="polite">
          Verificando permissões…
        </p>
      </main>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <main id="main-content" className="shell-page">
        <h1>Nova Pessoa</h1>
        <p role="alert">Você não tem permissão para cadastrar Pessoas.</p>
        <Link to="/app/people">Voltar à lista</Link>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    if (legalName.trim().length === 0) {
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
        legalName: legalName.trim(),
        preferredName: preferredName.trim() || undefined,
        defaultLaborTypeCode: defaultLaborTypeCode || undefined,
        externalErpId: externalErpId.trim() || undefined,
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
    <main id="main-content" className="shell-page max-w-3xl">
      <PageHeader title="Nova pessoa" />

      <form
        className="grid gap-5"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        aria-describedby={submitError ? formErrorId : undefined}
      >
        {submitError ? (
          <p id={formErrorId} role="alert" className="form-error">
            {submitError}
          </p>
        ) : null}

        <FormSection title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome legal"
              htmlFor={legalNameId}
              required
              error={legalNameError ?? undefined}
            >
              <Input
                id={legalNameId}
                value={legalName}
                onChange={(event) => {
                  setLegalName(event.target.value);
                  if (legalNameError) {
                    setLegalNameError(null);
                  }
                }}
                required
                invalid={Boolean(legalNameError)}
                aria-describedby={legalNameError ? legalNameErrorId : undefined}
                disabled={submitting}
              />
            </Field>
            <Field label="Nome de uso" htmlFor={preferredNameId}>
              <Input
                id={preferredNameId}
                value={preferredName}
                onChange={(event) => setPreferredName(event.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Função operacional padrão" htmlFor={laborTypeId}>
              <Select
                id={laborTypeId}
                value={defaultLaborTypeCode}
                onChange={(event) => setDefaultLaborTypeCode(event.target.value)}
                disabled={submitting}
              >
                <option value="">Sem função padrão</option>
                {laborTypes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Referência externa (opcional)" htmlFor={externalErpIdId}>
              <Input
                id={externalErpIdId}
                value={externalErpId}
                onChange={(event) => setExternalErpId(event.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>
        </FormSection>

        <div className="button-row">
          <Button type="submit" loading={submitting} loadingText="Salvando…">
            Cadastrar
          </Button>
          <Link to="/app/people" className="button-link button-secondary">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
