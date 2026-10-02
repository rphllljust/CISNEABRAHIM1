import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Visões salvas por usuário.
 *
 * GAP_DE_CONTRATO: não existe endpoint de visões salvas no backend. A persistência é feita em
 * `localStorage`, chaveada por identidade + entidade, e isso é DECLARADO — não é um backend
 * fingido. Quando `GET/POST /api/v1/meta/:entity/saved-views` existir, só este arquivo muda.
 *
 * O armazenamento é por USUÁRIO porque a chave inclui o id da identidade: duas contas no mesmo
 * navegador não enxergam as visões uma da outra.
 */
export type SavedView = {
  id: string;
  name: string;
  /** Filtros ativos, indexados por nome de campo do metadado. */
  filters: Record<string, string>;
  /** Visão de apresentação (`list`, `kanban`, colunas declaradas, …). */
  viewType: string;
  createdAt: string;
};

const STORAGE_PREFIX = 'cisne.saved-views';

function storageKey(identityId: string, entity: string): string {
  return `${STORAGE_PREFIX}.${identityId}.${entity}`;
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['viewType'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['filters'] === 'object' &&
    candidate['filters'] !== null
  );
}

/**
 * Lê as visões salvas.
 *
 * Entrada corrompida é DESCARTADA, não lançada: um `localStorage` inválido não pode derrubar
 * a tela. Cada item é validado antes de entrar na lista.
 */
export function readSavedViews(identityId: string, entity: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storageKey(identityId, entity));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSavedView);
  } catch {
    return [];
  }
}

function writeSavedViews(identityId: string, entity: string, views: SavedView[]): void {
  try {
    window.localStorage.setItem(storageKey(identityId, entity), JSON.stringify(views));
  } catch {
    // Cota cheia ou armazenamento indisponível: a visão não persiste, mas a tela não quebra.
  }
}

export type UseSavedViewsResult = {
  views: SavedView[];
  save: (name: string, filters: Record<string, string>, viewType: string) => void;
  remove: (id: string) => void;
  /** `true` quando o backend ainda não publica visões salvas — a UI declara o fallback. */
  persistedLocally: boolean;
};

export function useSavedViews(identityId: string, entity: string): UseSavedViewsResult {
  const [views, setViews] = useState<SavedView[]>(() => readSavedViews(identityId, entity));

  // Trocar de entidade (ou de usuário) recarrega do armazenamento: manter a lista anterior
  // mostraria visões de outra entidade.
  useEffect(() => {
    setViews(readSavedViews(identityId, entity));
  }, [identityId, entity]);

  const save = useCallback(
    (name: string, filters: Record<string, string>, viewType: string) => {
      const trimmed = name.trim();
      if (trimmed === '') {
        return;
      }
      const next: SavedView = {
        id: `view-${String(Date.now())}-${Math.trunc(Math.random() * 1_000_000).toString(36)}`,
        name: trimmed,
        filters,
        viewType,
        createdAt: new Date().toISOString(),
      };
      setViews((current) => {
        // Substitui a visão de MESMO NOME: salvar duas vezes com o mesmo nome é editar.
        const withoutDuplicate = current.filter((view) => view.name !== trimmed);
        const updated = [...withoutDuplicate, next];
        writeSavedViews(identityId, entity, updated);
        return updated;
      });
    },
    [identityId, entity],
  );

  const remove = useCallback(
    (id: string) => {
      setViews((current) => {
        const updated = current.filter((view) => view.id !== id);
        writeSavedViews(identityId, entity, updated);
        return updated;
      });
    },
    [identityId, entity],
  );

  return useMemo(
    () => ({ views, save, remove, persistedLocally: true }),
    [views, save, remove],
  );
}
