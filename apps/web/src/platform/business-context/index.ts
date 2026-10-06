/**
 * CISNE — BUSINESS CONTEXT BUS
 *
 * Conforme a Pagina 12 do relatorio, um contexto de negocio "pode ser publicado uma vez e consumido
 * por varios widgets ou aplicacoes, permitindo que selecao e drilldown atravessem fronteiras de
 * modulo (ex: Cliente -> Propostas/OS/Recebiveis/Documentos)".
 *
 * MODELO DE REFERENCIA: o Business Context do Infor OS — contexto publicado por um modulo e
 * consumido por widgets que nunca se conhecem.
 *
 * LIMITE DELIBERADO: o bus e de APRESENTACAO, nao de autorizacao. Publicar um foco nao concede
 * leitura: cada consumidor consulta o servidor e recebe a mesma negacao de sempre. Por isso o
 * estado distingue `empty` (fato de negocio) de `denied` (ausencia de permissao) — confundir os
 * dois faria a visao 360 afirmar "0 recebiveis" para quem nao pode ver recebiveis.
 */

export {
  BusinessContextProvider,
  useBusinessContext,
  useBusinessContextConsumer,
  useBusinessContextFocus,
  useDeclareContextConsumer,
  useContextConsumerReport,
  MAX_FOCUS_HISTORY,
  type BusinessContextBus,
} from './BusinessContextProvider';

export {
  BusinessContextHeader,
  BusinessContextSwitcher,
  type BusinessContextHeaderProps,
} from './BusinessContextHeader';

export {
  BUSINESS_CONTEXT_ENTITIES,
  BUSINESS_CONTEXT_LABELS,
  BUSINESS_CONTEXT_ROUTES,
  describeFocus,
  focusKey,
  isBusinessContextEntity,
  type BusinessContextConsumer,
  type BusinessContextConsumerReport,
  type BusinessContextConsumerState,
  type BusinessContextEntity,
  type BusinessContextFocus,
  type BusinessContextValue,
} from './types';
