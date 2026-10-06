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
} as const;

/**
 * Comandos de CONTAS A PAGAR.
 *
 * `allowedStates` usa os estados REAIS do titulo publicados pelo read model
 * (`OPEN`/`PARTIALLY_PAID`/`OVERDUE`/`SETTLED`/`CANCELLED`).
 */
export const PAYABLE_COMMANDS: CommandDefinition[] = [
  {
    id: 'finance.payable.openDetail',
    label: 'Abrir título',
    description: 'Abre o título a pagar com itens, pagamentos e histórico.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.payable },
    execution: { endpoint: '/api/v1/finance/payables/:payableId', method: 'GET' },
    order: 10,
  },
  {
    id: 'finance.payable.registerPayment',
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
    id: 'finance.payable.reversePayment',
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
    id: 'finance.payable.cancel',
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
 * NOTA DE PROCEDENCIA: o comando de baixa (`receive`) NAO declara `capability` porque o nome exato
 * da capability de baixa de recebível ainda nao foi confirmado por fonte no registrador de
 * acessos. Declarar um nome plausivel seria pior que nao declarar: um nome errado ESCONDE a acao
 * (o ator tem a capability real, mas nao a inventada) e o defeito fica invisivel. Sem `capability`,
 * o comando segue o estado do objeto, e o SERVIDOR nega o que for indevido — que e o boundary real.
 * TODO(rastreabilidade): confirmar o nome em `docs/03-requirements/authorization-requirements.md`.
 */
export const RECEIVABLE_COMMANDS: CommandDefinition[] = [
  {
    id: 'finance.receivable.openDetail',
    label: 'Abrir título',
    description: 'Abre o título a receber com parcelas, baixas e originação.',
    intent: 'navigate',
    scope: { entity: FINANCE_ENTITIES.receivable },
    execution: { endpoint: '/api/v1/finance/receivables/:receivableId', method: 'GET' },
    order: 10,
  },
  {
    id: 'finance.receivable.receive',
    label: 'Registrar recebimento',
    description: 'Lança uma baixa contra o título a receber.',
    intent: 'mutate',
    scope: { entity: FINANCE_ENTITIES.receivable },
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
    id: 'finance.receivable.cancel',
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
  ...TREASURY_COMMANDS,
];
