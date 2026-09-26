import { Link } from 'react-router-dom';
import { useId, useState, type FormEvent } from 'react';
import {
  SERVICE_REQUEST_ORIGINS,
  type ServiceRequestOrigin,
} from '../types/service-request.types';
import { SERVICE_REQUEST_ORIGIN_LABELS } from '../utils/service-request-labels';
import type {
  ServiceRequestFormFieldErrors,
  ServiceRequestFormValues,
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

  function updateField<K extends keyof ServiceRequestFormValues>(
    key: K,
    value: ServiceRequestFormValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="requests-form"
      aria-describedby={submitError ? formErrorId : undefined}
    >
      {submitError ? (
        <p id={formErrorId} className="form-error" role="alert">
          {submitError}
        </p>
      ) : null}

      <section aria-labelledby="request-origin-heading">
        <h2 id="request-origin-heading">Origem da solicitação</h2>
        <p className="form-hint">
          Canal ou fonte externa da demanda. Diferente de quem registrou internamente no sistema.
        </p>
        <div className="requests-form__grid">
          <div className="form-field">
            <label htmlFor="request-origin-source">Origem</label>
            <select
              id="request-origin-source"
              value={values.originSource}
              onChange={(event) =>
                updateField('originSource', event.target.value as ServiceRequestOrigin | '')
              }
              required
              aria-invalid={fieldErrors.originSource ? true : undefined}
              disabled={submitting}
            >
              <option value="">Selecione…</option>
              {Object.values(SERVICE_REQUEST_ORIGINS).map((origin) => (
                <option key={origin} value={origin}>
                  {SERVICE_REQUEST_ORIGIN_LABELS[origin]}
                </option>
              ))}
            </select>
            {fieldErrors.originSource ? (
              <span className="field-error" role="alert">
                {fieldErrors.originSource}
              </span>
            ) : null}
          </div>
          <div className="form-field">
            <label htmlFor="request-external-ref">Referência externa</label>
            <input
              id="request-external-ref"
              value={values.externalOriginReference}
              onChange={(event) => updateField('externalOriginReference', event.target.value)}
              disabled={submitting}
              placeholder="Protocolo, ticket, etc."
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="request-client-heading">
        <h2 id="request-client-heading">Cliente e contato externo</h2>
        <p className="form-hint">
          Selecione um Cliente autorizado ou informe o contato externo. Não criamos Cliente a partir
          de texto livre.
        </p>
        <div className="requests-form__grid">
          <div className="form-field">
            <label htmlFor="request-client">Cliente (opcional)</label>
            <select
              id="request-client"
              value={values.clientId}
              onChange={(event) => updateField('clientId', event.target.value)}
              disabled={submitting || clientsLoading}
              aria-invalid={fieldErrors.clientId ? true : undefined}
            >
              <option value="">Não identificado</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
            {fieldErrors.clientId ? (
              <span className="field-error" role="alert">
                {fieldErrors.clientId}
              </span>
            ) : null}
          </div>
          <div className="form-field">
            <label htmlFor="request-unit">Unidade operacional</label>
            {units.length > 0 ? (
              <select
                id="request-unit"
                value={values.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
                disabled={submitting || mode === 'edit'}
                aria-invalid={fieldErrors.unitId ? true : undefined}
              >
                <option value="">Selecione</option>
                {units.map((unitId) => (
                  <option key={unitId} value={unitId}>
                    {unitId}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="request-unit"
                value={values.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
                disabled={submitting || mode === 'edit'}
                aria-invalid={fieldErrors.unitId ? true : undefined}
              />
            )}
            {mode === 'create' && onRegisterUnit ? (
              <div className="form-field">
                <label htmlFor="request-unit-new">Registrar unidade</label>
                <input
                  id="request-unit-new"
                  value={unitDraft}
                  onChange={(event) => setUnitDraft(event.target.value)}
                  disabled={submitting}
                  placeholder="Código, ex. UN-POA-01"
                />
                <button
                  type="button"
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
                </button>
                {unitMessage ? <p role="status">{unitMessage}</p> : null}
              </div>
            ) : null}
            {fieldErrors.unitId ? (
              <span className="field-error" role="alert">
                {fieldErrors.unitId}
              </span>
            ) : null}
          </div>
        </div>
        <div className="requests-form__grid">
          <div className="form-field">
            <label htmlFor="request-contact-name">Nome do contato externo</label>
            <input
              id="request-contact-name"
              value={values.externalContactName}
              onChange={(event) => updateField('externalContactName', event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.externalContactName ? true : undefined}
            />
            {fieldErrors.externalContactName ? (
              <span className="field-error" role="alert">
                {fieldErrors.externalContactName}
              </span>
            ) : null}
          </div>
          <div className="form-field">
            <label htmlFor="request-contact-email">E-mail do contato</label>
            <input
              id="request-contact-email"
              type="email"
              value={values.externalContactEmail}
              onChange={(event) => updateField('externalContactEmail', event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="request-contact-phone">Telefone do contato</label>
            <input
              id="request-contact-phone"
              value={values.externalContactPhone}
              onChange={(event) => updateField('externalContactPhone', event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="request-details-heading">
        <h2 id="request-details-heading">Detalhes da demanda</h2>
        <div className="form-field">
          <label htmlFor="request-service">Serviço do catálogo</label>
          <select
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
          </select>
          {services.length === 0 ? (
            <p className="field-hint">Publique um serviço no catálogo para converter a solicitação em OS.</p>
          ) : null}
        </div>
        <div className="form-field">
          <label htmlFor="request-description">Descrição</label>
          <textarea
            id="request-description"
            value={values.description}
            onChange={(event) => updateField('description', event.target.value)}
            rows={4}
            required
            disabled={submitting}
            aria-invalid={fieldErrors.description ? true : undefined}
          />
          {fieldErrors.description ? (
            <span className="field-error" role="alert">
              {fieldErrors.description}
            </span>
          ) : null}
        </div>
        <div className="requests-form__grid">
          <div className="form-field">
            <label htmlFor="request-location-label">Local (rótulo)</label>
            <input
              id="request-location-label"
              value={values.locationLabel}
              onChange={(event) => updateField('locationLabel', event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="request-location-city">Cidade</label>
            <input
              id="request-location-city"
              value={values.locationCity}
              onChange={(event) => updateField('locationCity', event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="request-location-state">UF</label>
            <input
              id="request-location-state"
              value={values.locationState}
              onChange={(event) => updateField('locationState', event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div className="requests-form__grid">
          <div className="form-field">
            <label htmlFor="request-desired-start">Início desejado</label>
            <input
              id="request-desired-start"
              type="datetime-local"
              value={values.desiredStartAt}
              onChange={(event) => updateField('desiredStartAt', event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label htmlFor="request-desired-end">Fim desejado</label>
            <input
              id="request-desired-end"
              type="datetime-local"
              value={values.desiredEndAt}
              onChange={(event) => updateField('desiredEndAt', event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="request-notes">Observações operacionais</label>
          <textarea
            id="request-notes"
            value={values.operationalNotes}
            onChange={(event) => updateField('operationalNotes', event.target.value)}
            rows={3}
            disabled={submitting}
          />
        </div>
      </section>

      <div className="button-row">
        <button type="submit" disabled={submitting} aria-busy={submitting}>
          {mode === 'create' ? 'Registrar solicitação' : 'Salvar rascunho'}
        </button>
        <Link to={cancelHref} className="button-link button-secondary">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
