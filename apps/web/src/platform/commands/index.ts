/**
 * CISNE — COMMAND REGISTRY
 *
 * Conforme a Pagina 11 do relatorio, a acao deixa de ser um `<button>` escrito a mao em cada
 * formulario e passa a ser um FATO DECLARADO, resolvido em um unico lugar.
 *
 * MODELO DE REFERENCIA: o modelo de acoes contextuais do Odoo (MetaAction) e do Axelor
 * (Action-View) — uma acao pertence ao MODELO e ao estado do objeto, e a superficie apenas a
 * apresenta. A inspiracao e de modelo, nao de codigo: o contrato abaixo e proprio do CISNE.
 *
 * LIMITE: nao e fronteira de seguranca. O servidor revalida capability, estado e versao em toda
 * requisicao. Este modulo elimina a DIVERGENCIA entre telas, nao a autorizacao.
 *
 * USO TIPICO
 *
 *   // 1. o modulo declara o catalogo (uma vez, no carregamento do modulo)
 *   registerCommands(PAYABLE_COMMANDS);
 *
 *   // 2. a tela declara o objeto em foco
 *   const context = { entity: 'finance.payable', state: payable.status, capabilities };
 *   <CommandBar context={context} only={['finance.payable.reversePayment']} />
 */

export { buildInvocation, evaluateCommand, executeCommand, resolveCommand } from './evaluate';

export {
  buildInvocationById,
  commandRegistrySnapshot,
  commandsForScope,
  evaluateCommandById,
  executeCommandById,
  getCommand,
  registerCommand,
  registerCommands,
  resetCommandRegistryForTests,
  resolveCommandsForContext,
  unregisterCommand,
} from './registry';

export { CommandBar, type CommandBarProps } from './CommandBar';
export { availabilityOf, useCommands, type UseCommandsResult } from './use-commands';

export type {
  CommandAvailability,
  CommandConfirmation,
  CommandContext,
  CommandDefinition,
  CommandExecution,
  CommandInput,
  CommandIntent,
  CommandInvocation,
  CommandScope,
  CommandTarget,
  ResolvedCommand,
} from './types';
