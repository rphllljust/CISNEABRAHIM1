import type {
  CreateServiceRequestPayload,
  ServiceRequestOrigin,
  UpdateServiceRequestDraftPayload,
} from '../types/service-request.types';

export type ServiceRequestFormValues = {
  unitId: string;
  originSource: ServiceRequestOrigin | '';
  externalContactName: string;
  externalContactEmail: string;
  externalContactPhone: string;
  externalOriginReference: string;
  clientId: string;
  description: string;
  locationLabel: string;
  locationStreet: string;
  locationCity: string;
  locationState: string;
  desiredStartAt: string;
  desiredEndAt: string;
  operationalNotes: string;
  serviceDefinitionId: string;
  serviceDefinitionVersionId: string;
};

export type ServiceRequestFormFieldErrors = Partial<Record<keyof ServiceRequestFormValues, string>>;

function hasExternalContact(values: ServiceRequestFormValues): boolean {
  return Boolean(
    values.externalContactName.trim() ||
      values.externalContactEmail.trim() ||
      values.externalContactPhone.trim(),
  );
}

export function validateServiceRequestForm(
  values: ServiceRequestFormValues,
  mode: 'create' | 'edit',
): ServiceRequestFormFieldErrors {
  const errors: ServiceRequestFormFieldErrors = {};

  if (!values.unitId.trim()) {
    errors.unitId = 'Informe a unidade operacional.';
  }
  if (!values.originSource) {
    errors.originSource = 'Selecione a origem da solicitação.';
  }
  if (!values.clientId.trim() && !hasExternalContact(values)) {
    errors.externalContactName = 'Informe o Cliente ou os dados de contato externo.';
  }
  if (!values.description.trim()) {
    errors.description = 'Informe a descrição da solicitação.';
  }

  if (mode === 'create' && !values.clientId.trim() && !hasExternalContact(values)) {
    errors.clientId = 'Selecione um Cliente ou preencha o contato externo.';
  }

  return errors;
}

function buildExternalContact(values: ServiceRequestFormValues) {
  const contact = {
    name: values.externalContactName.trim() || undefined,
    email: values.externalContactEmail.trim() || undefined,
    phone: values.externalContactPhone.trim() || undefined,
  };
  return Object.values(contact).some(Boolean) ? contact : undefined;
}

function buildLocation(values: ServiceRequestFormValues) {
  const location = {
    label: values.locationLabel.trim() || undefined,
    street: values.locationStreet.trim() || undefined,
    city: values.locationCity.trim() || undefined,
    state: values.locationState.trim() || undefined,
  };
  return Object.values(location).some(Boolean) ? location : undefined;
}

export function buildCreatePayload(values: ServiceRequestFormValues): CreateServiceRequestPayload {
  return {
    unitId: values.unitId.trim(),
    originSource: values.originSource as ServiceRequestOrigin,
    externalContact: buildExternalContact(values),
    externalOriginReference: values.externalOriginReference.trim() || undefined,
    clientId: values.clientId.trim() || undefined,
    description: values.description.trim() || undefined,
    location: buildLocation(values),
    desiredStartAt: values.desiredStartAt ? new Date(values.desiredStartAt).toISOString() : undefined,
    desiredEndAt: values.desiredEndAt ? new Date(values.desiredEndAt).toISOString() : undefined,
    operationalNotes: values.operationalNotes.trim() || undefined,
    serviceDefinitionId: values.serviceDefinitionId.trim() || undefined,
    serviceDefinitionVersionId: values.serviceDefinitionVersionId.trim() || undefined,
  };
}

export function buildUpdatePayload(
  values: ServiceRequestFormValues,
  rowVersion: number,
): UpdateServiceRequestDraftPayload {
  return {
    rowVersion,
    originSource: values.originSource as ServiceRequestOrigin,
    externalContact: buildExternalContact(values),
    externalOriginReference: values.externalOriginReference.trim() || null,
    clientId: values.clientId.trim() || null,
    description: values.description.trim() || null,
    location: buildLocation(values),
    desiredStartAt: values.desiredStartAt ? new Date(values.desiredStartAt).toISOString() : null,
    desiredEndAt: values.desiredEndAt ? new Date(values.desiredEndAt).toISOString() : null,
    operationalNotes: values.operationalNotes.trim() || null,
    serviceDefinitionId: values.serviceDefinitionId.trim() || null,
    serviceDefinitionVersionId: values.serviceDefinitionVersionId.trim() || null,
  };
}

export const EMPTY_SERVICE_REQUEST_FORM: ServiceRequestFormValues = {
  unitId: '',
  originSource: '',
  externalContactName: '',
  externalContactEmail: '',
  externalContactPhone: '',
  externalOriginReference: '',
  clientId: '',
  description: '',
  locationLabel: '',
  locationStreet: '',
  locationCity: '',
  locationState: '',
  desiredStartAt: '',
  desiredEndAt: '',
  operationalNotes: '',
  serviceDefinitionId: '',
  serviceDefinitionVersionId: '',
};

export function toDatetimeLocalValue(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}
