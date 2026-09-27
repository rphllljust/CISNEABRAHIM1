import type {
  NextAction,
  ObjectContextField,
  ObjectMetadataField,
  ObjectStateStep,
} from '../../enterprise-object';
import type { ActivityFact } from '../../operator';
import {
  CLIENT_STATUSES,
  CONTACT_PURPOSES,
  type Client,
  type ClientContact,
  type ClientStatus,
  type PurchaseOrderRequirement,
} from '../types/client.types';
import { formatPurchaseOrderRequirement } from './client-list-labels';
import { formatCnpjDisplay } from './format-cnpj';

/**
 * DERIVAÇÕES DA OBJECT PAGE DO CLIENTE.
 *
 * Tudo aqui é leitura de fato persistido. Nada é inferido, estimado ou preenchido:
 * campo sem valor real é omitido (nunca "—", "N/D" ou linha vazia), e valor que não pode ser
 * formatado é tratado como ausente.
 */

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** Instante persistido em texto humano. `null` quando o valor não é uma data utilizável. */
function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return DATE_TIME_FORMAT.format(parsed);
}

/**
 * Referência humana do cabeçalho: código de negócio do ERP quando existe, senão o CNPJ.
 * A guarda de `human-text` no primitivo descarta qualquer identificador técnico.
 */
export function clientReference(client: Client): string | null {
  const externalCode = client.externalErpId?.trim();
  if (externalCode) {
    return externalCode;
  }
  const taxId = formatCnpjDisplay(client.taxId ?? '');
  return taxId.trim().length > 0 ? taxId : null;
}

/** Estado do Cliente no vocabulário publicado pela API. */
export function clientStatusBadge(status: ClientStatus): { label: string; tone: 'success' | 'error' } {
  return status === CLIENT_STATUSES.Active
    ? { label: 'Ativo', tone: 'success' }
    : { label: 'Inativo', tone: 'error' };
}

/** Contexto operacional do estado, apenas quando há fato persistido que o explique. */
export function clientStatusDescription(client: Client): string | null {
  if (client.status !== CLIENT_STATUSES.Inactive) {
    return null;
  }
  const deactivatedAt = formatTimestamp(client.deactivatedAt);
  return deactivatedAt ? `Desativado em ${deactivatedAt}` : null;
}

/** Os dois únicos estados que a API do Cliente publica. Nenhuma etapa intermediária é inventada. */
export const CLIENT_LIFECYCLE_STEPS: ObjectStateStep[] = [
  { id: CLIENT_STATUSES.Active, label: 'Ativo' },
  { id: CLIENT_STATUSES.Inactive, label: 'Inativo' },
];

/**
 * Fluxo de estado do Cliente, com o estado corrente marcado.
 *
 * Quando o estado persistido não pertence ao vocabulário publicado, não existe fluxo: o front não
 * representa etapa que o backend não declarou.
 */
export function buildClientStateFlow(
  status: ClientStatus,
): { steps: ObjectStateStep[]; currentId: string } | null {
  const current = CLIENT_LIFECYCLE_STEPS.find((step) => step.id === status);
  if (!current) {
    return null;
  }
  return { steps: CLIENT_LIFECYCLE_STEPS, currentId: current.id };
}

/**
 * Fatos curtos do cabeçalho: o documento (quando a referência já é o código do ERP) e a data de
 * cadastro. As datas administrativas (atualização, desativação e motivo) ficam no painel
 * administrativo e no histórico — não se repetem aqui.
 */
export function buildClientMetadata(client: Client): ObjectMetadataField[] {
  const fields: ObjectMetadataField[] = [];

  if (client.externalErpId?.trim()) {
    const taxId = formatCnpjDisplay(client.taxId ?? '');
    if (taxId.trim().length > 0) {
      fields.push({ label: 'CNPJ', value: taxId });
    }
  }

  const createdAt = formatTimestamp(client.createdAt);
  if (createdAt) {
    fields.push({ label: 'Cadastro', value: createdAt });
  }

  return fields;
}

/** Rótulo humano do requisito de pedido de compra — configuração persistida do Cliente. */
function purchaseOrderRequirementLabel(
  requirement: PurchaseOrderRequirement | undefined,
): string | null {
  if (!requirement) {
    return null;
  }
  return formatPurchaseOrderRequirement(requirement) ?? null;
}

function formatContactValue(contact: ClientContact): string | null {
  const parts = [contact.name?.trim(), contact.email?.trim(), contact.phone?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

const PRIMARY_CONTACT_FIELDS: Array<{
  purpose: (typeof CONTACT_PURPOSES)[keyof typeof CONTACT_PURPOSES];
  label: string;
}> = [
  { purpose: CONTACT_PURPOSES.Operational, label: 'Contato operacional' },
  { purpose: CONTACT_PURPOSES.Commercial, label: 'Contato comercial' },
  { purpose: CONTACT_PURPOSES.Billing, label: 'Contato de faturamento' },
];

/**
 * Fatos que qualificam o Cliente. Campo sem valor real simplesmente não aparece.
 *
 * Cada fato aparece UMA vez na página: o CNPJ é a referência do cabeçalho (ou o metadado, quando a
 * referência é o código do ERP) e o nome fantasia é o subtítulo — repeti-los aqui não acrescentaria
 * informação. Unidade, responsável e origem não existem no payload do Cliente: não são inventados.
 */
export function buildClientContextFields(client: Client): ObjectContextField[] {
  const fields: ObjectContextField[] = [];

  const requirement = purchaseOrderRequirementLabel(client.purchaseOrderRequirement);
  if (requirement) {
    fields.push({ label: 'Pedido de compra', value: requirement });
  }

  const contacts = client.contacts ?? [];
  for (const entry of PRIMARY_CONTACT_FIELDS) {
    const contact = contacts.find((candidate) => candidate.purpose === entry.purpose);
    const value = contact ? formatContactValue(contact) : null;
    if (value) {
      fields.push({ label: entry.label, value });
    }
  }

  return fields;
}

/**
 * Contato operacional utilizável — a MESMA regra que o backend aplica em criação e atualização
 * (`assertCreateClientInput`/`assertUpdateClientInput`): nome preenchido e e-mail ou telefone.
 * Sem ele o cadastro não pode sequer ser atualizado pela API, então ele é o dado obrigatório
 * cuja ausência pode ser provada pelo payload.
 */
export function hasUsableOperationalContact(client: Client): boolean {
  return (client.contacts ?? []).some(
    (contact) =>
      contact.purpose === CONTACT_PURPOSES.Operational &&
      Boolean(contact.name?.trim()) &&
      Boolean(contact.email?.trim() || contact.phone?.trim()),
  );
}

/**
 * Próxima ação derivada de estado + capability + dado real.
 *
 * 1. Cliente inativo com permissão de reativação: o passo do processo é reativar.
 * 2. Cadastro sem contato operacional utilizável e com permissão de edição: o dado obrigatório
 *    ausente impede a própria atualização, então o próximo passo é completar o cadastro.
 * 3. Nada derivável: `null` — a seção desaparece em vez de exibir texto genérico.
 */
export function buildClientNextAction(
  client: Client,
  capabilities: { canUpdate: boolean; canActivate: boolean },
  handlers: { onReactivate: () => void },
): NextAction | null {
  if (client.status === CLIENT_STATUSES.Inactive && capabilities.canActivate) {
    return {
      kind: 'act',
      label: 'Reativar Cliente',
      description:
        'O Cliente voltará ao status ativo. O histórico de desativação anterior será preservado.',
      onSelect: handlers.onReactivate,
    };
  }

  if (capabilities.canUpdate && !hasUsableOperationalContact(client)) {
    return {
      kind: 'act',
      label: 'Completar cadastro',
      description: 'Falta contato operacional com nome e e-mail ou telefone.',
      to: `/app/clients/${client.id}/edit`,
    };
  }

  return null;
}

/**
 * Histórico do Cliente.
 *
 * O módulo persiste TIMESTAMPS, não trilha de eventos: os únicos fatos que podem ser afirmados são
 * o cadastro, a atualização e a desativação. Nenhum ator e nenhum evento de negócio é inventado.
 */
export function buildClientHistoryFacts(client: Client): ActivityFact[] {
  const facts: ActivityFact[] = [];
  const { createdAt, updatedAt, deactivatedAt } = client;

  if (createdAt) {
    facts.push({ at: createdAt, event: 'Cadastro criado' });
  }

  // A desativação também move `updatedAt`: nesse caso o fato já é o da desativação.
  if (updatedAt && updatedAt !== createdAt && updatedAt !== deactivatedAt) {
    facts.push({ at: updatedAt, event: 'Cadastro atualizado' });
  }

  if (deactivatedAt) {
    facts.push({ at: deactivatedAt, event: 'Cliente desativado', toState: 'Inativo' });
  }

  return facts;
}
