/**
 * CISNE — ENTERPRISE OPERATOR LAYER
 *
 * Camada de MECANISMOS de operacao (nao de telas isoladas). Cada mecanismo e
 * reutilizavel por varias listas, e cada um existe para REDUZIR PASSOS:
 *
 *   smart-list/      filtro + ordenacao + visao salva (persistencia local segura)
 *   context/         pre-visualizacao lateral consumindo o payload ja autorizado
 *   bulk/            selecao multipla e acoes em lote comprovadamente seguras
 *   drilldown/       KPI -> lista filtrada -> registro (nenhum numero orfao)
 *   business-chain/  cadeia empresarial a partir de vinculos que JA existem
 *   history/         historico consistente usando somente fatos persistidos
 *   commands/        Ctrl+K como central de navegacao (sem IA)
 *   work-inbox/      Minhas Pendencias — fila de trabalho de estados reais
 *
 * LIMITES DELIBERADOS (registrados no relatorio como PARK):
 * - Nenhum mecanismo aqui amplia autorizacao; o backend continua sendo o boundary.
 * - Nenhum mecanismo aqui executa transicao sensivel em lote.
 * - Nenhuma fonte nova de pendencia e criada: o Work Inbox usa o Alert Center real.
 */

export {
  useSavedViews,
  sanitizeSmartListConfig,
  sanitizeViewName,
  isPersistableValue,
  storageKeyFor,
  EMPTY_SMART_LIST_CONFIG,
  type SavedView,
  type SmartListConfig,
  type SmartListAllowedFilters,
  type BuiltInView,
  type UseSavedViewsResult,
} from './smart-list/useSavedViews';

export { SavedViewsBar, type SavedViewsBarProps } from './smart-list/SavedViewsBar';

export {
  useSmartList,
  type UseSmartListOptions,
  type UseSmartListResult,
  type SmartListSort,
} from './smart-list/useSmartList';

export {
  ContextDrawer,
  useContextPreview,
  type ContextDrawerProps,
  type ContextPreviewBody,
  type ContextField,
  type ContextRelation,
} from './context/ContextDrawer';

export {
  useSelection,
  type UseSelectionResult,
  type UseSelectionOptions,
} from './bulk/useSelection';

export {
  BulkActionBar,
  exportSelectionToCsv,
  type BulkAction,
  type BulkActionBarProps,
} from './bulk/BulkActionBar';

export {
  DrilldownMetric,
  DrilldownRow,
  type DrilldownMetricProps,
  type DrilldownTone,
} from './drilldown/DrilldownMetric';

export {
  BusinessChain,
  buildChainLinks,
  CHAIN_STEPS,
  type ChainLink,
  type ChainStep,
  type BusinessChainProps,
} from './business-chain/BusinessChain';

export {
  ActivityTimeline,
  timestampFacts,
  type ActivityFact,
  type ActivityTimelineProps,
} from './history/ActivityTimeline';

export {
  CommandPalette,
  useCommandPaletteShortcut,
  type CommandPaletteProps,
} from './commands/CommandPalette';

export {
  rankCommands,
  scoreCommand,
  buildSearchCommand,
  normalizeCommandText,
  OPERATIONAL_VIEW_COMMANDS,
  CREATE_COMMANDS,
  PRIORITY_COMMANDS,
  COMMAND_GROUPS,
  type OperatorCommand,
  type OperatorCommandKind,
} from './commands/registry';

export { WorkInboxPage } from '../work-inbox/pages/WorkInboxPage';
export {
  buildWorkInbox,
  countByArea,
  toWorkInboxItem,
  WORK_AREAS,
  type WorkArea,
  type WorkAreaId,
  type WorkInboxGroup,
  type WorkInboxItem,
} from './work-inbox/work-inbox';
