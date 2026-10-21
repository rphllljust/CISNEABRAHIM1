/**
 * CATALOGO DE COMANDOS — FINANCEIRO
 *
 * As acoes reais do dominio financeiro, declaradas UMA vez. Antes, cada tela montava o proprio
 * botao e a propria regra de `disabled`; a MESMA acao aparecia habilitada na lista e desabilitada
 * no detalhe, e o motivo real de indisponibilidade nao chegava ao operador.
 *
 * Conforme a Pagina 11 do relatorio, o Command Registry transforma essas acoes em algo SISTEMICO.
 *
 * ---------------------------------------------------------------------------------------------
 * PROCEDENCIA DE CADA REGRA (nada aqui e inventado no front)
 * ---------------------------------------------------------------------------------------------
 *
 * `finance.payable.reversePayment` espelha LITERALMENTE `payable-actions.ts`, que por sua vez
 * espelha `apps/api/src/finance/domain/payable.validation.ts` (`validateReversePaymentInput`):
 *
 *   - so pagamento com `kind = PAYMENT` pode ser estornado (REVERSAL lanca
 *     FINANCE_PAYMENT_IMMUTABLE no servidor);
 *   - pagamento ja estornado nao pode ser estornado de novo (FINANCE_PAYMENT_ALREADY_REVERSED);
 *   - o titulo precisa estar ATIVO — o repositorio rejeita cancelado antes de validar a versao.
 *
 * As capabilities sao as que o backend ja exige hoje, no formato do PDP. Onde a capability real
 * ainda nao foi confirmada por fonte, o comando declara a ausencia em vez de inventar um nome: ver
 * a nota de `finance.receivable.receive` abaixo.
 *
 * O handler NAO inventa endpoint nem payload. Cada um aponta para a funcao real do cliente de API
 * (`finance-api.ts`), que e quem ja trata idempotencia, rowVersion e traducao de erro.
 */

import type { CommandDefinition } from '../../platform/commands';

/** Entidades financeiras com comandos registrados. */
export const FINANCE_ENTITIES = {
  payable: 'finance.payable',
  receivable: 'finance.receivable',
  treasuryAccount: 'finance.treasuryAccount',
  expense: 'finance.expense',
  budget: 'finance.budget',
  collectionCase: 'finance.collectionCase',
} as const;

/**
 * IDs canônicos por entidade.
 *
 * Existem para que as telas se refiram a um comando por NOME, não por string solta copiada: um id
 * digitado errado devolveria `undefined` e a tela renderizaria menos ações em silêncio, sem que
 * ninguém percebesse que uma ação desapareceu. Com a constante, o erro é de compilação.
 */
export const PAYABLE_COMMAND_IDS = {
  openDetail: 'finance.payable.openDetail',
  pay: 'finance.payable.registerPayment',
  reversePayment: 'finance.payable.reversePayment',
  cancel: 'finance.payable.cancel',
} as const;

export const RECEIVABLE_COMMAND_IDS = {
  openDetail: 'finance.receivable.openDetail',
  settle: 'finance.receivable.settle',
  reverseSettlement: 'finance.receivable.reverseSettlement',
  cancel: 'finance.receivable.cancel',
} as const;

export const EXPENSE_COMMAND_IDS = {
  submit: 'finance.expense.submit',
  approve: 'finance.expense.approve',
  reject: 'finance.expense.reject',
} as const;

export const BUDGET_COMMAND_IDS = {
  approve: 'finance.budget.approve',
  newVersion: 'finance.budget.newVersion',
} as const;

/**
 * Comandos de CONTAS A PAGAR.
 *
 * `allowedStates` usa os estados REAIS do titulo publicados pelo read model
 * (`OPEN`/`PARTIALLY_PAID`/`OVERDUE`/`SETTLED`/`CANCELLED`).
 */
export const PAYABLE_COMMANDS: CommandDefinition[] = [
  {
    id: PAYABLE_COMMAND_IDS.openDetail,
    label: 'Abrir título',
    description: 'Abre o título a pagar com itens, pagamentos e histórico.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.payable },
    execution: { endpoint: '/api/v1/finance/payables/:payableId', method: 'GET' },
    order: 10,
  },
  {
    id: PAYABLE_COMMAND_IDS.pay,
    label: 'Registrar pagamento',
    description: 'Lança um pagamento contra o título a pagar.',
    intent: 'mutate',
    scope: { entity: FINANCE_ENTITIES.payable },
    capability: 'finance:payable:pay',
    // Titulo liquidado ou cancelado nao recebe pagamento novo.
    allowedStates: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'],
    inputs: [
      {
        name: 'amount',
        label: 'Valor do pagamento',
        hint: 'Use o formato decimal do domínio, ex.: 1500.0000.',
        required: true,
      },
      {
        name: 'paymentReference',
        label: 'Referência do pagamento',
        hint: 'Identificador do pagamento no banco ou no meio utilizado.',
        required: true,
      },
    ],
    confirmation: {
      title: 'Confirmar pagamento',
      consequence:
        'O pagamento é gravado no título e passa a compor o saldo quitado. O estorno exige um lançamento de reversão explícito.',
      confirmLabel: 'Registrar pagamento',
    },
    execution: {
      endpoint: '/api/v1/finance/payables/:payableId/payments',
      method: 'POST',
    },
    order: 20,
    group: 'Pagamento',
  },
  {
    id: PAYABLE_COMMAND_IDS.reversePayment,
    label: 'Estornar pagamento',
    description:
      'Reverte um pagamento lançado. Só pagamentos do tipo PAYMENT, ainda não estornados, em título ativo.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.payable },
    capability: 'finance:payable:reverse',
    allowedStates: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE', 'SETTLED'],
    inputs: [
      {
        name: 'paymentReference',
        label: 'Referência do pagamento',
        hint: 'Selecione o pagamento a estornar.',
        required: true,
      },
      {
        name: 'reason',
        label: 'Motivo do estorno',
        hint: 'Justificativa registrada em auditoria. Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Estornar pagamento',
      consequence:
        'O estorno é IRREVERSÍVEL: ele zera o efeito do pagamento no saldo do título e não pode ser desfeito — uma correção exige novo pagamento.',
      confirmLabel: 'Estornar pagamento',
    },
    execution: {
      endpoint: '/api/v1/finance/payables/:payableId/payments/:paymentId/reverse',
      method: 'POST',
    },
    order: 30,
    group: 'Pagamento',
  },
  {
    id: PAYABLE_COMMAND_IDS.cancel,
    label: 'Cancelar título',
    description: 'Cancela o título a pagar. Não pode ser revertido.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.payable },
    capability: 'finance:payable:cancel',
    // Só titulo ainda nao liquidado pode ser cancelado.
    allowedStates: ['OPEN', 'OVERDUE'],
    terminalStates: ['SETTLED', 'CANCELLED'],
    inputs: [
      {
        name: 'reason',
        label: 'Motivo do cancelamento',
        hint: 'Registrado em auditoria. Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Cancelar título a pagar',
      consequence:
        'O título sai das listas operacionais e não aceita mais pagamento nem alteração. O cancelamento é IRREVERSÍVEL.',
      confirmLabel: 'Cancelar título',
    },
    execution: {
      endpoint: '/api/v1/finance/payables/:payableId/cancel',
      method: 'POST',
    },
    order: 90,
    group: 'Título',
  },
];

/**
 * Comandos de CONTAS A RECEBER.
 *
 * CAPABILITY DE BAIXA CONFIRMADA: `finance:receivable:settle`.
 *
 * O TODO anterior dizia que o nome nao estava confirmado e por isso o comando seguia sem
 * `capability`. A fonte existe: `apps/api/src/authorization/types/authz-actions.ts` declara
 * `FinanceReceivableSettle: 'finance:receivable:settle'`, e e essa a capability que
 * `receivables-access.service` exige na baixa. Nao declarar deixava o comando visivel para quem
 * o servidor recusaria — exatamente o "botao que nega depois do clique" que o registry elimina.
 */
export const RECEIVABLE_COMMANDS: CommandDefinition[] = [
  {
    id: RECEIVABLE_COMMAND_IDS.openDetail,
    label: 'Abrir título',
    description: 'Abre o título a receber com parcelas, baixas e originação.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.receivable },
    execution: { endpoint: '/api/v1/finance/receivables/:receivableId', method: 'GET' },
    order: 10,
  },
  {
    id: RECEIVABLE_COMMAND_IDS.settle,
    label: 'Registrar recebimento',
    description: 'Lança uma baixa contra o título a receber.',
    intent: 'mutate',
    scope: { entity: FINANCE_ENTITIES.receivable },
    capability: 'finance:receivable:settle',
    allowedStates: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'],
    inputs: [
      {
        name: 'amount',
        label: 'Valor recebido',
        hint: 'Formato decimal do domínio, ex.: 2500.0000.',
        required: true,
      },
      {
        name: 'settlementReference',
        label: 'Referência da baixa',
        required: true,
      },
    ],
    confirmation: {
      title: 'Confirmar recebimento',
      consequence:
        'A baixa é gravada e passa a compor o valor liquidado do título.',
      confirmLabel: 'Registrar recebimento',
    },
    execution: {
      endpoint: '/api/v1/finance/receivables/:receivableId/settlements',
      method: 'POST',
    },
    order: 20,
    group: 'Baixa',
  },
  {
    id: RECEIVABLE_COMMAND_IDS.reverseSettlement,
    label: 'Estornar baixa',
    description:
      'Reverte uma baixa lançada. A baixa original permanece no histórico; o estorno é um registro próprio.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.receivable },
    capability: 'finance:receivable:reverse',
    allowedStates: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE', 'SETTLED'],
    inputs: [
      {
        name: 'settlementReference',
        label: 'Referência da baixa',
        hint: 'Selecione a baixa a estornar.',
        required: true,
      },
      {
        name: 'reason',
        label: 'Motivo do estorno',
        hint: 'Justificativa registrada em auditoria. Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Estornar baixa',
      consequence:
        'O estorno é IRREVERSÍVEL: ele anula o efeito da baixa no saldo do título e não pode ser desfeito — uma correção exige nova baixa.',
      confirmLabel: 'Estornar baixa',
    },
    execution: {
      endpoint: '/api/v1/finance/receivables/:receivableId/settlements/:settlementId/reverse',
      method: 'POST',
    },
    order: 30,
    group: 'Baixa',
  },
  {
    id: RECEIVABLE_COMMAND_IDS.cancel,
    label: 'Cancelar título',
    description: 'Cancela o título a receber.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.receivable },
    capability: 'finance:receivable:cancel',
    allowedStates: ['OPEN', 'OVERDUE'],
    terminalStates: ['SETTLED', 'CANCELLED'],
    inputs: [
      {
        name: 'reason',
        label: 'Motivo do cancelamento',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Cancelar título a receber',
      consequence:
        'O título sai das listas operacionais e da projeção de caixa. O cancelamento é IRREVERSÍVEL.',
      confirmLabel: 'Cancelar título',
    },
    execution: {
      endpoint: '/api/v1/finance/receivables/:receivableId/cancel',
      method: 'POST',
    },
    order: 90,
    group: 'Título',
  },
];

/**
 * Comandos de DESPESAS (`finance.expense`).
 *
 * ESTADOS REAIS (`apps/api/src/finance/domain/expense.ts`): DRAFT → SUBMITTED → APPROVED|REJECTED.
 *
 * A regra de transicao vive no dominio do servidor (`assertExpenseSubmittable` e afins, que
 * recusam qualquer origem diferente de DRAFT). Aqui ela e ESPELHADA apenas para nao oferecer uma
 * acao que o servidor vai negar — o servidor continua sendo quem decide.
 *
 * `approve`/`reject` exigem capabilities distintas (`finance:expense:approve` e
 * `finance:expense:reject`): quem aprova pode nao poder rejeitar, e a separacao de deveres e
 * aplicada no backend com SoD. O comando apenas nao aparece sem a capability correspondente.
 */
export const EXPENSE_COMMANDS: CommandDefinition[] = [
  {
    id: EXPENSE_COMMAND_IDS.submit,
    label: 'Enviar para aprovação',
    description: 'Submete a despesa em rascunho para a alçada de aprovação.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.expense },
    capability: 'finance:expense:submit',
    allowedStates: ['DRAFT'],
    terminalStates: ['APPROVED', 'REJECTED'],
    confirmation: {
      title: 'Enviar despesa para aprovação',
      consequence:
        'A despesa deixa de ser editável e passa a aguardar decisão da alçada. Um novo envio só é possível após rejeição.',
      confirmLabel: 'Enviar para aprovação',
    },
    execution: { endpoint: '/api/v1/finance/expenses/:expenseId/submit', method: 'POST' },
    order: 20,
    group: 'Aprovação',
  },
  {
    id: EXPENSE_COMMAND_IDS.approve,
    label: 'Aprovar despesa',
    description: 'Aprova a despesa submetida, liberando o título a pagar correspondente.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.expense },
    capability: 'finance:expense:approve',
    allowedStates: ['SUBMITTED'],
    terminalStates: ['APPROVED', 'REJECTED'],
    confirmation: {
      title: 'Aprovar despesa',
      consequence:
        'A despesa é aprovada e passa a compor o compromisso financeiro da unidade. A decisão é registrada em auditoria com a sua identidade.',
      confirmLabel: 'Aprovar despesa',
    },
    execution: { endpoint: '/api/v1/finance/expenses/:expenseId/approve', method: 'POST' },
    order: 30,
    group: 'Aprovação',
  },
  {
    id: EXPENSE_COMMAND_IDS.reject,
    label: 'Rejeitar despesa',
    description: 'Rejeita a despesa submetida, devolvendo-a para correção.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.expense },
    capability: 'finance:expense:reject',
    allowedStates: ['SUBMITTED'],
    terminalStates: ['APPROVED', 'REJECTED'],
    inputs: [
      {
        name: 'reason',
        label: 'Motivo da rejeição',
        hint: 'Fica registrado para quem submeteu. Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Rejeitar despesa',
      consequence:
        'A despesa volta com a rejeição registrada e não segue para pagamento. O motivo fica visível para quem a submeteu.',
      confirmLabel: 'Rejeitar despesa',
    },
    execution: { endpoint: '/api/v1/finance/expenses/:expenseId/reject', method: 'POST' },
    order: 40,
    group: 'Aprovação',
  },
];

/**
 * Comandos de ORÇAMENTO (`finance.budget`).
 *
 * O ciclo do orçamento é por VERSÃO: `DRAFT` → `APPROVED` (`BUDGET_VERSION_STATUSES`). Aprovar um
 * orçamento é aprovar uma VERSÃO, não o documento — e "nova versão" é a forma correta de corrigir
 * um orçamento já aprovado, porque fato aprovado não é editado.
 *
 * O estado que o contexto entrega é o da versão corrente.
 */
export const BUDGET_COMMANDS: CommandDefinition[] = [
  {
    id: BUDGET_COMMAND_IDS.approve,
    label: 'Aprovar orçamento',
    description: 'Aprova a versão em rascunho do orçamento, tornando-a a versão vigente.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.budget },
    capability: 'finance:budget:approve',
    allowedStates: ['DRAFT'],
    terminalStates: ['APPROVED'],
    confirmation: {
      title: 'Aprovar versão do orçamento',
      consequence:
        'A versão passa a ser a vigente e deixa de ser editável. Correções exigem uma NOVA VERSÃO — a versão aprovada é preservada no histórico.',
      confirmLabel: 'Aprovar orçamento',
    },
    execution: { endpoint: '/api/v1/finance/budgets/:budgetId/approve', method: 'POST' },
    order: 20,
    group: 'Versão',
  },
  {
    id: BUDGET_COMMAND_IDS.newVersion,
    label: 'Nova versão',
    description:
      'Abre uma nova versão em rascunho a partir da versão vigente, sem alterar a aprovada.',
    intent: 'create',
    scope: { entity: FINANCE_ENTITIES.budget },
    capability: 'finance:budget:update',
    // Só faz sentido a partir de uma versão já aprovada: em rascunho, basta editar a atual.
    allowedStates: ['APPROVED'],
    confirmation: {
      title: 'Criar nova versão do orçamento',
      consequence:
        'Uma nova versão em rascunho é criada com os valores vigentes copiados. A versão aprovada permanece intacta no histórico.',
      confirmLabel: 'Criar nova versão',
    },
    execution: { endpoint: '/api/v1/finance/budgets/:budgetId/versions', method: 'POST' },
    order: 30,
    group: 'Versão',
  },
];

/**
 * Comandos de COBRANÇA (`finance.collectionCase`).
 *
 * O caso de cobrança nasce de uma baixa em aberto: `finance:collection:open` abre, e as acoes
 * seguintes (`action`, `promise`, `renegotiate`) são registros do histórico do caso — nenhuma
 * delas altera o principal nem o vencimento do título, que é invariante do domínio.
 */
export const COLLECTION_COMMANDS: CommandDefinition[] = [
  {
    id: 'finance.collectionCase.open',
    label: 'Abrir caso de cobrança',
    description: 'Abre um caso de cobrança para o título em atraso.',
    intent: 'create',
    scope: { entity: FINANCE_ENTITIES.collectionCase },
    capability: 'finance:collection:open',
    allowedStates: ['OVERDUE'],
    terminalStates: ['CLOSED'],
    confirmation: {
      title: 'Abrir caso de cobrança',
      consequence:
        'O título passa a ter um caso de cobrança aberto, com histórico próprio de ações e promessas.',
      confirmLabel: 'Abrir caso',
    },
    execution: { endpoint: '/api/v1/finance/collections', method: 'POST' },
    order: 20,
    group: 'Cobrança',
  },
  {
    id: 'finance.collectionCase.registerAction',
    label: 'Registrar ação de cobrança',
    description: 'Registra uma tratativa realizada no caso (contato, notificação, visita).',
    intent: 'mutate',
    scope: { entity: FINANCE_ENTITIES.collectionCase },
    capability: 'finance:collection:action-create',
    allowedStates: ['OPEN'],
    terminalStates: ['CLOSED'],
    inputs: [
      {
        name: 'notes',
        label: 'Descrição da tratativa',
        hint: 'O que foi feito e qual foi a resposta. Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    execution: { endpoint: '/api/v1/finance/collections/:caseId/actions', method: 'POST' },
    order: 30,
    group: 'Cobrança',
  },
  {
    id: 'finance.collectionCase.registerPromise',
    label: 'Registrar promessa de pagamento',
    description: 'Registra a promessa de pagamento acordada com o cliente.',
    intent: 'mutate',
    scope: { entity: FINANCE_ENTITIES.collectionCase },
    capability: 'finance:collection:promise-create',
    allowedStates: ['OPEN'],
    terminalStates: ['CLOSED'],
    inputs: [
      {
        name: 'promisedDate',
        label: 'Data prometida',
        hint: 'Formato AAAA-MM-DD.',
        required: true,
      },
      {
        name: 'amount',
        label: 'Valor prometido',
        hint: 'Formato decimal, ex.: 3000.0000.',
        required: true,
      },
    ],
    execution: { endpoint: '/api/v1/finance/collections/:caseId/promises', method: 'POST' },
    order: 40,
    group: 'Cobrança',
  },
  {
    id: 'finance.collectionCase.renegotiate',
    label: 'Renegociar',
    description:
      'Registra a renegociação do caso. Não altera principal nem vencimento do título.',
    intent: 'transition',
    scope: { entity: FINANCE_ENTITIES.collectionCase },
    capability: 'finance:collection:renegotiate',
    allowedStates: ['OPEN'],
    terminalStates: ['CLOSED'],
    inputs: [
      {
        name: 'reason',
        label: 'Condições renegociadas',
        hint: 'Mínimo de 10 caracteres.',
        required: true,
        minLength: 10,
      },
    ],
    confirmation: {
      title: 'Renegociar caso de cobrança',
      consequence:
        'A renegociação é registrada no histórico do caso. O principal e o vencimento do título NÃO mudam — a renegociação é um registro de tratativa, não uma alteração do título.',
      confirmLabel: 'Renegociar',
    },
    execution: { endpoint: '/api/v1/finance/collections/:caseId/renegotiate', method: 'POST' },
    order: 50,
    group: 'Cobrança',
  },
];

/** Comandos de CONTA DE TESOURARIA (caixa e bancos). */
export const TREASURY_COMMANDS: CommandDefinition[] = [
  {
    id: 'finance.treasuryAccount.openDetail',
    label: 'Abrir conta',
    description: 'Abre a conta com extrato, transferências e conciliação.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.treasuryAccount },
    /*
     * `to` com o identificador do objeto em foco: o contrato exige `execution`, e a navegacao do
     * command registry resolve o destino a partir do alvo. Sem `:accountId` os dois comandos de
     * tesouraria nao tinham destino declarado e o typecheck os recusava — a acao existia no
     * catalogo sem caminho de execucao.
     */
    execution: { to: '/app/finance/treasury/:accountId', method: 'GET' },
    order: 10,
  },
  {
    id: 'finance.treasuryAccount.reconcile',
    label: 'Conciliar extrato',
    description: 'Abre a conciliação bancária da conta.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.treasuryAccount },
    execution: { to: '/app/finance/reconciliation', method: 'GET' },
    order: 20,
  },
];

/** Catalogo completo do modulo financeiro. Registrado uma vez na inicializacao do modulo. */
export const FINANCE_COMMANDS: CommandDefinition[] = [
  ...PAYABLE_COMMANDS,
  ...RECEIVABLE_COMMANDS,
  ...EXPENSE_COMMANDS,
  ...BUDGET_COMMANDS,
  ...COLLECTION_COMMANDS,
  ...TREASURY_COMMANDS,
];
