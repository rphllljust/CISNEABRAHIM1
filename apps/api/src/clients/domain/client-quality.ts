import {
  CONTACT_PURPOSES,
  type AddressPurpose,
  type ClientStatus,
  type ContactPurpose,
} from './client-status';

/**
 * QUALIDADE DE DADOS DO CADASTRO DE CLIENTES.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * PRINCÍPIO: A AUSÊNCIA É UM ESTADO DE PRIMEIRA CLASSE, E NÃO UM ZERO.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O que este módulo publica são APONTAMENTOS, não uma nota. Não existe "score de qualidade" por
 * três razões, e todas são de honestidade:
 *
 *  1. Uma nota exige PESOS, e nenhuma fonte confirmada define quanto vale um endereço de cobrança
 *     contra um contato de compras. Atribuir pesos seria inventar regra de negócio.
 *  2. Uma nota esconde a causa. O operador precisa saber O QUE completar, não que "o cadastro está
 *     72% completo".
 *  3. Uma nota convida a comparar Clientes entre si, o que não tem significado operacional.
 *
 * Cada apontamento é derivado de dado PERSISTIDO e diz, em uma frase, o que falta. Nada é inferido
 * de heurística: "sem endereço de faturamento" só é dito quando a coleção real não tem nenhum
 * endereço com essa finalidade.
 *
 * O QUE ESTE MÓDULO DELIBERADAMENTE NÃO FAZ
 *
 *  - Não valida CNPJ: o formato é invariante de banco (`clients_normalized_tax_id_digits_chk`) e a
 *    validade do dígito verificador é barrada na escrita (`isValidCnpjFormat`). Um cadastro
 *    existente tem, por construção, CNPJ com 14 dígitos. Repetir a checagem aqui produziria um
 *    apontamento que nunca dispara — ruído, não governança.
 *  - Não checa unicidade de CNPJ: é garantida por índice único. A duplicidade possível é a que o
 *    índice NÃO pega (mesma empresa com documento diferente ou digitado errado), tratada em
 *    `client-duplicates.ts`.
 *  - Não transforma ausência em falha: um Cliente sem grupo econômico não é um cadastro ruim. Só
 *    entram apontamentos cuja ausência tem CONSEQUÊNCIA operacional demonstrável.
 */

export const CLIENT_QUALITY_FINDING_CODES = {
  /** Sem contato operacional utilizável. Bloqueia a própria ATUALIZAÇÃO do cadastro pela API. */
  MissingOperationalContact: 'MISSING_OPERATIONAL_CONTACT',
  /** Sem contato de faturamento: a cobrança não tem destinatário conhecido. */
  MissingBillingContact: 'MISSING_BILLING_CONTACT',
  /** Nenhum endereço cadastrado. */
  MissingAnyAddress: 'MISSING_ANY_ADDRESS',
  /** Sem endereço de faturamento: documento fiscal/cobrança não tem destino declarado. */
  MissingBillingAddress: 'MISSING_BILLING_ADDRESS',
  /** Sem nenhuma unidade declarada, em Cliente que tem filiais registradas em endereços. */
  MissingUnitDeclaration: 'MISSING_UNIT_DECLARATION',
  /** Endereço aponta unidade que não pertence a este Cliente (não deveria ocorrer; invariante). */
  AddressUnitMismatch: 'ADDRESS_UNIT_MISMATCH',
  /** Sem referência externa: o Cliente não é correlacionável com o ERP de origem. */
  MissingExternalReference: 'MISSING_EXTERNAL_REFERENCE',
  /** Contato principal não declarado, em Cliente com mais de um contato. */
  MissingPrimaryContact: 'MISSING_PRIMARY_CONTACT',
  /** Vários contatos no mesmo papel sem nenhum marcado como principal. */
  AmbiguousContactOwnership: 'AMBIGUOUS_CONTACT_OWNERSHIP',
} as const;

export type ClientQualityFindingCode =
  (typeof CLIENT_QUALITY_FINDING_CODES)[keyof typeof CLIENT_QUALITY_FINDING_CODES];

/**
 * Severidade com significado OPERACIONAL, não estético.
 *
 *  - `blocking`   — impede uma operação real AGORA (ex.: o cadastro não pode ser atualizado).
 *  - `attention`  — não impede, mas produz erro a jusante (cobrança sem destinatário).
 *  - `advisory`   — melhoria de governança (referência externa ausente).
 */
export const CLIENT_QUALITY_SEVERITIES = ['blocking', 'attention', 'advisory'] as const;

export type ClientQualitySeverity = (typeof CLIENT_QUALITY_SEVERITIES)[number];

export type ClientQualityFinding = {
  code: ClientQualityFindingCode;
  severity: ClientQualitySeverity;
  /** O que falta, em uma frase que o operador lê sem tradução. */
  summary: string;
  /** Por que isso importa — a consequência operacional concreta, não uma recomendação genérica. */
  consequence: string;
};

/**
 * Fatos PERSISTIDOS de que os apontamentos são derivados.
 *
 * A forma é deliberadamente mínima: o avaliador não recebe o Cliente inteiro, e sim os fatos que
 * ele de fato examina. Isso impede que o módulo passe a derivar coisa que ninguém revisou — a
 * superfície de entrada é o contrato.
 */
export type ClientQualityFacts = {
  status: ClientStatus;
  hasExternalReference: boolean;
  contactPurposes: ContactPurpose[];
  /** Contatos ATIVOS com nome e e-mail ou telefone — o mesmo critério que o backend exige. */
  usableContactPurposes: ContactPurpose[];
  activeContactCount: number;
  primaryContactCount: number;
  addressPurposes: AddressPurpose[];
  unitCount: number;
};

/**
 * Avalia o cadastro e devolve os apontamentos REAIS.
 *
 * A lista é ordenada por severidade decrescente: o operador lê o que bloqueia antes do que é
 * apenas recomendável. A ordem dentro da mesma severidade é a declaração das regras abaixo, que é
 * estável entre chamadas — nenhuma ordenação por texto ou por data, que mudaria a leitura a cada
 * cadastro sem motivo.
 */
export function assessClientDataQuality(facts: ClientQualityFacts): ClientQualityFinding[] {
  const findings: ClientQualityFinding[] = [];

  const hasUsableOperational = facts.usableContactPurposes.includes(
    CONTACT_PURPOSES.Operational,
  );

  if (!hasUsableOperational) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingOperationalContact,
      severity: 'blocking',
      summary: 'Sem contato operacional utilizável.',
      // A consequência é VERDADEIRA e verificável: `assertUpdateClientInput` exige um contato
      // operacional com nome e e-mail ou telefone para aceitar qualquer atualização. Sem ele, o
      // cadastro fica congelado para edição pela API.
      consequence:
        'O cadastro não pode ser atualizado: a atualização exige um contato operacional com nome e e-mail ou telefone.',
    });
  }

  if (!facts.contactPurposes.includes(CONTACT_PURPOSES.Billing)) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingBillingContact,
      severity: 'attention',
      summary: 'Sem contato de faturamento.',
      consequence: 'A cobrança não tem destinatário declarado no cadastro do Cliente.',
    });
  }

  if (facts.addressPurposes.length === 0) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingAnyAddress,
      severity: 'attention',
      summary: 'Nenhum endereço cadastrado.',
      consequence: 'Documentos e entregas não têm endereço de origem no cadastro.',
    });
  } else if (!facts.addressPurposes.includes('billing')) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingBillingAddress,
      severity: 'attention',
      summary: 'Sem endereço de faturamento.',
      consequence: 'A emissão fiscal não tem endereço de cobrança declarado.',
    });
  }

  /*
   * UNIDADE NÃO DECLARADA — só é apontada quando há SINAL REAL de que o Cliente opera em mais de um
   * lugar. Um Cliente com endereços de cidades diferentes e nenhuma unidade declarada está com a
   * estrutura por descrever; um Cliente com um endereço só pode simplesmente ter uma unidade.
   *
   * A checagem usa a CONTAGEM de unidades (zero) e a existência de endereços — ambos persistidos.
   * Não há heurística de nome nem de CNPJ em lugar nenhum.
   */
  if (facts.unitCount === 0 && facts.addressPurposes.length > 1) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingUnitDeclaration,
      severity: 'advisory',
      summary: 'Vários endereços cadastrados e nenhuma unidade declarada.',
      consequence:
        'Sem unidades declaradas, não é possível dizer a qual estabelecimento cada endereço pertence.',
    });
  }

  if (!facts.hasExternalReference) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingExternalReference,
      severity: 'advisory',
      summary: 'Sem referência externa.',
      consequence: 'O Cliente não é correlacionável com o cadastro do ERP de origem.',
    });
  }

  if (facts.activeContactCount > 1 && facts.primaryContactCount === 0) {
    findings.push({
      code: CLIENT_QUALITY_FINDING_CODES.MissingPrimaryContact,
      severity: 'advisory',
      summary: 'Nenhum contato marcado como principal.',
      consequence:
        'Com mais de um contato ativo e nenhum principal, não há destinatário padrão definido.',
    });
  }

  return sortBySeverity(findings);
}

const SEVERITY_ORDER: Record<ClientQualitySeverity, number> = {
  blocking: 0,
  attention: 1,
  advisory: 2,
};

function sortBySeverity(findings: ClientQualityFinding[]): ClientQualityFinding[] {
  // `sort` estável preserva a ordem de declaração dentro da mesma severidade (Node >= 11).
  return [...findings].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
}

/**
 * RESULTADO PUBLICADO.
 *
 * `score` NÃO existe de propósito (ver o cabeçalho do módulo). `findings` vazio significa cadastro
 * sem apontamentos — e isso é afirmado explicitamente por `isComplete`, para que o frontend não
 * tenha de inferir "está tudo certo" de uma lista vazia, que é ambíguo com "não avaliado".
 */
export type ClientDataQuality = {
  evaluated: true;
  isComplete: boolean;
  findings: ClientQualityFinding[];
};

export function buildClientDataQuality(facts: ClientQualityFacts): ClientDataQuality {
  const findings = assessClientDataQuality(facts);
  return { evaluated: true, isComplete: findings.length === 0, findings };
}
