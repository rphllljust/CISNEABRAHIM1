/**
 * COMMAND REGISTRY — AVALIACAO E RESOLUCAO
 *
 * Uma unica funcao (`evaluateCommand`) decide a disponibilidade de QUALQUER comando em QUALQUER
 * tela. Antes, essa decisao estava copiada em cada pagina, e as copias divergiam.
 *
 * ORDEM DE DECISAO (importa, e a ordem e deliberada):
 *
 *   1. ESCOPO      — o comando e desta entidade/view? Se nao, `hidden`. Nao e negacao: e outro
 *                    comando. Nunca aparece "desabilitado" por ser de outro objeto.
 *   2. CAPABILITY  — sem capability, `hidden`. A regra do contrato de objeto (`read A != read B`)
 *                    vale aqui: o operador nao ve nem o rotulo.
 *   3. ESTADO      — estado atual conhecido e fora de `allowedStates`? `disabled` com o motivo.
 *                    Estado DESCONHECIDO bloqueia transicoes (fail-closed), mas nao bloqueia
 *                    `navigate`/`inspect`, que nao escrevem.
 *   4. ENTRADAS    — falta entrada obrigatoria? `disabled` com a lista exata do que falta.
 *
 * CONSEQUENCIA DELIBERADA DA ORDEM: capability vem ANTES de estado. Um ator sem permissao recebe
 * `hidden`, nunca `disabled` com motivo de estado — porque o motivo de estado revelaria a
 * existencia de uma acao que ele nao pode executar.
 */

import type {
  CommandAvailability,
  CommandContext,
  CommandDefinition,
  CommandInput,
  CommandInvocation,
  ResolvedCommand,
} from './types';

/** Formato do estado de lifecycle que o dominio de titulos publica. */
const CANCELLED_LIFECYCLES = new Set(['CANCELLED', 'CANCELED']);

function isTerminalState(definition: CommandDefinition, state: string | null | undefined): boolean {
  if (!state) {
    return false;
  }
  return Boolean(definition.terminalStates?.includes(state));
}

/**
 * O comando declara esta entidade/view?
 *
 * `definition.scope.view` ausente = o comando vale em qualquer superficie da entidade.
 */
function matchesScope(definition: CommandDefinition, context: CommandContext): boolean {
  if (definition.scope.entity !== context.entity) {
    return false;
  }
  if (!definition.scope.view) {
    return true;
  }
  return definition.scope.view === context.view;
}

/**
 * Separacao de deveres declarada no proprio comando.
 *
 * Um titulo cancelado nao aceita escrita nova, qualquer que seja a intencao. Isto e regra de
 * DOMINIO espelhada aqui para que a interface nao ofereca o que o servidor vai recusar — o
 * backend rejeita antes de validar a versao, e oferecer a acao so produz erro tardio.
 *
 * Ficam fora: `navigate` e `inspect`, que nao escrevem e continuam validos (consultar um titulo
 * cancelado e operacao legitima, inclusive para auditoria).
 */
function isBlockedByLifecycle(definition: CommandDefinition, context: CommandContext): string | null {
  if (definition.intent === 'navigate' || definition.intent === 'inspect') {
    return null;
  }
  const lifecycle = context.lifecycle;
  if (!lifecycle) {
    return null;
  }
  if (CANCELLED_LIFECYCLES.has(lifecycle.toUpperCase())) {
    return 'O titulo esta cancelado: nao aceita novas alteracoes.';
  }
  return null;
}

/** Entradas obrigatorias sem valor utilizavel. */
function missingRequiredInputs(
  inputs: CommandInput[] | undefined,
  provided: Record<string, string | undefined> | undefined,
): string[] {
  if (!inputs || inputs.length === 0) {
    return [];
  }
  const missing: string[] = [];
  for (const input of inputs) {
    if (!input.required) {
      continue;
    }
    const raw = provided?.[input.name];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length === 0) {
      missing.push(input.name);
      continue;
    }
    if (typeof input.minLength === 'number' && value.length < input.minLength) {
      missing.push(input.name);
    }
  }
  return missing;
}

export function evaluateCommand(
  definition: CommandDefinition,
  context: CommandContext,
): CommandAvailability {
  /* 1. ESCOPO ------------------------------------------------------------------------- */
  if (!matchesScope(definition, context)) {
    return { status: 'hidden', reason: 'Comando nao pertence a este objeto.' };
  }

  /* 2. CAPABILITY --------------------------------------------------------------------- */
  if (definition.capability) {
    const granted = context.capabilities;
    /**
     * FAIL-CLOSED. Conjunto nao resolvido (`null`/`undefined`) = desconhecido, e desconhecido nao
     * autoriza. Renderizar o botao "enquanto carrega" produz o piscar de acao que some — pior que
     * esperar, porque o operador ja se preparou para clicar.
     */
    if (!granted || !granted.has(definition.capability)) {
      return { status: 'hidden', reason: 'Capability nao concedida.' };
    }
  }

  /* 3. ESTADO ------------------------------------------------------------------------- */
  const state = context.state ?? null;

  const lifecycleBlock = isBlockedByLifecycle(definition, context);
  if (lifecycleBlock) {
    return { status: 'disabled', reason: lifecycleBlock };
  }

  /**
   * Estado TERMINAL: a acao nunca e reoferecida. Distinto de "fora de allowedStates" — terminal
   * diz que o processo acabou ali, e o motivo tem de ser dito nesses termos.
   */
  if (isTerminalState(definition, state)) {
    return {
      status: 'disabled',
      reason: `O objeto esta em "${state}", estado final: a acao nao se aplica mais.`,
    };
  }

  if (definition.allowedStates && definition.allowedStates.length > 0) {
    if (!state) {
      /**
       * Estado DESCONHECIDO. Transicoes escrevem e dependem do estado, entao bloqueiam. `mutate`
       * idem. Ja `navigate`/`inspect` seguem disponiveis porque nao dependem dele — bloquear
       * leitura por falta de estado transformaria falha de carregamento em negacao de acesso.
       */
      if (definition.intent === 'transition' || definition.intent === 'mutate') {
        return {
          status: 'disabled',
          reason: 'Estado do objeto ainda nao confirmado: aguarde o carregamento.',
        };
      }
    } else if (!definition.allowedStates.includes(state)) {
      return {
        status: 'disabled',
        reason: `Disponivel apenas em ${formatStates(definition.allowedStates)}. Estado atual: "${state}".`,
      };
    }
  }

  /* 4. ENTRADAS ----------------------------------------------------------------------- */
  const missing = missingRequiredInputs(definition.inputs, context.inputs);
  if (missing.length > 0) {
    return {
      status: 'disabled',
      reason: describeMissing(definition.inputs, missing),
      missingInputs: missing,
    };
  }

  return { status: 'available' };
}

/** Lista humana de estados: `A`, `A ou B`, `A, B ou C`. */
function formatStates(states: string[]): string {
  if (states.length === 1) {
    return `"${states[0]}"`;
  }
  const head = states.slice(0, -1).map((s) => `"${s}"`).join(', ');
  return `${head} ou "${states[states.length - 1]}"`;
}

/**
 * Motivo de indisponibilidade em termos do que o OPERADOR precisa fazer.
 *
 * "Informe o motivo (minimo 10 caracteres)" e acionavel; "campo obrigatorio ausente" nao e.
 */
function describeMissing(inputs: CommandInput[] | undefined, missing: string[]): string {
  const labels = missing.map((name) => {
    const input = inputs?.find((entry) => entry.name === name);
    if (!input) {
      return name;
    }
    if (typeof input.minLength === 'number') {
      return `${input.label} (minimo ${input.minLength} caracteres)`;
    }
    return input.label;
  });
  if (labels.length === 1) {
    return `Informe ${labels[0]}.`;
  }
  return `Informe ${labels.join(', ')}.`;
}

/** Resolve uma definicao em comando pronto para render, ja com a avaliacao anexada. */
export function resolveCommand(
  definition: CommandDefinition,
  context: CommandContext,
): ResolvedCommand {
  return { definition, availability: evaluateCommand(definition, context) };
}

/**
 * Monta a chamada a partir de definicao + contexto, aplicando defaults declarados.
 *
 * So produz invocacao para comando `available`: executar um comando cuja disponibilidade nao foi
 * confirmada e exatamente o bug que este modulo existe para eliminar. Retorna `null` em qualquer
 * outro caso, e o chamador trata como no-op.
 */
export function buildInvocation(
  definition: CommandDefinition,
  context: CommandContext,
): CommandInvocation | null {
  if (evaluateCommand(definition, context).status !== 'available') {
    return null;
  }

  const inputs: Record<string, string> = {};
  for (const input of definition.inputs ?? []) {
    const provided = context.inputs?.[input.name];
    const value = typeof provided === 'string' && provided.trim().length > 0
      ? provided
      : (input.defaultValue ?? '');
    if (value.trim().length > 0) {
      inputs[input.name] = value;
    }
  }

  return {
    commandId: definition.id,
    target: context.target,
    inputs,
    context,
  };
}

/**
 * Executa o comando pelo caminho declarado.
 *
 * Devolve `false` quando a invocacao nao pode ser construida (comando indisponivel) — o chamador
 * NAO deve tratar isso como erro: significa que a interface ofereceu algo que a avaliacao atual
 * nega, e a resposta correta e nao fazer nada. Handler ausente em comando sem `to` tambem devolve
 * `false`: comando declarado sem execucao e defeito de declaracao, e falhar em silencio e melhor
 * que fingir sucesso.
 */
export async function executeCommand(
  definition: CommandDefinition,
  context: CommandContext,
): Promise<boolean> {
  const invocation = buildInvocation(definition, context);
  if (!invocation) {
    return false;
  }

  const handler = definition.execution.handler;
  if (!handler) {
    return false;
  }

  await handler(invocation);
  return true;
}
