import { Link } from 'react-router-dom';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { HumanLookupField, type HumanLookupOption } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
  BuilderSection,
  BuilderSummary,
  Button,
  Field,
  Input,
  Select,
  StickyActionBar,
  Textarea,
} from '../../ui';
import {
  SERVICE_REQUEST_ORIGINS,
  type ServiceRequestOrigin,
} from '../types/service-request.types';
import {
  SERVICE_REQUEST_ORIGIN_LABELS,
  formatServiceRequestOrigin,
} from '../utils/service-request-labels';
import {
  validateServiceRequestForm,
  type ServiceRequestFormFieldErrors,
  type ServiceRequestFormValues,
} from '../utils/service-request-form-validation';

type ClientOption = {
  id: string;
  label: string;
};

type ServiceOption = {
  id: string;
  versionId: string;
  label: string;
};

type ServiceRequestFormProps = {
  mode: 'create' | 'edit';
  values: ServiceRequestFormValues;
  clients: ClientOption[];
  clientsLoading: boolean;
  units?: string[];
  services?: ServiceOption[];
  fieldErrors: ServiceRequestFormFieldErrors;
  submitError: string | null;
  submitting: boolean;
  onChange: (values: ServiceRequestFormValues) => void;
  onRegisterUnit?: (refId: string) => Promise<string[]>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelHref: string;
};

const FIELD_GRID = 'grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3';

/** Data/hora desejada em formato local legivel; valor vazio nao entra no resumo. */
function formatDesiredAt(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Explica, em linguagem de negocio, o que ainda impede o registro. */
function describePending(errors: ServiceRequestFormFieldErrors): string | null {
  const pending: string[] = [];
  if (errors.originSource) {
    pending.push('origem');
  }
  if (errors.unitId) {
    pending.push('unidade operacional');
  }
  if (errors.clientId || errors.externalContactName) {
    pending.push('Cliente ou contato externo');
  }
  if (errors.description) {
    pending.push('descrição da demanda');
  }
  return pending.length > 0 ? `Falta preencher: ${pending.join(', ')}.` : null;
}

export function ServiceRequestForm({
  mode,
  values,
  clients,
  clientsLoading,
  units = [],
  services = [],
  fieldErrors,
  submitError,
  submitting,
  onChange,
  onRegisterUnit,
  onSubmit,
  cancelHref,
}: ServiceRequestFormProps) {
  const formErrorId = useId();
  const [unitDraft, setUnitDraft] = useState('');
  const [unitMessage, setUnitMessage] = useState<string | null>(null);
  const lastClientOptions = useRef<HumanLookupOption[]>([]);
  const [pickedClient, setPickedClient] = useState<{ id: string; label: string } | null>(null);

  function updateField<K extends keyof ServiceRequestFormValues>(
    key: K,
    value: ServiceRequestFormValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  const searchClients = useCallback(async (term: string, signal?: AbortSignal) => {
    const options = await searchClientOptions(term, signal);
    lastClientOptions.current = options;
    return options;
  }, []);

  /**
   * Servicos publicados ja carregados pela tela. A busca do catalogo nao aceita termo livre no
   * servidor, entao o filtro aqui e local e explicito — nunca inventa opcao ausente.
   */
  const searchServices = useCallback(
    async (term: string) => {
      const lowered = term.trim().toLowerCase();
      const matches =
        lowered.length > 0
          ? services.filter((service) => service.label.toLowerCase().includes(lowered))
          : services;
      return matches.map((service) => ({ id: service.versionId, label: service.label }));
    },
    [services],
  );

  /** Nome humano do cliente desta edicao; nunca o identificador tecnico (ausente = omitido). */
  const clientLabel =
    pickedClient && pickedClient.id === values.clientId
      ? pickedClient.label
      : (clients.find((client) => client.id === values.clientId)?.label ?? null);

  const selectedService =
    services.find((service) => service.versionId === values.serviceDefinitionVersionId) ?? null;

  const liveErrors = validateServiceRequestForm(values, mode);
  const missing = describePending(liveErrors);
  const canSubmit = !submitting && missing === null;

  const note = submitting ? 'Registrando a solicitação…' : missing;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3"
      aria-describedby={submitError ? formErrorId : undefined}
    >
      <BuilderSummary
        items={[
          { label: 'Cliente', value: clientLabel },
          {
            label: 'Contato externo',
            value: values.externalContactName.trim() || null,
          },
          {
            label: 'Origem',
            value: values.originSource
              ? formatServiceRequestOrigin(values.originSource)
              : null,
          },
          { label: 'Unidade', value: values.unitId.trim() || null },
          { label: 'Serviço', value: selectedService?.label ?? null },
          { label: 'Início desejado', value: formatDesiredAt(values.desiredStartAt) },
        ]}
      />

      {submitError ? (
        <p id={formErrorId} className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {submitError}
        </p>
      ) : null}

      <BuilderSection
        title="Origem da solicitação"
        description="Canal ou fonte externa da demanda — diferente de quem registrou internamente no sistema."
      >
        <div className={FIELD_GRID}>
          <Field
            label="Origem"
            htmlFor="request-origin-source"
            required
            error={fieldErrors.originSource}
          >
            <Select
              id="request-origin-source"
              value={values.originSource}
              onChange={(event) =>
                updateField('originSource', event.target.value as ServiceRequestOrigin | '')
              }
              required
              disabled={submitting}
              invalid={Boolean(fieldErrors.originSource)}
            >
              <option value="">Selecione…</option>
              {Object.values(SERVICE_REQUEST_ORIGINS).map((origin) => (
                <option key={origin} value={origin}>
                  {SERVICE_REQUEST_ORIGIN_LABELS[origin]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Referência externa" htmlFor="request-external-ref">
            <Input
              id="request-external-ref"
              value={values.externalOriginReference}
              onChange={(event) => updateField('externalOriginReference', event.target.value)}
              disabled={submitting}
              placeholder="Protocolo, ticket, etc."
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Cliente, unidade e contato"
        description="Selecione um Cliente autorizado ou informe o contato externo — não criamos Cliente a partir de texto livre."
        action={
          mode === 'create' && onRegisterUnit ? (
            <div className="flex items-center gap-2">
              <Input
                id="request-unit-new"
                aria-label="Código da nova unidade operacional"
                value={unitDraft}
                onChange={(event) => setUnitDraft(event.target.value)}
                disabled={submitting}
                placeholder="Nova unidade, ex. UN-POA-01"
                className="w-52"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={submitting || unitDraft.trim().length < 2}
                onClick={() => {
                  void onRegisterUnit(unitDraft)
                    .then((items) => {
                      setUnitMessage('Unidade registrada.');
                      setUnitDraft('');
                      if (items.includes(unitDraft.trim().toUpperCase())) {
                        updateField('unitId', unitDraft.trim().toUpperCase());
                      }
                    })
                    .catch(() => setUnitMessage('Não foi possível registrar a unidade.'));
                }}
              >
                Registrar unidade
              </Button>
            </div>
          ) : null
        }
        footer={
          unitMessage ? (
            <p className="m-0" role="status">
              {unitMessage}
            </p>
          ) : null
        }
      >
        <div className={FIELD_GRID}>
          {mode === 'create' ? (
            <HumanLookupField
              label="Cliente"
              htmlFor="request-client"
              hint="Opcional. Sem Cliente, o contato externo identifica a demanda."
              search={searchClients}
              value={values.clientId}
              initialLabel={clientLabel ?? undefined}
              onChange={(id) => {
                const option = lastClientOptions.current.find((item) => item.id === id);
                setPickedClient(option ? { id, label: option.label } : null);
                updateField('clientId', id);
              }}
              emptyOptionLabel="Não identificado"
              emptyMessage="Nenhum cliente encontrado para a busca."
            />
          ) : (
            <Field
              label="Cliente (opcional)"
              htmlFor="request-client"
              error={fieldErrors.clientId}
              hint="O vínculo com o Cliente é definido no registro da solicitação."
            >
              <Select
                id="request-client"
                value={values.clientId}
                onChange={(event) => updateField('clientId', event.target.value)}
                disabled={submitting || clientsLoading}
                invalid={Boolean(fieldErrors.clientId)}
              >
                <option value="">Não identificado</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Unidade operacional"
            htmlFor="request-unit"
            required
            error={fieldErrors.unitId}
            hint={
              units.length === 0
                ? 'Nenhuma unidade registrada para o seu acesso — informe o código.'
                : undefined
            }
          >
            {units.length > 0 ? (
              <Select
                id="request-unit"
                value={values.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
                disabled={submitting}
                invalid={Boolean(fieldErrors.unitId)}
              >
                <option value="">Selecione</option>
                {units.map((unitId) => (
                  <option key={unitId} value={unitId}>
                    {unitId}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="request-unit"
                value={values.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
                disabled={submitting}
                placeholder="Código, ex. UN-POA-01"
                invalid={Boolean(fieldErrors.unitId)}
              />
            )}
          </Field>

          <Field
            label="Nome do contato externo"
            htmlFor="request-contact-name"
            error={fieldErrors.externalContactName}
          >
            <Input
              id="request-contact-name"
              value={values.externalContactName}
              onChange={(event) => updateField('externalContactName', event.target.value)}
              disabled={submitting}
              invalid={Boolean(fieldErrors.externalContactName)}
            />
          </Field>

          <Field label="E-mail do contato" htmlFor="request-contact-email">
            <Input
              id="request-contact-email"
              type="email"
              value={values.externalContactEmail}
              onChange={(event) => updateField('externalContactEmail', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Telefone do contato" htmlFor="request-contact-phone">
            <Input
              id="request-contact-phone"
              value={values.externalContactPhone}
              onChange={(event) => updateField('externalContactPhone', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Detalhes da demanda"
        description="Serviço do catálogo, o que precisa ser feito, onde e quando."
      >
        <div className={FIELD_GRID}>
          {mode === 'create' && services.length > 0 ? (
            <HumanLookupField
              label="Serviço do catálogo"
              htmlFor="request-service"
              search={searchServices}
              value={values.serviceDefinitionVersionId}
              initialLabel={selectedService?.label}
              onChange={(versionId) => {
                const service = services.find((item) => item.versionId === versionId);
                onChange({
                  ...values,
                  serviceDefinitionVersionId: versionId,
                  serviceDefinitionId: service?.id ?? '',
                });
              }}
              emptyOptionLabel="Sem serviço vinculado"
              emptyMessage="Nenhum serviço publicado encontrado para a busca."
              hint="Somente serviços publicados podem ser vinculados."
            />
          ) : (
            <Field
              label="Serviço do catálogo"
              htmlFor="request-service"
              hint={
                services.length === 0
                  ? 'Publique um serviço no catálogo para converter a solicitação em OS.'
                  : undefined
              }
            >
              <Select
                id="request-service"
                value={values.serviceDefinitionVersionId}
                onChange={(event) => {
                  const versionId = event.target.value;
                  const service = services.find((item) => item.versionId === versionId);
                  onChange({
                    ...values,
                    serviceDefinitionVersionId: versionId,
                    serviceDefinitionId: service?.id ?? '',
                  });
                }}
                disabled={submitting || services.length === 0}
              >
                <option value="">Sem serviço vinculado</option>
                {services.map((service) => (
                  <option key={service.versionId} value={service.versionId}>
                    {service.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Descrição"
            htmlFor="request-description"
            required
            error={fieldErrors.description}
            className="sm:col-span-2"
          >
            <Textarea
              id="request-description"
              value={values.description}
              onChange={(event) => updateField('description', event.target.value)}
              rows={3}
              required
              disabled={submitting}
              invalid={Boolean(fieldErrors.description)}
            />
          </Field>

          <Field label="Local (rótulo)" htmlFor="request-location-label">
            <Input
              id="request-location-label"
              value={values.locationLabel}
              onChange={(event) => updateField('locationLabel', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Cidade" htmlFor="request-location-city">
            <Input
              id="request-location-city"
              value={values.locationCity}
              onChange={(event) => updateField('locationCity', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="UF" htmlFor="request-location-state">
            <Input
              id="request-location-state"
              value={values.locationState}
              onChange={(event) => updateField('locationState', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Início desejado" htmlFor="request-desired-start">
            <Input
              id="request-desired-start"
              type="datetime-local"
              value={values.desiredStartAt}
              onChange={(event) => updateField('desiredStartAt', event.target.value)}
              disabled={submitting}
            />
          </Field>

          <Field label="Fim desejado" htmlFor="request-desired-end">
            <Input
              id="request-desired-end"
              type="datetime-local"
              value={values.desiredEndAt}
              onChange={(event) => updateField('desiredEndAt', event.target.value)}
              disabled={submitting}
            />
          </Field>
        </div>
      </BuilderSection>

      <BuilderSection
        title="Observações operacionais"
        description="Instruções de acesso, janelas de execução e ressalvas da equipe."
      >
        <Field label="Observações operacionais" htmlFor="request-notes">
          <Textarea
            id="request-notes"
            value={values.operationalNotes}
            onChange={(event) => updateField('operationalNotes', event.target.value)}
            rows={3}
            disabled={submitting}
          />
        </Field>
      </BuilderSection>

      <StickyActionBar note={note}>
        <Link to={cancelHref} className="button-link button-secondary">
          Cancelar
        </Link>
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={submitting}
          loadingText="Registrando solicitação…"
        >
          {mode === 'create' ? 'Registrar solicitação' : 'Salvar rascunho'}
        </Button>
      </StickyActionBar>
    </form>
  );
}
