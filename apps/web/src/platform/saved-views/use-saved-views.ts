/**
 * SAVED VIEWS — LIGACAO COM REACT
 *
 * A tela entrega o ESTADO ATUAL da lista e recebe, de volta, o estado que a view impoe. O hook e
 * o unico ponto onde a persistencia encontra o componente.
 *
 * ---------------------------------------------------------------------------------------------
 * A DECISAO CENTRAL: A VIEW E APLICADA UMA VEZ, NAO A CADA RENDER
 * ---------------------------------------------------------------------------------------------
 *
 * Se o hook reaplicasse a view a cada mudanca do estado da lista, o operador nunca conseguiria
 * alterar nada: ele muda o filtro, a view salva reimpoe o dela, e a tela "pula de volta". Esse e o
 * defeito classico de persistencia de recorte.
 *
 * Por isso a aplicacao acontece em DOIS momentos explicitos:
 *   1. `applyDefault(viewKey)` — na entrada da superficie, quando o operador ainda nao mexeu;
 *   2. `apply(view)`           — quando o operador ESCOLHE uma view no seletor.
 *
 * Depois disso, o estado da lista pertence ao operador. A view so volta a agir quando ele pedir.
 * `dirty` informa se o estado corrente ja divergiu da view aplicada — e o que permite a interface
 * oferecer "salvar alteracoes" apenas quando ha alteracao real.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canApplySavedView,
  createSavedView,
  deleteSavedView,
  describeSavedViewScope,
  findDefaultSavedView,
  listSavedViewsForScope,
  purgeIncompatibleSavedViews,
  renameSavedView,
  setDefaultSavedView,
  updateSavedView,
} from './store';
import type {
  CisneSavedView,
  SavedViewScope,
  SavedViewState,
} from './types';

export type UseSavedViewsInput = {
  /** Identidade autenticada. Vazio = sem persistencia (nao ha dono a quem atribuir). */
  identityId: string;
  /** Chave estavel da superficie. Ex.: `finance.payable#list`. */
  viewKey: string;
  /** Estado CORRENTE da lista, sob controle da pagina. */
  state: SavedViewState;
  /** Aplica na pagina o estado vindo de uma view. */
  onApply: (state: SavedViewState) => void;
  /** Perfil do ator, para views de escopo ROLE. */
  roleId?: string;
};

export type UseSavedViewsResult = {
  views: CisneSavedView[];
  activeView: CisneSavedView | null;
  /** O estado corrente divergiu da view ativa. */
  dirty: boolean;
  /** Aplica a view escolhida pelo operador. */
  apply: (view: CisneSavedView) => void;
  /** Aplica a view default da superficie, se houver. Idempotente. */
  applyDefault: () => boolean;
  /** Cria uma view com o estado corrente. */
  save: (name: string, scope: SavedViewScope) => { ok: boolean; reason?: string };
  /** Sobrescreve a view ativa com o estado corrente. */
  saveChanges: () => { ok: boolean; reason?: string };
  setDefault: (viewId: string) => void;
  rename: (viewId: string, name: string) => { ok: boolean; reason?: string };
  remove: (viewId: string) => void;
  /** Texto do alcance real do escopo da view ativa. */
  scopeNotice: string | null;
};

/** Serializacao canonica do estado de lista, para comparar "mudou ou nao". */
function stateFingerprint(state: SavedViewState): string {
  return JSON.stringify({
    filters: [...state.filters]
      .map((filter) => `${filter.field}:${filter.operator}:${[...filter.values].sort().join(',')}`)
      .sort(),
    sort: state.sort.map((entry) => `${entry.field}:${entry.direction}`),
    columns: state.columns.map(
      (column) => `${column.field}:${column.visible ? 1 : 0}:${column.width ?? ''}:${column.pinned ? 1 : 0}`,
    ),
    groupBy: state.groupBy ? `${state.groupBy.field}:${state.groupBy.direction}` : null,
    pageSize: state.pageSize,
  });
}

export function useSavedViews({
  identityId,
  viewKey,
  state,
  onApply,
  roleId,
}: UseSavedViewsInput): UseSavedViewsResult {
  const [views, setViews] = useState<CisneSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [appliedFingerprint, setAppliedFingerprint] = useState<string | null>(null);

  /** `onApply` em ref: a identidade do callback muda a cada render do pai. */
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const refresh = useCallback(() => {
    setViews(identityId ? listSavedViewsForScope(identityId, viewKey) : []);
  }, [identityId, viewKey]);

  /**
   * Purgar registros de contrato antigo na entrada da superficie. Uma vez por identidade: views
   * incompativeis sao invisiveis para `listSavedViewsForScope`, mas continuam ocupando a cota do
   * storage ate alguem remove-las.
   */
  useEffect(() => {
    if (identityId) {
      purgeIncompatibleSavedViews(identityId);
    }
    refresh();
  }, [identityId, refresh]);

  const apply = useCallback(
    (view: CisneSavedView) => {
      if (!canApplySavedView(view, viewKey)) {
        return;
      }
      const next: SavedViewState = {
        filters: view.filters,
        sort: view.sort,
        columns: view.columns,
        groupBy: view.groupBy,
        pageSize: view.pageSize,
      };
      setActiveViewId(view.id);
      setAppliedFingerprint(stateFingerprint(next));
      onApplyRef.current(next);
    },
    [viewKey],
  );

  /**
   * Aplica a default UMA vez por montagem.
   *
   * A guarda por `appliedFingerprint` nao basta (o operador pode voltar ao estado da view por
   * conta propria): a trava e `appliedOnceRef`, que faz a default nao reimpor o recorte depois que
   * o operador ja mexeu na lista.
   */
  const appliedOnceRef = useRef(false);
  const applyDefault = useCallback((): boolean => {
    if (!identityId) {
      return false;
    }
    const fallback = findDefaultSavedView(identityId, viewKey);
    if (!fallback) {
      return false;
    }
    apply(fallback);
    return true;
  }, [apply, identityId, viewKey]);

  useEffect(() => {
    if (appliedOnceRef.current) {
      return;
    }
    appliedOnceRef.current = true;
    applyDefault();
  }, [applyDefault]);

  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  const dirty = useMemo(() => {
    if (!activeView) {
      return false;
    }
    return stateFingerprint(state) !== appliedFingerprint;
  }, [activeView, state, appliedFingerprint]);

  const save = useCallback(
    (name: string, scope: SavedViewScope) => {
      if (!identityId) {
        return { ok: false, reason: 'Sessão sem identidade: não é possível salvar a visualização.' };
      }
      const result = createSavedView({
        identityId,
        name,
        viewKey,
        state,
        scope,
        ...(scope === 'ROLE' && roleId ? { roleId } : {}),
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      refresh();
      setActiveViewId(result.view.id);
      setAppliedFingerprint(stateFingerprint(state));
      return { ok: true };
    },
    [identityId, roleId, state, viewKey, refresh],
  );

  const saveChanges = useCallback(() => {
    if (!identityId || !activeView) {
      return { ok: false, reason: 'Nenhuma visualização ativa para atualizar.' };
    }
    const result = updateSavedView(identityId, activeView.id, state);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    refresh();
    setAppliedFingerprint(stateFingerprint(state));
    return { ok: true };
  }, [activeView, identityId, state, refresh]);

  const setDefault = useCallback(
    (viewId: string) => {
      if (!identityId) {
        return;
      }
      setDefaultSavedView(identityId, viewId);
      refresh();
    },
    [identityId, refresh],
  );

  const rename = useCallback(
    (viewId: string, name: string) => {
      if (!identityId) {
        return { ok: false, reason: 'Sessão sem identidade.' };
      }
      const result = renameSavedView(identityId, viewId, name);
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      refresh();
      return { ok: true };
    },
    [identityId, refresh],
  );

  const remove = useCallback(
    (viewId: string) => {
      if (!identityId) {
        return;
      }
      deleteSavedView(identityId, viewId);
      // A view ativa foi excluida: o estado corrente PERMANECE na tela (o operador nao perde o
      // recorte que esta vendo), apenas deixa de estar associado a uma view salva.
      setActiveViewId((current) => (current === viewId ? null : current));
      refresh();
    },
    [identityId, refresh],
  );

  const scopeNotice = useMemo(
    () => (activeView ? describeSavedViewScope(activeView) : null),
    [activeView],
  );

  return {
    views,
    activeView,
    dirty,
    apply,
    applyDefault,
    save,
    saveChanges,
    setDefault,
    rename,
    remove,
    scopeNotice,
  };
}
