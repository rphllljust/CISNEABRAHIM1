/**
 * CISNE — SAVED VIEWS
 *
 * Conforme a Pagina 11 do relatorio, "Saved Views elevam a personalizacao a objeto de produto":
 * o recorte (query, filtros, colunas) deixa de ser estado efemero de componente e passa a ser
 * registro persistido, nomeado, fixado como padrao e reaplicavel.
 *
 * MODELO DE REFERENCIA: as Saved Views do Microsoft Dynamics 365 (recorte salvo por persona, com
 * colunas e ordenacao proprias) e o Report Builder do Odoo/Frappe, onde colunas, filtros,
 * ordenacao e group by sao salvos pelo proprio usuario.
 *
 * LIMITE HONESTO — LEIA ANTES DE USAR `scope: 'ROLE'`:
 * nao existe hoje endpoint de preferencia de usuario no backend, e inventar um contrato de API
 * seria pior que persistir no cliente. A view vive no `localStorage`, isolada por identidade.
 * `describeSavedViewScope` declara isso ao operador em vez de prometer compartilhamento que nao
 * acontece. O tipo publico nao muda quando o endpoint existir.
 */

export {
  SavedViewBar,
  type SavedViewBarProps,
} from './SavedViewBar';

export {
  canApplySavedView,
  createSavedView,
  deleteSavedView,
  describeSavedViewScope,
  findDefaultSavedView,
  isCompatibleSavedView,
  listSavedViewsForScope,
  normalizePageSize,
  purgeIncompatibleSavedViews,
  readSavedViews,
  renameSavedView,
  resetSavedViewIdCounterForTests,
  setDefaultSavedView,
  updateSavedView,
  type CreateSavedViewInput,
  type SavedViewWriteResult,
} from './store';

export { useSavedViews, type UseSavedViewsInput, type UseSavedViewsResult } from './use-saved-views';

export {
  DEFAULT_SAVED_VIEW_PAGE_SIZE,
  MAX_SAVED_VIEW_NAME_LENGTH,
  MAX_SAVED_VIEWS_PER_SCOPE,
  SAVED_VIEW_CONTRACT_VERSION,
  SAVED_VIEW_PAGE_SIZES,
  type CisneSavedView,
  type SavedViewColumn,
  type SavedViewFilter,
  type SavedViewFilterOperator,
  type SavedViewGroupBy,
  type SavedViewScope,
  type SavedViewSort,
  type SavedViewSortDirection,
  type SavedViewState,
} from './types';
