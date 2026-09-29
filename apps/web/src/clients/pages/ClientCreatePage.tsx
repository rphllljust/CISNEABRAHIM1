import { Link, useNavigate } from 'react-router-dom';
import { useId, useState, type FormEvent } from 'react';
import { ClientsApiError, createClient } from '../api/clients-api';
import { mapClientErrorToMessage } from '../api/client-error-messages';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { maskCnpjInput } from '../utils/format-cnpj';
import { buildCreatePayload, validateCreateClientForm, type ClientFormFieldErrors } from '../utils/client-form-validation';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  Field,
  Input,
  StickyActionBar,
} from '../../ui';
import { ModulePage, ModulePageHeader, ModuleStatePage, ModuleLoadingState, ModuleDeniedState } from '../../ui/module-layout';

/**
 * Link de cancelamento com a mesma linguagem do botao secundario — padrao ja usado por
 * `PersonForm` e `PurchaseOrderForm`. Sem biblioteca nova.
 */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-[var(--spacing-touch)] items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

export function ClientCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useClientCapabilities();
  const legalNameId = useId();
  const tradeNameId = useId();
  const taxIdId = useId();
  const externalErpIdId = useId();
  const contactNameId = useId();
  const contactEmailId = useId();
  const contactPhoneId = useId();
  const formErrorId = useId();

  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [externalErpId, setExternalErpId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClientFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (capabilitiesLoading) {
    return (
      <ModuleStatePage title="Novo Cliente">
        <ModuleLoadingState message="Verificando permissões para cadastrar Clientes…" />
      </ModuleStatePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModuleStatePage title="Novo Cliente">
        <ModuleDeniedState message="Você não tem permissão para cadastrar Clientes." />
      </ModuleStatePage>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validateCreateClientForm({
      legalName,
      taxId,
      contactName,
      contactEmail,
      contactPhone,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createClient(
        buildCreatePayload({
          legalName,
          tradeName,
          taxId,
          externalErpId,
          contactName,
          contactEmail,
          contactPhone,
        }),
      );
      void navigate(`/app/clients/${created.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ClientsApiError) {
        setSubmitError(mapClientErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível cadastrar o Cliente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Novo Cliente"
        description="Cadastro de pessoa jurídica com CNPJ e contato operacional obrigatório."
      />

      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="flex flex-col gap-3"
        aria-describedby={submitError ? formErrorId : undefined}
      >
        {submitError ? (
          <p
            id={formErrorId}
            role="alert"
            className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
          >
            {submitError}
          </p>
        ) : null}

        {/*
          RESUMO DA PROPRIA EDICAO: o operador confere o que ja preencheu sem reler o formulario.
          Mesmo primitivo dos demais cadastros do CISNE (`PersonForm`, `PurchaseOrderForm`).
        */}
        <BuilderSummary
          items={[
            { label: 'Razão social', value: legalName.trim() || null },
            { label: 'Nome fantasia', value: tradeName.trim() || null },
            { label: 'CNPJ', value: taxId.trim() || null },
            { label: 'Contato', value: contactName.trim() || null },
          ]}
        />

        <fieldset
          disabled={submitting}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          aria-label="Dados do cliente"
        >
          {/*
            DUAS COLUNAS NO DESKTOP. Antes eram campos `full-width` empilhados um por linha:
            em 1440px cada input atravessava a tela inteira, a hierarquia sumia e o formulario
            nao cabia na primeira dobra. Razao social e nome fantasia sao fatos irmaos e dividem
            a linha; CNPJ e referencia externa dividem a seguinte.
          */}
          <BuilderSection
            title="Identificação jurídica"
            description="Razão social e CNPJ identificam a pessoa jurídica no ERP."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Razão social"
                htmlFor={legalNameId}
                required
                error={fieldErrors.legalName ?? undefined}
              >
                <Input
                  id={legalNameId}
                  value={legalName}
                  onChange={(event) => setLegalName(event.target.value)}
                  required
                  invalid={Boolean(fieldErrors.legalName)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Nome fantasia (opcional)" htmlFor={tradeNameId}>
                <Input
                  id={tradeNameId}
                  value={tradeName}
                  onChange={(event) => setTradeName(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="CNPJ" htmlFor={taxIdId} required error={fieldErrors.taxId ?? undefined}>
                <Input
                  id={taxIdId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={taxId}
                  onChange={(event) => setTaxId(maskCnpjInput(event.target.value))}
                  required
                  invalid={Boolean(fieldErrors.taxId)}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Referência externa (opcional)"
                htmlFor={externalErpIdId}
                hint="Identificador do cliente em outro sistema, quando existir."
              >
                <Input
                  id={externalErpIdId}
                  value={externalErpId}
                  onChange={(event) => setExternalErpId(event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>

          <BuilderSection
            title="Contato operacional"
            description="Quem a operação procura para tratar pedidos, medições e cobrança."
            footer={
              fieldErrors.operationalContact ? (
                <p className="m-0 text-xs text-red-700" role="alert">
                  {fieldErrors.operationalContact}
                </p>
              ) : (
                <p className="m-0 text-xs text-gray-500">
                  Informe pelo menos e-mail ou telefone utilizável.
                </p>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome do contato" htmlFor={contactNameId} required>
                <Input
                  id={contactNameId}
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="E-mail" htmlFor={contactEmailId}>
                <Input
                  id={contactEmailId}
                  type="email"
                  autoComplete="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Telefone" htmlFor={contactPhoneId}>
                <Input
                  id={contactPhoneId}
                  type="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>
        </fieldset>

        {/* ACTION BAR: a acao principal acompanha a rolagem em vez de ficar no fim da pagina. */}
        <StickyActionBar note="Somente razão social, CNPJ e nome do contato são obrigatórios; informe e-mail ou telefone.">
          <Link to="/app/clients" className={SECONDARY_LINK_CLASS}>
            Cancelar
          </Link>
          <Button type="submit" loading={submitting} loadingText="Salvando…">
            Cadastrar Cliente
          </Button>
        </StickyActionBar>
      </form>
    </ModulePage>
  );
}
