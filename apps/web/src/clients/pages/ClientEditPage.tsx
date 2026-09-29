import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ClientsApiError, getClient, updateClient } from '../api/clients-api';
import { mapClientErrorToMessage, VERSION_CONFLICT_MESSAGE } from '../api/client-error-messages';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { CONTACT_PURPOSES, type Client } from '../types/client.types';
import { formatCnpjDisplay } from '../utils/format-cnpj';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  Field,
  Input,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  StickyActionBar,
} from '../../ui';

const EDIT_DESCRIPTION =
  'Razão social é o nome legal do Cliente; o CNPJ identifica o cadastro e não é editável.';

/** Link de cancelamento na mesma linguagem do botão secundário — sem biblioteca nova. */
const SECONDARY_LINK_CLASS =
  'inline-flex min-h-[var(--spacing-touch)] items-center justify-center rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-inset ring-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

/**
 * EDITAR CLIENTE — cadastro no contrato estruturado, na moldura compartilhada.
 *
 * Antes: `<main className="shell-page clients-page">` proprio, `<h1>` manual, seis `<input>` em
 * coluna unica (`form-field`) e uma `button-row` local. Cada estado (permissao, carga, erro)
 * trocava a PAGINA INTEIRA por outro `<main>` com o titulo repetido.
 *
 * Agora: `ModulePage` + `ModulePageHeader`, resumo do cadastro visivel enquanto se edita, secoes
 * compactas em duas colunas (IDENTIFICACAO / CONTATO OPERACIONAL), erros inline e `StickyActionBar`
 * com Salvar/Cancelar sempre ao alcance.
 *
 * Nada da regra mudou: `getClient`/`updateClient`, o controle de `version`, o payload de contatos
 * (contato operacional + demais campos), o tratamento de conflito de versao e o mapeamento de erro
 * continuam exatamente iguais.
 */
export function ClientEditPage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useClientCapabilities();
  const legalNameId = useId();
  const tradeNameId = useId();
  const externalErpIdId = useId();
  const contactNameId = useId();
  const contactEmailId = useId();
  const contactPhoneId = useId();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [externalErpId, setExternalErpId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadClient = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setVersionConflict(false);
    try {
      const loaded = await getClient(clientId);
      setClient(loaded);
      setLegalName(loaded.legalName);
      setTradeName(loaded.tradeName ?? '');
      setExternalErpId(loaded.externalErpId ?? '');
      const operational =
        loaded.contacts.find((contact) => contact.purpose === CONTACT_PURPOSES.Operational) ??
        loaded.contacts[0];
      setContactName(operational?.name ?? '');
      setContactEmail(operational?.email ?? '');
      setContactPhone(operational?.phone ?? '');
    } catch (error) {
      setLoadError(
        error instanceof ClientsApiError
          ? mapClientErrorToMessage(error.code, error.status)
          : 'Não foi possível carregar o Cliente.',
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadClient();
  }, [loadClient]);

  if (capabilitiesLoading) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar Cliente" description={EDIT_DESCRIPTION} />
        <ModuleLoadingState message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canUpdate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar Cliente" description={EDIT_DESCRIPTION} />
        <ModuleDeniedState
          title="Editar Cliente"
          message="Você não tem permissão para editar Clientes."
        />
      </ModulePage>
    );
  }

  if (loading) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar Cliente" description={EDIT_DESCRIPTION} />
        <ModuleLoadingState message="Carregando…" />
      </ModulePage>
    );
  }

  if (loadError || !client) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar Cliente" description={EDIT_DESCRIPTION} />
        <ModuleErrorState
          title="Editar Cliente"
          message={loadError ?? 'Cliente não encontrado.'}
          retryable
          onRetry={() => void loadClient()}
        />
      </ModulePage>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !client) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setVersionConflict(false);

    const contact = {
      name: contactName.trim(),
      purpose: CONTACT_PURPOSES.Operational,
      email: contactEmail.trim() || undefined,
      phone: contactPhone.trim() || undefined,
    };

    try {
      const updated = await updateClient(client.id, {
        version: client.version,
        legalName: legalName.trim(),
        tradeName: tradeName.trim() ? tradeName.trim() : null,
        externalErpId: externalErpId.trim() ? externalErpId.trim() : null,
        contacts: [contact],
      });
      void navigate(`/app/clients/${updated.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ClientsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setSubmitError(VERSION_CONFLICT_MESSAGE);
      } else {
        setSubmitError(
          error instanceof ClientsApiError
            ? mapClientErrorToMessage(error.code, error.status)
            : 'Não foi possível salvar as alterações.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader title="Editar Cliente" description={EDIT_DESCRIPTION} />

      {/*
        RESUMO DO CADASTRO — o operador confere o que esta editando sem rolar ate o fim do
        formulario. O CNPJ fica aqui: e identidade, nao campo editavel.
      */}
      <BuilderSummary
        items={[
          { label: 'CNPJ', value: formatCnpjDisplay(client.taxId) },
          { label: 'Razão social', value: legalName.trim() || null },
          { label: 'Nome fantasia', value: tradeName.trim() || null },
          { label: 'Referência externa', value: externalErpId.trim() || null },
          { label: 'Contato operacional', value: contactName.trim() || null },
        ]}
      />

      {submitError ? (
        <p
          role="alert"
          className="m-0 mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        >
          {submitError}
        </p>
      ) : null}

      {versionConflict ? (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <p className="m-0 text-sm text-amber-800">{VERSION_CONFLICT_MESSAGE}</p>
          <Button type="button" variant="secondary" onClick={() => void loadClient()}>
            Recarregar dados atuais
          </Button>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-3">
        <fieldset
          disabled={submitting}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
          aria-label="Dados do cliente"
        >
          <BuilderSection
            title="Identificação"
            description="Razão social é obrigatória. O CNPJ identifica o cadastro e não é editável."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Razão social" htmlFor={legalNameId} required>
                <Input
                  id={legalNameId}
                  value={legalName}
                  onChange={(event) => setLegalName(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="Nome fantasia" htmlFor={tradeNameId}>
                <Input
                  id={tradeNameId}
                  value={tradeName}
                  onChange={(event) => setTradeName(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Referência externa (opcional)"
                htmlFor={externalErpIdId}
                hint="Código do cadastro no ERP de origem, quando existir."
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
            description="Pessoa de contato do Cliente para a operação."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" htmlFor={contactNameId} required>
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
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Telefone" htmlFor={contactPhoneId}>
                <Input
                  id={contactPhoneId}
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </BuilderSection>
        </fieldset>

        <StickyActionBar note="Alterações concorrentes são recusadas pelo servidor; o CNPJ não muda.">
          <Link to={`/app/clients/${client.id}`} className={SECONDARY_LINK_CLASS}>
            Cancelar
          </Link>
          <Button type="submit" loading={submitting} loadingText="Salvando…">
            Salvar alterações
          </Button>
        </StickyActionBar>
      </form>
    </ModulePage>
  );
}
