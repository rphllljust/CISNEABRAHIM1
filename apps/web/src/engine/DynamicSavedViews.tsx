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
 *
 * SEM DONO, NÃO LÊ. `owner === null` significa ausência de identidade, e a resposta correta é
 * ausência de visões — nunca um namespace compartilhado entre operadores diferentes.
 */
export function readSavedViews(owner: string | null, entity: string): SavedView[] {
  if (!owner) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey(owner, entity));
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

function writeSavedViews(owner: string | null, entity: string, views: SavedView[]): void {
  /* Sem dono, não grava: um dono literal gravaria a visão de um operador no espaço de outro. */
  if (!owner) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(owner, entity), JSON.stringify(views));
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
  /**
   * `false` quando NÃO há identidade: a visão salva não pode existir, e a UI precisa dizer isso em
   * vez de oferecer um "Salvar visão" que não salva nada.
   */
  persistable: boolean;
};

export function useSavedViews(owner: string | null, entity: string): UseSavedViewsResult {
  const [views, setViews] = useState<SavedView[]>(() => readSavedViews(owner, entity));

  // Trocar de entidade (ou de usuário) recarrega do armazenamento: manter a lista anterior
  // mostraria visões de outra entidade.
  useEffect(() => {
    setViews(readSavedViews(owner, entity));
  }, [owner, entity]);

  const save = useCallback(
    (name: string, filters: Record<string, string>, viewType: string) => {
      const trimmed = name.trim();
      if (trimmed === '' || !owner) {
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
        writeSavedViews(owner, entity, updated);
        return updated;
      });
    },
    [owner, entity],
  );

  const remove = useCallback(
    (id: string) => {
      if (!owner) {
        return;
      }
      setViews((current) => {
        const updated = current.filter((view) => view.id !== id);
        writeSavedViews(owner, entity, updated);
        return updated;
      });
    },
    [owner, entity],
  );

  return useMemo(
    () => ({ views, save, remove, persistedLocally: true, persistable: owner !== null }),
    [views, save, remove, owner],
  );
}
