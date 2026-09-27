/**
 * CISNE — ENTERPRISE INTERACTION CONTRACT
 *
 * Padrao canonico de interacao para OBJECT PAGES, materializado em componentes e
 * comportamento (nao em documento). Substitui "lista -> formulario -> salvar" por:
 *
 *   OBJETO DE NEGOCIO -> ESTADO -> CONTEXTO -> RELACOES -> HISTORICO -> PROXIMA ACAO
 *
 * Ordem de composicao canonica:
 *   EnterpriseObjectPage
 *     EnterpriseObjectHeader      1. referencia, titulo, estado, metadados, acoes
 *     ObjectStateFlow             2. estado como contexto de processo (somente estados reais)
 *     NextActionPanel             7. o que normalmente acontece agora
 *     SmartRelationBar            5. relacoes reais e autorizadas
 *     ObjectContextBlock          4. do que estamos falando
 *     ObjectPanel + ActivityTimeline (operator)   3/6. corpo e historico persistido
 *   EnterpriseCreateSheet         8. criacao em secoes empresariais
 *
 * LIMITES DELIBERADOS:
 * - Nenhum primitivo aqui amplia autorizacao. A pagina monta `SmartRelationSpec.allowed`
 *   a partir de capability real; o backend continua sendo o boundary.
 * - Nenhum primitivo cria fato de historico. O historico vem de `operator/ActivityTimeline`
 *   alimentado apenas por eventos persistidos.
 * - Nenhum primitivo inventa etapa, ator ou proxima acao.
 */

export {
  containsTechnicalIdentifier,
  isCapabilityName,
  toHumanReference,
  toHumanText,
} from './human-text';

export { EnterpriseObjectHeader, type EnterpriseObjectHeaderProps } from './EnterpriseObjectHeader';
export { ObjectStateFlow, type ObjectStateFlowProps } from './ObjectStateFlow';
export { ObjectContextBlock, type ObjectContextBlockProps } from './ObjectContextBlock';
export {
  SmartRelationBar,
  buildAuthorizedRelations,
  type SmartRelationBarProps,
} from './SmartRelationBar';
export { NextActionPanel, type NextActionPanelProps } from './NextActionPanel';
export { EnterpriseCreateSheet, type EnterpriseCreateSheetProps } from './EnterpriseCreateSheet';
export { EnterpriseObjectPage, ObjectPanel } from './EnterpriseObjectPage';
export { RELATION_SCOPE_KEYS, useRelationScope } from './use-url-scope';

export type {
  CreateSheetSection,
  EnterpriseObjectPageProps,
  NextAction,
  NextActionKind,
  ObjectAction,
  ObjectContextField,
  ObjectHeaderStatus,
  ObjectMetadataField,
  ObjectPagePhase,
  ObjectStateStep,
  SmartRelation,
  SmartRelationSpec,
} from './types';
