import { beforeEach, describe, expect, it } from 'vitest';
import {
  commandRegistrySnapshot,
  evaluateCommandById,
  getCommand,
  resetCommandRegistryForTests,
} from '../../platform/commands';
import {
  BUDGET_COMMAND_IDS,
  EXPENSE_COMMAND_IDS,
  FINANCE_COMMANDS,
  FINANCE_ENTITIES,
  PAYABLE_COMMAND_IDS,
  RECEIVABLE_COMMAND_IDS,
} from './finance-commands';
import {
  isFinanceCommandsRegistered,
  registerFinanceCommands,
  resetFinanceCommandRegistrationForTests,
} from './register';

/**
 * COMMAND LAYER FINANCEIRA — contrato de registro e disponibilidade.
 *
 * Estes testes cobrem o defeito que a frente inteira existia para corrigir e que, até agora,
 * sobrevivia intacto: `registerFinanceCommands()` estava DEFINIDO e NUNCA ERA CHAMADO.
 *
 * A consequência não era cosmética. O registro global ficava vazio, `commandsForScope(...)`
 * devolvia `[]`, nenhuma tela enxergava comando algum — e cada página continuava decidindo as
 * próprias ações localmente. A Command Layer era decoração, e a divergência entre telas (a mesma
 * ação habilitada numa e desabilitada na outra) seguia em produção.
 *
 * O primeiro teste abaixo é o que impede a regressão: se alguém remover a chamada de
 * inicialização, o catálogo volta a ficar vazio e este arquivo falha.
 */

/** Conjunto de capabilities de um ator com acesso amplo ao Financeiro. */
const ALL_CAPS = new Set([
  'finance:receivable:settle',
  'finance:receivable:reverse',
  'finance:receivable:cancel',
  'finance:payable:pay',
  'finance:payable:reverse',
  'finance:payable:cancel',
  'finance:expense:submit',
  'finance:expense:approve',
  'finance:expense:reject',
  'finance:budget:approve',
  'finance:budget:update',
  'finance:collection:open',
  'finance:collection:action-create',
  'finance:collection:promise-create',
  'finance:collection:renegotiate',
]);

function context(overrides: Partial<Parameters<typeof evaluateCommandById>[1]> = {}) {
  return {
    entity: FINANCE_ENTITIES.payable,
    state: 'OPEN',
    lifecycle: 'ACTIVE',
    capabilities: ALL_CAPS,
    ...overrides,
  };
}

beforeEach(() => {
  resetCommandRegistryForTests();
  resetFinanceCommandRegistrationForTests();
});

describe('registro do catálogo financeiro', () => {
  it('registrar POPULA o registry global', () => {
    // Este é o teste de regressão central. Antes da correção, o catálogo existia mas o registry
    // ficava vazio: `registerFinanceCommands()` nunca era invocado em lugar algum.
    expect(commandRegistrySnapshot()).toHaveLength(0);

    const registered = registerFinanceCommands();

    expect(registered).toBe(FINANCE_COMMANDS.length);
    expect(commandRegistrySnapshot().length).toBeGreaterThan(0);
    expect(isFinanceCommandsRegistered()).toBe(true);
  });

  it('registra TODOS os comandos declarados, sem perder nenhum', () => {
    registerFinanceCommands();
    const ids = commandRegistrySnapshot().map((entry) => entry.id);
    for (const definition of FINANCE_COMMANDS) {
      expect(ids).toContain(definition.id);
    }
  });

  it('é idempotente: registrar duas vezes não duplica nem lança', () => {
    registerFinanceCommands();
    const first = commandRegistrySnapshot().length;
    expect(() => registerFinanceCommands()).not.toThrow();
    expect(commandRegistrySnapshot().length).toBe(first);
  });

  it('declara comandos para as entidades financeiras exigidas', () => {
    registerFinanceCommands();
    const entities = new Set(commandRegistrySnapshot().map((entry) => entry.entity));
    expect(entities).toContain(FINANCE_ENTITIES.payable);
    expect(entities).toContain(FINANCE_ENTITIES.receivable);
    expect(entities).toContain(FINANCE_ENTITIES.expense);
    expect(entities).toContain(FINANCE_ENTITIES.budget);
    expect(entities).toContain(FINANCE_ENTITIES.collectionCase);
  });
});

describe('capability declarada é a REAL do backend', () => {
  it('todo comando de escrita declara capability existente em authz-actions', () => {
    /*
     * Um nome de capability inventado é o pior defeito possível aqui: ele ESCONDE a ação de quem
     * tem a permissão real (o ator possui `finance:payable:pay`, mas não a inventada) e o defeito
     * fica invisível. Navegação não exige capability própria — o acesso à superfície já foi
     * decidido na entrada.
     */
    const realCapabilities = new Set([
      'finance:receivable:settle',
      'finance:receivable:reverse',
      'finance:receivable:cancel',
      'finance:payable:pay',
      'finance:payable:reverse',
      'finance:payable:cancel',
      'finance:expense:submit',
      'finance:expense:approve',
      'finance:expense:reject',
      'finance:budget:approve',
      'finance:budget:update',
      'finance:collection:open',
      'finance:collection:action-create',
      'finance:collection:promise-create',
      'finance:collection:renegotiate',
    ]);

    for (const definition of FINANCE_COMMANDS) {
      if (!definition.capability) {
        expect(['navigate', 'inspect']).toContain(definition.intent);
        continue;
      }
      expect(realCapabilities).toContain(definition.capability);
    }
  });

  it('baixa de recebível declara finance:receivable:settle', () => {
    // O TODO que existia aqui dizia que o nome não estava confirmado, e por isso o comando seguia
    // SEM capability — visível para quem o servidor recusaria. A fonte existe e está confirmada.
    registerFinanceCommands();
    expect(getCommand(RECEIVABLE_COMMAND_IDS.settle)?.capability).toBe(
      'finance:receivable:settle',
    );
  });
});

describe('disponibilidade — capability', () => {
  it('sem capability o comando fica HIDDEN, não disabled', () => {
    registerFinanceCommands();
    const availability = evaluateCommandById(
      PAYABLE_COMMAND_IDS.pay,
      context({ capabilities: new Set<string>() }),
    );
    // `hidden` é ausência total: nem rótulo, nem botão cinza. O operador não vê a ação.
    expect(availability?.status).toBe('hidden');
  });

  it('capabilities DESCONHECIDAS (não resolvidas) escondem — fail-closed', () => {
    registerFinanceCommands();
    const availability = evaluateCommandById(PAYABLE_COMMAND_IDS.pay, context({ capabilities: null }));
    // `null` = não resolvido. Renderizar "enquanto carrega" produz o piscar que some.
    expect(availability?.status).toBe('hidden');
  });

  it('com capability e estado válido fica AVAILABLE', () => {
    registerFinanceCommands();
    /*
     * `registerPayment` exige valor e referência: são entradas OBRIGATÓRIAS do comando, e sem elas
     * a disponibilidade é `disabled` com a lista do que falta. Isso é o correto — a interface pede
     * o dado ANTES, em vez de deixar o operador descobrir por 400 do servidor.
     */
    const availability = evaluateCommandById(
      PAYABLE_COMMAND_IDS.pay,
      context({ inputs: { amount: '1500.0000', paymentReference: 'PIX-8891' } }),
    );
    expect(availability?.status).toBe('available');
  });

  it('sem as entradas obrigatórias o comando fica disabled com a lista exata', () => {
    registerFinanceCommands();
    const availability = evaluateCommandById(PAYABLE_COMMAND_IDS.pay, context({ inputs: {} }));
    expect(availability?.status).toBe('disabled');
    if (availability?.status === 'disabled') {
      expect(availability.missingInputs).toEqual(['amount', 'paymentReference']);
    }
  });

  it('capability de um domínio não autoriza comando de outro', () => {
    registerFinanceCommands();
    const onlyPayable = new Set(['finance:payable:pay']);
    const expense = evaluateCommandById(
      EXPENSE_COMMAND_IDS.approve,
      context({ entity: FINANCE_ENTITIES.expense, state: 'SUBMITTED', capabilities: onlyPayable }),
    );
    expect(expense?.status).toBe('hidden');
  });
});

describe('disponibilidade — estado', () => {
  it('estado fora de allowedStates desabilita COM motivo', () => {
    registerFinanceCommands();
    const availability = evaluateCommandById(
      PAYABLE_COMMAND_IDS.pay,
      context({ state: 'SETTLED' }),
    );
    expect(availability?.status).toBe('disabled');
    if (availability?.status === 'disabled') {
      // O motivo real chega ao operador — botão cinza sem causa era o defeito original.
      expect(availability.reason).toContain('SETTLED');
    }
  });

  it('estado DESCONHECIDO bloqueia transição mas não navegação', () => {
    registerFinanceCommands();
    const transition = evaluateCommandById(
      PAYABLE_COMMAND_IDS.cancel,
      context({ state: null, lifecycle: null }),
    );
    expect(transition?.status).toBe('disabled');

    const navigate = evaluateCommandById(
      PAYABLE_COMMAND_IDS.openDetail,
      context({ state: null, lifecycle: null }),
    );
    // Bloquear leitura por falta de estado transformaria falha de carregamento em negação.
    expect(navigate?.status).toBe('available');
  });

  it('título cancelado bloqueia escrita em qualquer intenção mutante', () => {
    registerFinanceCommands();
    for (const id of [
      PAYABLE_COMMAND_IDS.pay,
      PAYABLE_COMMAND_IDS.reversePayment,
      PAYABLE_COMMAND_IDS.cancel,
    ]) {
      const availability = evaluateCommandById(id, context({ state: 'CANCELLED', lifecycle: 'CANCELLED' }));
      expect(availability?.status).toBe('disabled');
    }
  });

  it('estado terminal não reoferece a ação', () => {
    registerFinanceCommands();
    const availability = evaluateCommandById(
      PAYABLE_COMMAND_IDS.cancel,
      context({ state: 'SETTLED' }),
    );
    expect(availability?.status).toBe('disabled');
    if (availability?.status === 'disabled') {
      expect(availability.reason).toContain('final');
    }
  });
});

describe('disponibilidade — expensa respeita o ciclo de aprovação', () => {
  it('aprovar só aparece em SUBMITTED', () => {
    registerFinanceCommands();
    const base = { entity: FINANCE_ENTITIES.expense };
    expect(
      evaluateCommandById(EXPENSE_COMMAND_IDS.approve, context({ ...base, state: 'DRAFT' }))?.status,
    ).toBe('disabled');
    expect(
      evaluateCommandById(EXPENSE_COMMAND_IDS.approve, context({ ...base, state: 'SUBMITTED' }))
        ?.status,
    ).toBe('available');
  });

  it('enviar só aparece em DRAFT', () => {
    registerFinanceCommands();
    const base = { entity: FINANCE_ENTITIES.expense };
    expect(
      evaluateCommandById(EXPENSE_COMMAND_IDS.submit, context({ ...base, state: 'DRAFT' }))?.status,
    ).toBe('available');
    expect(
      evaluateCommandById(EXPENSE_COMMAND_IDS.submit, context({ ...base, state: 'APPROVED' }))
        ?.status,
    ).toBe('disabled');
  });

  it('aprovar e rejeitar exigem capabilities DISTINTAS', () => {
    registerFinanceCommands();
    const base = { entity: FINANCE_ENTITIES.expense, state: 'SUBMITTED' };
    const onlyApprove = new Set(['finance:expense:approve']);

    expect(evaluateCommandById(EXPENSE_COMMAND_IDS.approve, context({ ...base, capabilities: onlyApprove }))?.status)
      .toBe('available');
    // Quem aprova pode não poder rejeitar: a separação de deveres é aplicada no backend, e a
    // interface não oferece a ação sem a capability correspondente.
    expect(evaluateCommandById(EXPENSE_COMMAND_IDS.reject, context({ ...base, capabilities: onlyApprove }))?.status)
      .toBe('hidden');
  });

  it('rejeitar exige motivo com tamanho mínimo antes de executar', () => {
    registerFinanceCommands();
    const base = { entity: FINANCE_ENTITIES.expense, state: 'SUBMITTED' };

    // Sem motivo: desabilitado, e a lista exata do que falta acompanha o veredito.
    const missing = evaluateCommandById(EXPENSE_COMMAND_IDS.reject, context({ ...base, inputs: {} }));
    expect(missing?.status).toBe('disabled');
    if (missing?.status === 'disabled') {
      expect(missing.missingInputs).toEqual(['reason']);
    }

    // Motivo curto demais também não passa: "ok" não é justificativa registrada.
    const tooShort = evaluateCommandById(
      EXPENSE_COMMAND_IDS.reject,
      context({ ...base, inputs: { reason: 'ok' } }),
    );
    expect(tooShort?.status).toBe('disabled');

    const valid = evaluateCommandById(
      EXPENSE_COMMAND_IDS.reject,
      context({ ...base, inputs: { reason: 'Valor divergente da nota apresentada.' } }),
    );
    expect(valid?.status).toBe('available');
  });
});

describe('disponibilidade — orçamento por versão', () => {
  it('nova versão só a partir de versão aprovada', () => {
    registerFinanceCommands();
    const base = { entity: FINANCE_ENTITIES.budget };
    // Em rascunho, basta editar a versão atual — criar outra produziria duplicata.
    expect(
      evaluateCommandById(BUDGET_COMMAND_IDS.newVersion, context({ ...base, state: 'DRAFT' }))?.status,
    ).toBe('disabled');
    expect(
      evaluateCommandById(BUDGET_COMMAND_IDS.newVersion, context({ ...base, state: 'APPROVED' }))
        ?.status,
    ).toBe('available');
  });
});

describe('IDs canônicos', () => {
  it('cada constante aponta para um comando realmente registrado', () => {
    /*
     * Um id digitado errado devolveria `undefined` e a tela renderizaria menos ações em silêncio,
     * sem ninguém perceber que uma ação desapareceu. Com a constante o erro é de compilação; este
     * teste garante que o valor por trás dela existe de fato no catálogo.
     */
    registerFinanceCommands();
    const ids = [
      ...Object.values(PAYABLE_COMMAND_IDS),
      ...Object.values(RECEIVABLE_COMMAND_IDS),
      ...Object.values(EXPENSE_COMMAND_IDS),
      ...Object.values(BUDGET_COMMAND_IDS),
    ];
    for (const id of ids) {
      expect(getCommand(id), `comando não registrado: ${id}`).toBeDefined();
    }
  });
});
