import {
  ADDRESS_PURPOSES,
  CLIENT_QUALITY_SEVERITIES,
  CONTACT_PURPOSES,
  CONTACT_ROLES,
  type Client,
  type ClientAddress,
  type ClientAuditTrailEntry,
  type ClientContact,
  type ClientDataQuality,
  type ClientHierarchy,
  type ClientQualityFinding,
  type ClientUnit,
  type ContactRole,
} from '../types/client.types';

/**
 * LEITURA HUMANA DO CUSTOMER 360.
 *
 * Este módulo SÓ traduz fato persistido para texto. Ele não decide nada sobre o domínio, não
 * calcula indicador e não preenche ausência: quando o valor não existe, a função devolve `null` e
 * o componente OMITE a linha, em vez de imprimir "—", "N/D" ou "não informado".
 *
 * A regra que governa o arquivo inteiro: AUSÊNCIA ≠ ZERO. Um Cliente sem grupo econômico não tem
 * "grupo: nenhum"; ele simplesmente não tem vínculo, e a ficha não afirma nada sobre isso.
 */

const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  [CONTACT_ROLES.Operational]: 'Operacional',
  [CONTACT_ROLES.Commercial]: 'Comercial',
  [CONTACT_ROLES.Billing]: 'Faturamento',
  [CONTACT_ROLES.Purchasing]: 'Compras',
  [CONTACT_ROLES.Fiscal]: 'Fiscal',
  [CONTACT_ROLES.Contracts]: 'Contratos',
  [CONTACT_ROLES.Management]: 'Diretoria',
};

const CONTACT_PURPOSE_LABELS: Record<string, string> = {
  [CONTACT_PURPOSES.Operational]: 'Operacional',
  [CONTACT_PURPOSES.Commercial]: 'Comercial',
  [CONTACT_PURPOSES.Billing]: 'Faturamento',
};

const ADDRESS_PURPOSE_LABELS: Record<string, string> = {
  [ADDRESS_PURPOSES.Operational]: 'Operacional',
  [ADDRESS_PURPOSES.Billing]: 'Faturamento',
  [ADDRESS_PURPOSES.Correspondence]: 'Correspondência',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Cadastro criado',
  UPDATE: 'Cadastro alterado',
  DELETE: 'Cadastro removido',
  TRANSITION: 'Situação alterada',
};

/** Papel do contato. `null` NÃO vira rótulo: significa "não declarado". */
export function contactRoleLabel(role: ContactRole | null | undefined): string | null {
  if (!role) {
    return null;
  }
  return CONTACT_ROLE_LABELS[role] ?? null;
}

/** Eixo de relacionamento do contato no CISNE. */
export function contactPurposeLabel(purpose: string): string | null {
  return CONTACT_PURPOSE_LABELS[purpose] ?? null;
}

export function addressPurposeLabel(purpose: string): string | null {
  return ADDRESS_PURPOSE_LABELS[purpose] ?? null;
}

export function auditActionLabel(action: string): string {
  // Ação desconhecida é exibida COMO VEIO: inventar um rótulo amigável para um valor que o
  // servidor não publica esconderia uma divergência de contrato.
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/**
 * CONTATOS AGRUPADOS POR SITUAÇÃO.
 *
 * Ativos primeiro porque são os acionáveis; inativos ficam agrupados e continuam visíveis porque a
 * inativação PRESERVA o histórico do relacionamento — escondê-los faria a organização do Cliente
 * parecer mais pobre do que é.
 */
export type ContactGroups = {
  active: ClientContact[];
  inactive: ClientContact[];
  /** O contato principal, quando declarado. `null` significa "não declarado". */
  primary: ClientContact | null;
};

export function groupClientContacts(contacts: ClientContact[] | undefined | null): ContactGroups {
  const list = contacts ?? [];
  const active = list.filter((contact) => !contact.deactivatedAt);
  const inactive = list.filter((contact) => Boolean(contact.deactivatedAt));
  return {
    active,
    inactive,
    primary: list.find((contact) => contact.isPrimary === true) ?? null,
  };
}

/** Linha de contato legível: nome, papel, canal. Campo ausente é omitido, não preenchido. */
export function formatContactChannel(contact: ClientContact): string[] {
  const parts: string[] = [];
  if (contact.email?.trim()) {
    parts.push(contact.email.trim());
  }
  if (contact.phone?.trim()) {
    parts.push(contact.phone.trim());
  }
  return parts;
}

/** Endereço em uma linha. Componentes vazios desaparecem sem deixar separador solto. */
export function formatAddressLine(address: ClientAddress): string | null {
  const parts = [
    address.street,
    address.number,
    address.complement,
    address.district,
    address.city,
    address.state,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * UNIDADES ORDENADAS PARA LEITURA: matriz primeiro, depois por nome.
 *
 * A matriz vem primeiro porque é a coordenada de referência do Cliente. `isHeadquarters` é dado
 * DECLARADO — a ordenação o respeita, e não deduz nada de nome ou de ordem de cadastro.
 *
 * AUSÊNCIA DA COLEÇÃO É TRATADA COMO COLEÇÃO VAZIA, e isso é deliberado: `units` foi acrescentada
 * na migration 0097, e uma resposta gravada antes disso — cache de navegador, fixture de teste,
 * resposta de um servidor em versão anterior durante o deploy — chega SEM o campo. Estourar no
 * `.sort` de `undefined` derrubaria a ficha inteira por causa de um campo acessório; tratar a
 * ausência como "nenhuma unidade declarada" mantém a página útil e diz a verdade sobre o payload
 * que chegou. O mesmo vale para `contacts` e `addresses`.
 */
export function orderClientUnits(units: ClientUnit[] | undefined | null): ClientUnit[] {
  return [...(units ?? [])].sort((left, right) => {
    if (left.isHeadquarters !== right.isHeadquarters) {
      return left.isHeadquarters ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'pt-BR');
  });
}

/** Rótulo de unidade na leitura: nome + marcação explícita de matriz quando declarada. */
export function unitDisplayLabel(unit: ClientUnit): string {
  return unit.isHeadquarters ? `${unit.name} · Matriz` : unit.name;
}

/* ── qualidade dos dados ─────────────────────────────────────────────────────────────────── */

export type QualityTone = 'error' | 'warning' | 'neutral';

/**
 * TOM VISUAL POR SEVERIDADE.
 *
 * `blocking` vermelho (impede operação agora), `attention` âmbar (produz erro a jusante),
 * `advisory` neutro (governança). A correspondência é direta: a severidade já carrega o
 * significado, e a UI não reinterpreta.
 */
export function qualitySeverityTone(severity: ClientQualityFinding['severity']): QualityTone {
  switch (severity) {
    case 'blocking':
      return 'error';
    case 'attention':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function qualitySeverityLabel(severity: ClientQualityFinding['severity']): string {
  switch (severity) {
    case 'blocking':
      return 'Bloqueia operação';
    case 'attention':
      return 'Requer atenção';
    default:
      return 'Recomendação';
  }
}

/** Contagem por severidade — sobre a coleção REAL devolvida, nunca sobre uma amostra. */
export function countQualityFindings(quality: ClientDataQuality): {
  blocking: number;
  attention: number;
  advisory: number;
} {
  return {
    blocking: quality.findings.filter((f) => f.severity === CLIENT_QUALITY_SEVERITIES[0]).length,
    attention: quality.findings.filter((f) => f.severity === CLIENT_QUALITY_SEVERITIES[1]).length,
    advisory: quality.findings.filter((f) => f.severity === CLIENT_QUALITY_SEVERITIES[2]).length,
  };
}

/* ── hierarquia ─────────────────────────────────────────────────────────────────────────── */

export type HierarchyView = {
  /** Ascendentes, da raiz declarada até o pai imediato (ordem de leitura da cadeia). */
  ancestors: ClientHierarchy['nodes'];
  /** O Cliente consultado. */
  self: ClientHierarchy['nodes'][number] | null;
  /** Descendentes diretos. */
  children: ClientHierarchy['nodes'];
  /**
   * A árvore veio PARCIAL: o servidor atingiu o teto de profundidade ou de nós. A UI declara isso
   * em vez de apresentar a lista curta como se fosse a estrutura completa.
   */
  truncated: boolean;
};

export function buildHierarchyView(hierarchy: ClientHierarchy): HierarchyView {
  const ancestors = hierarchy.nodes
    .filter((node) => node.relation === 'parent')
    // `depth` maior = mais distante do Cliente consultado, então a leitura da cadeia é do mais
    // distante para o mais próximo: "Grupo -> Matriz -> este Cliente".
    .sort((left, right) => right.depth - left.depth);
  const self = hierarchy.nodes.find((node) => node.relation === 'self') ?? null;
  const children = hierarchy.nodes.filter((node) => node.relation === 'child');
  return { ancestors, self, children, truncated: hierarchy.truncated };
}

/** Há alguma estrutura declarada, ou o Cliente está isolado? */
export function hasDeclaredHierarchy(client: Client): boolean {
  return Boolean(client.groupName) || Boolean(client.parentClientName) || client.childCount > 0;
}

/* ── trilha de auditoria ────────────────────────────────────────────────────────────────── */

/**
 * CAMPOS AUDITÁVEIS EM LEITURA HUMANA.
 *
 * O snapshot da trilha é o allow-list do servidor (`toAuditableSnapshot`). Traduzir os nomes aqui
 * é o que torna o histórico legível; um campo que o servidor venha a acrescentar aparece com o
 * próprio nome técnico, em vez de ser silenciosamente escondido.
 */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  legalName: 'Razão social',
  tradeName: 'Nome fantasia',
  status: 'Situação',
  externalErpId: 'Referência externa',
  purchaseOrderRequirement: 'Exigência de pedido de compra',
  groupId: 'Grupo econômico',
  parentClientId: 'Matriz',
  version: 'Versão',
};

export type AuditFieldChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field;
}

/** Valor de snapshot em texto. `null`/ausente devolve `null` — a linha mostra "não havia valor". */
function auditValueToText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // Estrutura aninhada não é esperada no allow-list do servidor; serializar é preferível a
  // esconder a informação de quem lê a trilha.
  return JSON.stringify(value);
}

/**
 * DIFERENÇAS REAIS DE UMA ENTRADA DA TRILHA.
 *
 * Na criação não há "antes": todos os campos não nulos entram como valor NOVO, e `before` é `null`
 * — o que a UI lê como "não havia valor", que é a verdade.
 */
export function diffAuditEntry(entry: ClientAuditTrailEntry): AuditFieldChange[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: AuditFieldChange[] = [];

  for (const field of fields) {
    // `version` muda em toda escrita e não é informação de negócio: mostrá-la em cada linha
    // poluiria o histórico sem dizer nada sobre o cadastro.
    if (field === 'version') {
      continue;
    }
    const beforeText = auditValueToText(before[field]);
    const afterText = auditValueToText(after[field]);
    if (beforeText === afterText) {
      continue;
    }
    changes.push({
      field,
      label: auditFieldLabel(field),
      before: beforeText,
      after: afterText,
    });
  }

  return changes;
}
