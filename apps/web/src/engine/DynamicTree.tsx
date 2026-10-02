import { useMemo, useState } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema } from './types';
import { readBoolean, readFieldName, readLayout, readString } from './view-layout';

/**
 * VISÃO DE ÁRVORE dirigida por metadado.
 *
 * Lê `meta.views[viewType='tree'].layout`:
 *   - `parentField` — campo que aponta para o PAI (obrigatório)
 *   - `labelField`  — o que aparece no nó (default: `schema.labelField`)
 *   - `idField`     — identidade do nó (default: `id`)
 *
 * A `parentField` é o que distingue uma árvore de uma lista plana, e é justamente o que o
 * metadado precisa declarar: a engine não pode adivinhar qual coluna é auto-referente.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CICLO NÃO PODE TRAVAR A TELA
 *
 * Auto-referência admite erro de dados: A→B→A. Um render recursivo ingênuo estoura a pilha e
 * derruba a página inteira, transformando um dado ruim numa tela branca. A construção abaixo
 * é ITERATIVA e marca cada nó como visitado; um ciclo simplesmente para de crescer.
 *
 * ÓRFÃO TAMBÉM É DADO, NÃO LIXO: um nó cujo pai não está na página carregada vira RAIZ em vez
 * de sumir. Sumir com ele faria o operador contar menos registros do que existem — e ele não
 * teria como saber.
 */

export type DynamicTreeProps = {
  schema: MetaEntitySchema;
  rows: Record<string, unknown>[];
  viewType?: string;
  defaultExpandedDepth?: number;
  onNodeClick?: (row: Record<string, unknown>) => void;
  emptyMessage?: string;
};

export type TreeNode = {
  id: string;
  label: string;
  row: Record<string, unknown>;
  depth: number;
  children: TreeNode[];
  /** `true` quando `parentField` aponta para um id que não está nesta página. */
  orphan: boolean;
};

/**
 * Monta a floresta a partir das linhas.
 *
 * Devolve SEMPRE uma lista de raízes, mesmo com um único nó de topo: uma "árvore" com uma
 * raiz sintética obrigaria o renderizador a esconder um nível que o usuário não pediu.
 */
export function buildTree(
  rows: Record<string, unknown>[],
  idField: string,
  parentField: string,
  labelField: string,
): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const parentOf = new Map<string, string | null>();

  for (const row of rows) {
    const rawId = row[idField];
    if (rawId === null || rawId === undefined || String(rawId) === '') {
      // Sem identidade não há como pendurar filhos neste nó.
      continue;
    }
    const id = String(rawId);
    const rawParent = row[parentField];
    const parent = rawParent === null || rawParent === undefined || String(rawParent) === ''
      ? null
      : String(rawParent);
    const label = row[labelField];
    byId.set(id, {
      id,
      label: label === null || label === undefined || String(label) === '' ? '—' : String(label),
      row,
      depth: 0,
      children: [],
      orphan: false,
    });
    parentOf.set(id, parent);
  }

  const roots: TreeNode[] = [];
  for (const [id, node] of byId) {
    const parent = parentOf.get(id) ?? null;
    // Auto-referência (pai = ele mesmo) é tratada como raiz: é o jeito mais comum de
    // representar "topo" numa tabela que não usa NULL.
    if (parent === null || parent === id) {
      roots.push(node);
      continue;
    }
    const parentNode = byId.get(parent);
    if (!parentNode) {
      // ÓRFÃO: o pai existe no banco mas não veio nesta página. Vira raiz e se ANUNCIA.
      node.orphan = true;
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  /*
   * ANTI-CICLO. Percorre em largura a partir das raízes marcando o que já foi alcançado; o
   * que sobrar faz parte de um ciclo (A→B→A não alcança nenhuma raiz) e é promovido a raiz
   * para não desaparecer da tela.
   */
  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.shift() as TreeNode;
    if (reached.has(node.id)) {
      continue;
    }
    reached.add(node.id);
    queue.push(...node.children);
  }
  for (const [id, node] of byId) {
    if (!reached.has(id)) {
      roots.push(node);
      reached.add(id);
      // Marca o ramo inteiro como alcançado para não promovê-lo duas vezes.
      const stack = [...node.children];
      while (stack.length > 0) {
        const child = stack.pop() as TreeNode;
        if (reached.has(child.id)) {
          continue;
        }
        reached.add(child.id);
        stack.push(...child.children);
      }
    }
  }

  // Profundidade, iterativa: recursão em dado vindo do usuário é convite a stack overflow.
  const stack: TreeNode[] = roots.map((root) => ({ ...root, depth: 0 }));
  const depthOf = new Map<string, number>();
  while (stack.length > 0) {
    const current = stack.pop() as TreeNode;
    const depth = depthOf.get(current.id);
    if (depth !== undefined && depth <= current.depth) {
      continue;
    }
    depthOf.set(current.id, current.depth);
    for (const child of current.children) {
      stack.push({ ...child, depth: current.depth + 1 });
    }
  }
  const applyDepth = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      node.depth = depth;
      applyDepth(node.children, depth + 1);
    }
  };
  applyDepth(roots, 0);

  const sortByLabel = (nodes: TreeNode[]): void => {
    nodes.sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
    for (const node of nodes) {
      sortByLabel(node.children);
    }
  };
  sortByLabel(roots);

  return roots;
}

/** Nós visíveis dado o conjunto de ids expandidos. Iterativo, pela mesma razão acima. */
export function flattenTree(roots: TreeNode[], expanded: Set<string>): TreeNode[] {
  const visible: TreeNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as TreeNode;
    visible.push(node);
    if (expanded.has(node.id) && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index] as TreeNode);
      }
    }
  }
  return visible;
}

/** Ids até uma profundidade, para o estado inicial de expansão. */
export function idsToDepth(roots: TreeNode[], maxDepth: number): string[] {
  const ids: string[] = [];
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (depth <= maxDepth && node.children.length > 0) {
        ids.push(node.id);
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  return ids;
}

export function DynamicTree({
  schema,
  rows,
  viewType = 'tree',
  defaultExpandedDepth = 1,
  onNodeClick,
  emptyMessage,
}: DynamicTreeProps): React.ReactElement {
  const layout = useMemo(() => readLayout(schema, viewType), [schema, viewType]);

  const parentField = readFieldName(layout, 'parentField');
  const labelField = readFieldName(layout, 'labelField') ?? schema.labelField;
  const idField = readFieldName(layout, 'idField') ?? 'id';
  const startExpanded = readBoolean(layout, 'expandedByDefault', false);
  const hint = readString(layout, 'collapseHint');

  const roots = useMemo(
    () => (parentField ? buildTree(rows, idField, parentField, labelField) : []),
    [rows, idField, parentField, labelField],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!parentField) {
      return new Set<string>();
    }
    if (startExpanded) {
      const all: string[] = [];
      for (const node of roots) {
        all.push(node.id);
      }
      return new Set(idsToDepth(roots, Number.MAX_SAFE_INTEGER).concat(all));
    }
    return new Set(idsToDepth(roots, Math.max(defaultExpandedDepth - 1, 0)));
  });

  if (!parentField) {
    return (
      <div
        data-testid="dynamic-tree"
        data-entity={schema.name}
        data-view-type={viewType}
        data-tree-gap="parentField"
        className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        A view <strong>{viewType}</strong> não declara <code>layout.parentField</code> no metadata
        store, então não há hierarquia para montar a árvore.
      </div>
    );
  }

  const visible = flattenTree(roots, expanded);
  const totalNodes = (function count(nodes: TreeNode[]): number {
    let total = 0;
    const stack = [...nodes];
    while (stack.length > 0) {
      const node = stack.pop() as TreeNode;
      total += 1;
      stack.push(...node.children);
    }
    return total;
  })(roots);

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      data-testid="dynamic-tree"
      data-entity={schema.name}
      data-view-type={viewType}
      // A PROVA no DOM: a hierarquia que a view declarou e o tamanho real da floresta.
      data-parent-field={parentField}
      data-label-field={labelField}
      data-tree-total={totalNodes}
      data-tree-visible={visible.length}
      className="rounded border border-slate-200 bg-white"
    >
      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        {t('tree.hierarchy', 'Hierarquia por')} <strong>{parentField}</strong>
        {' · '}
        {t('tree.labelBy', 'rótulo de')} <strong>{labelField}</strong>
        {hint ? ` · ${hint}` : ''}
      </p>

      <ul role="tree" className="py-1">
        {visible.map((node) => {
          const hasChildren = node.children.length > 0;
          const isExpanded = expanded.has(node.id);
          return (
            <li
              key={node.id}
              role="treeitem"
              data-tree-node={node.id}
              data-tree-label={node.label}
              data-tree-depth={node.depth}
              data-tree-children={node.children.length}
              data-tree-expanded={isExpanded ? 'true' : 'false'}
              data-tree-orphan={node.orphan ? 'true' : 'false'}
              aria-level={node.depth + 1}
              aria-expanded={hasChildren ? isExpanded : undefined}
              className="flex items-center gap-1 px-2 py-1 text-sm hover:bg-slate-50"
              // Recuo por profundidade: é o que torna a hierarquia legível sem desenhar linhas.
              style={{ paddingLeft: `${8 + node.depth * 18}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  data-tree-toggle={node.id}
                  aria-label={isExpanded ? t('tree.collapse', 'Recolher') : t('tree.expand', 'Expandir')}
                  onClick={() => toggle(node.id)}
                  className="w-4 shrink-0 text-slate-500"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="w-4 shrink-0 text-slate-300">·</span>
              )}
              <button
                type="button"
                onClick={() => onNodeClick?.(node.row)}
                className="truncate text-left text-slate-800"
              >
                {node.label}
              </button>
              {hasChildren ? (
                <span
                  data-tree-count={node.children.length}
                  className="ml-1 shrink-0 rounded bg-slate-100 px-1 text-[11px] text-slate-600"
                >
                  {node.children.length}
                </span>
              ) : null}
              {node.orphan ? (
                <span
                  data-tree-orphan-badge
                  title={t(
                    'tree.orphan',
                    'O pai deste registro não está entre os carregados nesta página.',
                  )}
                  className="ml-1 shrink-0 rounded bg-amber-100 px-1 text-[11px] text-amber-800"
                >
                  {t('tree.orphanShort', 'órfão')}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {roots.length === 0 ? (
        <p data-testid="tree-empty" className="px-4 py-3 text-sm text-slate-500">
          {emptyMessage ?? t('common.empty', 'Nenhum registro encontrado.')}
        </p>
      ) : null}
    </div>
  );
}
