/**
 * F1.1 — READ MODEL DE TRILHA ECONÔMICA (FINANCE → ACCOUNTING).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE CONTRATO RESOLVE
 *
 * Antes da F1.1, um operador via "recebível liquidado" e "contabilidade" como dois
 * mundos: o FINANCE mostrava SETTLED, o ACCOUNTING mostrava journal — ou não mostrava
 * nada, quando o posting falhava em silêncio. Não havia onde ler, numa tela só, que
 * o dinheiro entrou E que a contabilidade reconheceu (ou não).
 *
 * Este read model é a resposta única para:
 *
 *   o que aconteceu → em que estado está → foi contabilizado?
 *   → se não, por quê → quem age → qual o impacto → qual a próxima ação
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O BACKEND É AUTORITATIVO
 *
 * `accountingState`, `postingState`, `situation` e `availableCommands` são DECIDIDOS
 * aqui. O React NÃO pode recalcular nenhum deles — nem com `if status === X`. Foi
 * exatamente esse acoplamento que a F1.1 removeu do backend, e reintroduzi-lo na tela
 * seria mover o problema.
 *
 * `trace` é a cadeia navegável exigida:
 *   receivable/payable → settlement/payment → economic event → posting → journal
 */

/** Estado do FATO econômico no domínio FINANCE. */
export const ECONOMIC_FINANCIAL_STATES = {
  /** Título aberto, nada liquidado. */
  Open: 'OPEN',
  PartiallySettled: 'PARTIALLY_SETTLED',
  Settled: 'SETTLED',
  Reversed: 'REVERSED',
  Cancelled: 'CANCELLED',
} as const;

export type EconomicFinancialState =
  (typeof ECONOMIC_FINANCIAL_STATES)[keyof typeof ECONOMIC_FINANCIAL_STATES];

/** Estado do RECONHECIMENTO contábil do fato. */
export const ECONOMIC_ACCOUNTING_STATES = {
  /** Sem evento econômico publicado (fato ainda não alcançou ACCOUNTING). */
  NotReached: 'NOT_REACHED',
  /** Evento publicado, aguardando decisão contábil. */
  Pending: 'PENDING',
  /** Journal emitido. */
  Posted: 'POSTED',
  /** Compensação emitida (estorno). */
  Reversed: 'REVERSED',
  /** ACCOUNTING recusou/falhou; exige ação. */
  Failed: 'FAILED',
} as const;

export type EconomicAccountingState =
  (typeof ECONOMIC_ACCOUNTING_STATES)[keyof typeof ECONOMIC_ACCOUNTING_STATES];

/**
 * SITUAÇÃO OPERACIONAL — a leitura que o operador precisa, já decidida.
 *
 * `Attention` é o caso que a F1.1 existe para tornar visível: o dinheiro se moveu e a
 * contabilidade não acompanhou. Ele NÃO é um toast: é um item de trabalho.
 */
export const ECONOMIC_SITUATIONS = {
  Consistent: 'CONSISTENT',
  InProgress: 'IN_PROGRESS',
  Attention: 'ATTENTION',
  NotApplicable: 'NOT_APPLICABLE',
} as const;

export type EconomicSituation = (typeof ECONOMIC_SITUATIONS)[keyof typeof ECONOMIC_SITUATIONS];

/** Gravidade declarada pelo backend — a tela não classifica risco. */
export const ECONOMIC_SEVERITIES = {
  Critical: 'CRITICAL',
  Warning: 'WARNING',
  Info: 'INFO',
  None: 'NONE',
} as const;

export type EconomicSeverity = (typeof ECONOMIC_SEVERITIES)[keyof typeof ECONOMIC_SEVERITIES];

/**
 * Comandos que o backend AUTORIZA. O frontend só desenha o que vier aqui — a lista é
 * a decisão de autorização, não uma sugestão de UI.
 */
export const ECONOMIC_COMMANDS = {
  RetryPosting: 'RETRY_POSTING',
  OpenJournal: 'OPEN_JOURNAL',
  OpenEconomicEvent: 'OPEN_ECONOMIC_EVENT',
  ReverseSettlement: 'REVERSE_SETTLEMENT',
  ReversePayment: 'REVERSE_PAYMENT',
  SettleReceivable: 'SETTLE_RECEIVABLE',
  PayPayable: 'PAY_PAYABLE',
  ViewReceivable: 'VIEW_RECEIVABLE',
  ViewPayable: 'VIEW_PAYABLE',
  OpenAccountingPeriod: 'OPEN_ACCOUNTING_PERIOD',
} as const;

export type EconomicCommand = (typeof ECONOMIC_COMMANDS)[keyof typeof ECONOMIC_COMMANDS];

/** Um nó da cadeia rastreável. `route` é o deep link real quando existe. */
export type EconomicTraceNode = {
  kind: 'RECEIVABLE' | 'PAYABLE' | 'SETTLEMENT' | 'PAYMENT' | 'ECONOMIC_EVENT' | 'POSTING' | 'JOURNAL';
  reference: string;
  status: string;
  occurredAt: string | null;
  route: string | null;
};

/** Um passo do plano de posting (regra aplicada + contas). */
export type EconomicPostingRuleFact = {
  ruleId: string | null;
  ruleCode: string | null;
  versionId: string | null;
  versionNumber: number | null;
  debitAccountId: string | null;
  debitAccountLabel: string | null;
  creditAccountId: string | null;
  creditAccountLabel: string | null;
};

export type EconomicPostingFact = {
  state: EconomicAccountingState;
  postingRequestId: string | null;
  journalEntryId: string | null;
  journalNumber: number | null;
  journalKind: string | null;
  postedAt: string | null;
  /** Falha persistida e diagnosticável — nunca transitória. */
  failure: {
    code: string;
    message: string;
    attempts: number;
    maxAttempts: number;
    firstFailedAt: string | null;
    lastFailedAt: string | null;
  } | null;
  rule: EconomicPostingRuleFact | null;
};

export type EconomicNextAction = {
  /** Comando a executar; `null` quando não há ação pendente. */
  command: EconomicCommand | null;
  label: string;
  /** Por que esta é a próxima ação — em linguagem de negócio. */
  reason: string;
  /** Quem deve agir (papel/capability), nunca uma pessoa. */
  owner: string | null;
};

export type EconomicEventSummary = {
  id: string;
  eventKind: string;
  sourceKind: string;
  sourceId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  outboxEventId: string | null;
  /** Estado do TRANSPORTE (outbox) — distinto do estado contábil. */
  transportState: string | null;
  transportAttempts: number | null;
  transportLastError: string | null;
};

/**
 * A leitura completa de UM fato econômico (settlement ou payment).
 *
 * É o payload que a experiência consome — detalhe do título, worklist de exceção e
 * cockpit usam o MESMO contrato, sem cálculo próprio.
 */
/**
 * IDENTIDADE DO FATO ECONÔMICO NA TRILHA.
 *
 * A F1.1 nasceu com dois rótulos porque só FINANCE publicava fato. A F1.2 passou
 * FISCAL, INVENTORY, PAYROLL e FIXED_ASSET a publicar pela mesma espinha, mas o tipo
 * ficou para trás: todo fato que não fosse PAYMENT era rotulado `SETTLEMENT`, gerando
 * rota de trilha inexistente e `ACCOUNTING_NOT_FOUND` para fatos que não são liquidação.
 *
 * O rótulo é derivado do `source_kind` que o próprio fato publicou.
 */
export type EconomicFactKind =
  | 'SETTLEMENT'
  | 'PAYMENT'
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'FISCAL_DOCUMENT'
  | 'TAX_CALCULATION'
  | 'INVENTORY_MOVEMENT'
  | 'PAYROLL_PERIOD'
  | 'FIXED_ASSET';

export type EconomicTraceView = {
  /** Identidade do fato na espinha econômica. */
  factKind: EconomicFactKind;
  factId: string;
  unitId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  situation: EconomicSituation;
  severity: EconomicSeverity;
  /** Frase única, pronta para exibição: "FINANCEIRO: SETTLED · CONTABILIDADE: FAILED". */
  summary: string;
  /** Impacto econômico real, em uma frase de negócio. */
  impact: string | null;
  economicEvent: EconomicEventSummary | null;
  posting: EconomicPostingFact;
  trace: EconomicTraceNode[];
  nextAction: EconomicNextAction;
  availableCommands: EconomicCommand[];
};

/** Item de worklist: exceção econômica que exige ação. */
export type EconomicWorkItem = {
  factKind: EconomicFactKind;
  factId: string;
  unitId: string;
  reference: string;
  amount: string;
  currencyCode: string;
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  situation: EconomicSituation;
  severity: EconomicSeverity;
  /** Motivo persistido da pendência. */
  reason: string;
  /** Quando a falha começou (para envelhecimento real). */
  firstFailedAt: string | null;
  attempts: number;
  nextAction: EconomicNextAction;
  availableCommands: EconomicCommand[];
  /** Deep link para a trilha completa. */
  route: string;
};

export type EconomicWorklistView = {
  /** Contagens do conjunto FILTRADO — a tela nunca inventa total. */
  counts: {
    pending: number;
    failed: number;
    reversed: number;
  };
  items: EconomicWorkItem[];
  limit: number;
  offset: number;
  total: number;
};

/**
 * Frase de situação — derivada pelo BACKEND para que todas as superfícies digam a
 * mesma coisa. A tela não monta este texto.
 */
export function buildEconomicSummary(input: {
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
}): string {
  const financial = {
    OPEN: 'FINANCEIRO: ABERTO',
    PARTIALLY_SETTLED: 'FINANCEIRO: PARCIAL',
    SETTLED: 'FINANCEIRO: LIQUIDADO',
    REVERSED: 'FINANCEIRO: ESTORNADO',
    CANCELLED: 'FINANCEIRO: CANCELADO',
  }[input.financialState];
  const accounting = {
    NOT_REACHED: 'CONTABILIDADE: NÃO ALCANÇADA',
    PENDING: 'CONTABILIDADE: PENDENTE',
    POSTED: 'CONTABILIDADE: CONTABILIZADO',
    REVERSED: 'CONTABILIDADE: ESTORNADO',
    FAILED: 'CONTABILIDADE: FALHOU',
  }[input.accountingState];
  return `${financial} · ${accounting}`;
}
