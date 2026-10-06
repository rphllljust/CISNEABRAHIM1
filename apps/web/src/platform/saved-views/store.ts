/**
 * SAVED VIEWS — STORE
 *
 * Persistencia, validacao e ciclo de vida das views. A store NAO conhece React: e um modulo puro
 * com assinatura de mudanca, o que permite testar a regra sem montar arvore e evita que a
 * persistencia dependa de ordem de render.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE `localStorage` E NAO O SERVIDOR (AINDA)
 * ---------------------------------------------------------------------------------------------
 *
 * Decisao deliberada e registrada: nao existe hoje endpoint de preference de usuario no backend,
 * e INVENTAR um contrato de API seria pior que persistir no cliente. A view e, por definicao,
 * recorte de apresentacao — o dado de negocio continua vindo do servidor a cada consulta.
 *
 * A vista de PERFIL (compartilhada) exige servidor para existir de verdade: uma view "publicada
 * para o papel FINANCEIRO" gravada so no navegador de quem a criou nao e publicada, e afirmar o
 * contrario seria mentira na interface. Por isso `scope: ROLE` funciona HOJE apenas como
 * marcacao local, e `describeSavedViewScope` diz isso explicitamente ao operador. Quando o
 * endpoint existir, a store ganha uma implementacao remota sem mudar o tipo publico.
 *
 * ---------------------------------------------------------------------------------------------
 * ISOLAMENTO POR IDENTIDADE
 * ---------------------------------------------------------------------------------------------
 *
 * A chave de armazenamento inclui a identidade. Sem isso, um operador que faz login depois de
 * outro na mesma maquina herda os recortes do anterior — e um recorte financeiro herdado nao e
 * so inconveniente: e vazamento de informacao sobre a carteira de outro ator.
 */

import {
  DEFAULT_SAVED_VIEW_PAGE_SIZE,
  MAX_SAVED_VIEWS_PER_SCOPE,
  MAX_SAVED_VIEW_NAME_LENGTH,
  SAVED_VIEW_CONTRACT_VERSION,
  SAVED_VIEW_PAGE_SIZES,
  type CisneSavedView,
  type SavedViewColumn,
  type SavedViewFilter,
  type SavedViewFilterOperator,
  type SavedViewGroupBy,
  type SavedViewScope,
  type SavedViewSort,
  type SavedViewState,
} from './types';

const STORAGE_PREFIX = 'cisne.savedViews.v1';

function storageKey(identityId: string): string {
  return `${STORAGE_PREFIX}.${identityId}`;
}

/* --------------------------------------------------------------------------------- VALIDACAO */

const FILTER_OPERATORS: ReadonlySet<string> = new Set<SavedViewFilterOperator>([
  'eq',
  'neq',
  'in',
  'contains',
  'gte',
  'lte',
  'isNull',
  'isNotNull',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Leitura defensiva de um filtro.
 *
 * `values` precisa ser lista de strings. Um filtro com valor de outro tipo (numero, objeto) e
 * DESCARTADO em vez de coagido: coagir `null` para `"null"` produziria um filtro que casa com a
 * string literal "null" e devolve lista vazia — falha silenciosa lida como "nao ha resultado".
 */
function parseFilter(value: unknown): SavedViewFilter | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = asString(value.field);
  const operator = asString(value.operator);
  if (!field || !operator || !FILTER_OPERATORS.has(operator)) {
    return null;
  }
  const rawValues = Array.isArray(value.values) ? value.values : [];
  const values = rawValues.filter((item): item is string => typeof item === 'string');
  // Filtro que exige valor e nao tem nenhum e invalido: aplicar isso devolveria lista vazia.
  const takesValue = operator !== 'isNull' && operator !== 'isNotNull';
  if (takesValue && values.length === 0) {
    return null;
  }
  return { field, operator: operator as SavedViewFilterOperator, values };
}

function parseSort(value: unknown): SavedViewSort | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = asString(value.field);
  const direction = value.direction;
  if (!field || (direction !== 'asc' && direction !== 'desc')) {
    return null;
  }
  return { field, direction };
}

function parseColumn(value: unknown): SavedViewColumn | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = asString(value.field);
  if (!field) {
    return null;
  }
  const column: SavedViewColumn = {
    field,
    visible: value.visible !== false,
  };
  if (typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0) {
    column.width = Math.round(value.width);
  }
  if (value.pinned === true) {
    column.pinned = true;
  }
  return column;
}

function parseGroupBy(value: unknown): SavedViewGroupBy | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = asString(value.field);
  const direction = value.direction;
  if (!field || (direction !== 'asc' && direction !== 'desc')) {
    return null;
  }
  return { field, direction };
}

/** Normaliza o tamanho de pagina para a lista aceita. Valor estranho cai no default. */
export function normalizePageSize(value: unknown): number {
  if (typeof value === 'number' && (SAVED_VIEW_PAGE_SIZES as readonly number[]).includes(value)) {
    return value;
  }
  return DEFAULT_SAVED_VIEW_PAGE_SIZE;
}

/**
 * A view persistida e COMPATIVEL com o contrato atual?
 *
 * Versao diferente = registro de outra forma. Descartar e a resposta correta: tentar interpretar
 * produiziria coluna inexistente e lista vazia, que o operador le como ausencia de dado.
 * Exportada para que a store possa MIGRAR no futuro em vez de apenas descartar.
 */
export function isCompatibleSavedView(value: unknown): value is CisneSavedView {
  if (!isRecord(value)) {
    return false;
  }
  if (value.version !== SAVED_VIEW_CONTRACT_VERSION) {
    return false;
  }
  if (!asString(value.id) || !asString(value.name) || !asString(value.viewKey)) {
    return false;
  }
  if (!asString(value.ownerId)) {
    return false;
  }
  if (value.scope !== 'PERSONAL' && value.scope !== 'ROLE') {
    return false;
  }
  return Array.isArray(value.columns);
}

/** Reconstroi a view a partir do registro cru, descartando campos invalidos item a item. */
function parseSavedView(value: unknown): CisneSavedView | null {
  if (!isCompatibleSavedView(value)) {
    return null;
  }
  const record = value as unknown as Record<string, unknown>;
  const filters = (Array.isArray(record.filters) ? record.filters : [])
    .map(parseFilter)
    .filter((entry): entry is SavedViewFilter => entry !== null);
  const sort = (Array.isArray(record.sort) ? record.sort : [])
    .map(parseSort)
    .filter((entry): entry is SavedViewSort => entry !== null);
  const columns = (Array.isArray(record.columns) ? record.columns : [])
    .map(parseColumn)
    .filter((entry): entry is SavedViewColumn => entry !== null);
  // View sem coluna nenhuma nao descreve lista: e registro corrompido.
  if (columns.length === 0) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    viewKey: value.viewKey,
    filters,
    sort,
    columns,
    groupBy: parseGroupBy(record.groupBy),
    pageSize: normalizePageSize(record.pageSize),
    scope: value.scope,
    ownerId: value.ownerId,
    roleId: asString(record.roleId) ?? undefined,
    isDefault: record.isDefault === true,
    version: SAVED_VIEW_CONTRACT_VERSION,
    createdAt: asString(record.createdAt) ?? new Date(0).toISOString(),
    updatedAt: asString(record.updatedAt) ?? new Date(0).toISOString(),
  };
}

/* ----------------------------------------------------------------------------------- LEITURA */

/**
 * Todas as views da identidade.
 *
 * Um registro corrompido no meio NAO derruba a leitura inteira: e descartado sozinho. O contrario
 * faria um unico JSON invalido apagar todas as views do operador.
 */
export function readSavedViews(identityId: string): CisneSavedView[] {
  if (!identityId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey(identityId));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(parseSavedView)
      .filter((entry): entry is CisneSavedView => entry !== null);
  } catch {
    // Storage indisponivel (modo restrito, cota) ou JSON invalido: sem views, sem excecao.
    return [];
  }
}

function writeSavedViews(identityId: string, views: CisneSavedView[]): void {
  try {
    window.localStorage.setItem(storageKey(identityId), JSON.stringify(views));
  } catch {
    // Persistencia e conveniencia, nao correcao: sem ela a view vive so na sessao atual.
  }
}

/** Views de uma superficie, na ordem de criacao. */
export function listSavedViewsForScope(
  identityId: string,
  viewKey: string,
): CisneSavedView[] {
  return readSavedViews(identityId)
    .filter((view) => view.viewKey === viewKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/* ----------------------------------------------------------------------------------- ESCRITA */

let idCounter = 0;

/** Id estavel o bastante para o cliente. Nao e identidade de dominio. */
function nextId(): string {
  idCounter += 1;
  return `sv-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Test-only. */
export function resetSavedViewIdCounterForTests(): void {
  idCounter = 0;
}

export type CreateSavedViewInput = {
  identityId: string;
  name: string;
  viewKey: string;
  state: SavedViewState;
  scope: SavedViewScope;
  roleId?: string;
  isDefault?: boolean;
};

export type SavedViewWriteResult =
  | { ok: true; view: CisneSavedView }
  | { ok: false; reason: string };

/**
 * Cria uma view.
 *
 * REGRAS APLICADAS AQUI (e nao na tela):
 *   - nome obrigatorio e limitado — nome vazio nao identifica nada no seletor;
 *   - escopo ROLE exige `roleId`: "publicada para o perfil" sem dizer QUAL perfil e uma view que
 *     ninguem ve, ou que todos veem;
 *   - `isDefault` DESMARCA as demais do mesmo escopo. Duas views default para a mesma superficie
 *     tornam "qual abre por padrao" dependente da ordem de leitura do storage.
 */
export function createSavedView(input: CreateSavedViewInput): SavedViewWriteResult {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, reason: 'Informe um nome para a visualização.' };
  }
  if (name.length > MAX_SAVED_VIEW_NAME_LENGTH) {
    return {
      ok: false,
      reason: `O nome deve ter no máximo ${MAX_SAVED_VIEW_NAME_LENGTH} caracteres.`,
    };
  }
  if (input.scope === 'ROLE' && !input.roleId) {
    return { ok: false, reason: 'Visualização de perfil exige um perfil de destino.' };
  }

  const existing = readSavedViews(input.identityId);
  const sameScope = existing.filter((view) => view.viewKey === input.viewKey);

  if (sameScope.length >= MAX_SAVED_VIEWS_PER_SCOPE) {
    return {
      ok: false,
      reason: `Limite de ${MAX_SAVED_VIEWS_PER_SCOPE} visualizações por tela atingido. Exclua uma antes de criar outra.`,
    };
  }
  if (sameScope.some((view) => view.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: `Já existe uma visualização chamada "${name}".` };
  }

  const now = new Date().toISOString();
  const view: CisneSavedView = {
    id: nextId(),
    name,
    viewKey: input.viewKey,
    filters: input.state.filters,
    sort: input.state.sort,
    columns: input.state.columns,
    groupBy: input.state.groupBy,
    pageSize: normalizePageSize(input.state.pageSize),
    scope: input.scope,
    ownerId: input.identityId,
    ...(input.scope === 'ROLE' && input.roleId ? { roleId: input.roleId } : {}),
    isDefault: input.isDefault === true,
    version: SAVED_VIEW_CONTRACT_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  const next = clearDefaults(existing, view, input.identityId);
  writeSavedViews(input.identityId, [...next, view]);
  return { ok: true, view };
}

/**
 * Sobrescreve a view com o estado atual da lista ("salvar alteracoes").
 *
 * Preserva `id` e `createdAt`: e a MESMA view evoluindo, nao uma nova. Perder `createdAt` faria a
 * ordem do seletor mudar a cada salvamento.
 */
export function updateSavedView(
  identityId: string,
  viewId: string,
  state: SavedViewState,
): SavedViewWriteResult {
  const views = readSavedViews(identityId);
  const index = views.findIndex((view) => view.id === viewId);
  if (index < 0) {
    return { ok: false, reason: 'Visualização não encontrada.' };
  }
  const current = views[index];
  if (!current) {
    return { ok: false, reason: 'Visualização não encontrada.' };
  }
  const updated: CisneSavedView = {
    ...current,
    filters: state.filters,
    sort: state.sort,
    columns: state.columns,
    groupBy: state.groupBy,
    pageSize: normalizePageSize(state.pageSize),
    updatedAt: new Date().toISOString(),
  };
  const next = [...views];
  next[index] = updated;
  writeSavedViews(identityId, next);
  return { ok: true, view: updated };
}

export function renameSavedView(
  identityId: string,
  viewId: string,
  name: string,
): SavedViewWriteResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Informe um nome para a visualização.' };
  }
  if (trimmed.length > MAX_SAVED_VIEW_NAME_LENGTH) {
    return {
      ok: false,
      reason: `O nome deve ter no máximo ${MAX_SAVED_VIEW_NAME_LENGTH} caracteres.`,
    };
  }
  const views = readSavedViews(identityId);
  const index = views.findIndex((view) => view.id === viewId);
  if (index < 0) {
    return { ok: false, reason: 'Visualização não encontrada.' };
  }
  const target = views[index];
  if (!target) {
    return { ok: false, reason: 'Visualização não encontrada.' };
  }
  const collision = views.some(
    (view) =>
      view.id !== viewId &&
      view.viewKey === target.viewKey &&
      view.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (collision) {
    return { ok: false, reason: `Já existe uma visualização chamada "${trimmed}".` };
  }
  const updated: CisneSavedView = {
    ...target,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  };
  const next = [...views];
  next[index] = updated;
  writeSavedViews(identityId, next);
  return { ok: true, view: updated };
}

/**
 * Marca como default, desmarcando as demais da mesma superficie.
 *
 * Escopo do "default" e por viewKey, nao global: a lista de contas a pagar e a de receber sao
 * superficies distintas, e cada uma tem seu proprio padrao.
 */
export function setDefaultSavedView(
  identityId: string,
  viewId: string,
): SavedViewWriteResult {
  const views = readSavedViews(identityId);
  const target = views.find((view) => view.id === viewId);
  if (!target) {
    return { ok: false, reason: 'Visualização não encontrada.' };
  }
  const next = views.map((view) => {
    if (view.viewKey !== target.viewKey) {
      return view;
    }
    return { ...view, isDefault: view.id === viewId };
  });
  writeSavedViews(identityId, next);
  return { ok: true, view: { ...target, isDefault: true } };
}

export function deleteSavedView(identityId: string, viewId: string): boolean {
  const views = readSavedViews(identityId);
  const next = views.filter((view) => view.id !== viewId);
  if (next.length === views.length) {
    return false;
  }
  writeSavedViews(identityId, next);
  return true;
}

/** Desmarca o default de todas as views quando outra recem-criada assume o posto. */
function clearDefaults(
  views: CisneSavedView[],
  incoming: CisneSavedView,
  identityId: string,
): CisneSavedView[] {
  if (!incoming.isDefault) {
    return views;
  }
  void identityId;
  return views.map((view) =>
    view.viewKey === incoming.viewKey ? { ...view, isDefault: false } : view,
  );
}

/* ---------------------------------------------------------------------------- APLICACAO */

/**
 * A view pode ser aplicada nesta superficie?
 *
 * Recusa por `viewKey` diferente. Aplicar um recorte de contas a pagar sobre a lista de receber
 * produziria filtro sobre campo inexistente e lista vazia — e lista vazia em tela financeira e
 * lida como "nao ha titulo", que e uma conclusao de negocio FALSA.
 */
export function canApplySavedView(view: CisneSavedView, viewKey: string): boolean {
  return view.viewKey === viewKey;
}

export function findDefaultSavedView(
  identityId: string,
  viewKey: string,
): CisneSavedView | null {
  return (
    listSavedViewsForScope(identityId, viewKey).find((view) => view.isDefault) ?? null
  );
}

/**
 * Texto que explica ao operador o alcance REAL do escopo da view.
 *
 * Existe porque `ROLE` ainda nao e publicado no servidor. Descrever uma view como "compartilhada
 * com o perfil" quando ela vive apenas no navegador de quem a criou seria afirmar algo falso — e o
 * operador confiaria naquilo para padronizar o trabalho do time.
 */
export function describeSavedViewScope(view: CisneSavedView): string {
  if (view.scope === 'PERSONAL') {
    return 'Somente você vê esta visualização.';
  }
  return 'Marcada para o perfil. O compartilhamento entre usuários ainda não é publicado pelo servidor: por enquanto, ela vale apenas neste navegador.';
}

/**
 * Limpa registros compativeis de OUTRAS versoes do contrato.
 *
 * Chamada na inicializacao da store. Sem isto, uma view de contrato antigo permanece no storage
 * para sempre: `readSavedViews` a ignora, mas ela ocupa cota e reaparece a cada diagnostico.
 */
export function purgeIncompatibleSavedViews(identityId: string): number {
  if (!identityId) {
    return 0;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(identityId));
    if (!raw) {
      return 0;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(storageKey(identityId));
      return 0;
    }
    const kept = parsed.filter(isCompatibleSavedView);
    const removed = parsed.length - kept.length;
    if (removed > 0) {
      writeSavedViews(identityId, kept);
    }
    return removed;
  } catch {
    return 0;
  }
}
