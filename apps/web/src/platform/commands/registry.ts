/**
 * COMMAND REGISTRY — REGISTRO E CONSULTA
 *
 * O registro e a fonte unica das acoes da plataforma. Uma tela NAO monta botoes: ela declara o
 * objeto em foco e pede os comandos daquele escopo.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE O REGISTRO E UM MODULO, E NAO UM CONTEXTO REACT
 * ---------------------------------------------------------------------------------------------
 *
 * Definicoes de comando descrevem DOMINIO (endpoint, capability, estados), nao renderizacao. Se
 * ficassem dentro de um provider, duas superficies montadas ao mesmo tempo — a lista e o painel
 * de detalhe, caso normal de master-detail — registrariam a MESMA acao duas vezes e a segunda
 * sobrescreveria a primeira por ordem de montagem. O registro e global e idempotente: registrar
 * o mesmo id com a MESMA definicao e no-op; com definicao DIFERENTE e ERRO (duas telas
 * discordando sobre o que a mesma acao faz e exatamente o defeito que este modulo elimina).
 *
 * Registro duplicado divergente falha ALTO, em vez de vencer o ultimo: um `console.warn` aqui
 * seria lido como ruido e a divergencia seguiria em producao.
 */

import {
  buildInvocation,
  evaluateCommand,
  executeCommand,
  resolveCommand,
} from './evaluate';
import type {
  CommandAvailability,
  CommandContext,
  CommandDefinition,
  CommandInvocation,
  ResolvedCommand,
} from './types';

/** Assinatura estrutural de uma definicao, para detectar divergencia entre registros. */
function signature(definition: CommandDefinition): string {
  return JSON.stringify({
    label: definition.label,
    intent: definition.intent,
    entity: definition.scope.entity,
    view: definition.scope.view ?? null,
    capability: definition.capability ?? null,
    allowedStates: definition.allowedStates ?? null,
    endpoint: definition.execution.endpoint ?? null,
    method: definition.execution.method ?? null,
  });
}

const registry = new Map<string, { definition: CommandDefinition; signature: string }>();

/**
 * Registra um comando. Idempotente para definicao identica; ERRO para definicao divergente.
 */
export function registerCommand(definition: CommandDefinition): void {
  const existing = registry.get(definition.id);
  const next = signature(definition);

  if (existing) {
    if (existing.signature !== next) {
      throw new Error(
        `CommandRegistry: "${definition.id}" ja registrado com definicao diferente. ` +
          'A mesma acao nao pode significar duas coisas: unifique a declaracao.',
      );
    }
    return;
  }

  registry.set(definition.id, { definition, signature: next });
}

/** Registra varios comandos de uma vez (o caso comum: o modulo declara seu catalogo). */
export function registerCommands(definitions: CommandDefinition[]): void {
  for (const definition of definitions) {
    registerCommand(definition);
  }
}

/** Remove um comando. Uso restrito a testes e a desmontagem de modulos de feature. */
export function unregisterCommand(id: string): void {
  registry.delete(id);
}

/** Comandos declarados para uma entidade (e opcionalmente view). */
export function commandsForScope(entity: string, view?: string): CommandDefinition[] {
  const scoped = [...registry.values()]
    .map((entry) => entry.definition)
    .filter((definition) => {
      if (definition.scope.entity !== entity) {
        return false;
      }
      if (definition.scope.view && definition.scope.view !== view) {
        return false;
      }
      return true;
    });
  // Ordem estavel: `order` declarado, depois id. Sem isto a barra de acoes reordena entre telas.
  return scoped.sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.id.localeCompare(b.id);
  });
}

export function getCommand(id: string): CommandDefinition | undefined {
  return registry.get(id)?.definition;
}

/**
 * Resolve todos os comandos do escopo para o contexto dado.
 *
 * Devolve SOMENTE o que deve ser renderizado: `hidden` e descartado aqui, e nao pode reaparecer
 * depois — a interface nao tem como distinguir "oculto" de "disponivel" se receber a lista
 * completa. Quem quiser o veredito de um comando especifico usa `evaluateCommand`.
 */
export function resolveCommandsForContext(context: CommandContext): ResolvedCommand[] {
  return commandsForScope(context.entity, context.view)
    .map((definition) => resolveCommand(definition, context))
    .filter((resolved) => resolved.availability.status !== 'hidden');
}

/**
 * Avalia um comando especifico pelo id, dentro do contexto.
 *
 * `hidden` e devolvido como tal (nao como ausencia): quem chama um comando por id — a Command
 * Palette, um atalho de teclado — precisa saber que ele existe mas nao esta disponivel, e nao
 * confundir isso com "id inexistente".
 */
export function evaluateCommandById(
  id: string,
  context: CommandContext,
): CommandAvailability | null {
  const definition = getCommand(id);
  if (!definition) {
    return null;
  }
  return evaluateCommand(definition, context);
}

/** Executa um comando pelo id. `false` quando indisponivel, inexistente ou sem handler. */
export async function executeCommandById(
  id: string,
  context: CommandContext,
): Promise<boolean> {
  const definition = getCommand(id);
  if (!definition) {
    return false;
  }
  return executeCommand(definition, context);
}

/** Constroi a invocacao de um comando pelo id (usado por handlers de teste e auditoria). */
export function buildInvocationById(
  id: string,
  context: CommandContext,
): CommandInvocation | null {
  const definition = getCommand(id);
  if (!definition) {
    return null;
  }
  return buildInvocation(definition, context);
}

/** Test-only: esvazia o registro global entre casos. */
export function resetCommandRegistryForTests(): void {
  registry.clear();
}

/** Diagnostico: quantos comandos a plataforma conhece e de quais entidades. */
export function commandRegistrySnapshot(): { id: string; entity: string; intent: string }[] {
  return [...registry.values()]
    .map((entry) => ({
      id: entry.definition.id,
      entity: entry.definition.scope.entity,
      intent: entry.definition.intent,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
