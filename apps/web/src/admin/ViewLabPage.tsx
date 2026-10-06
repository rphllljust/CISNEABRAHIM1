import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { listServiceOrders } from '../service-orders/api/service-orders-api';
import { DynamicGraph } from '../engine/DynamicGraph';
import { DynamicPivot } from '../engine/DynamicPivot';
import { DynamicTree } from '../engine/DynamicTree';
import { fetchEntitySchema } from '../engine/meta-api';
import type { MetaEntitySchema } from '../engine/types';

/**
 * BANCADA DAS VIEWS QUE O STORE AINDA NÃO PODE DECLARAR.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA PÁGINA EXISTE
 *
 * Medido contra o banco real:
 *
 *   CONSTRAINT meta_views_type_chk CHECK (view_type IN ('form','list','kanban','calendar'))
 *
 * `pivot`, `tree` e `graph` são capacidades da ENGINE, mas o CHECK de `meta.views` não permite
 * declará-las no metadata store. Ampliar o CHECK exige migration em `packages/database/`, que
 * esta track não pode escrever (GAP_DE_BANCO declarado no relatório).
 *
 * Sem esta bancada, essas três views ficariam SEM PROVA VISUAL — e a regra da track é
 * explícita: `tsc exit 0` não conta; a prova é DOM renderizado.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ELA PROVA, E O QUE ELA NÃO PROVA
 *
 * PROVA: o RENDERIZADOR está correto e é dirigido por layout. A bancada monta um schema em
 * memória com o `layout` que o store DEVERIA poder guardar, e a view o consome pelo MESMO
 * caminho de código (`readLayout` → renderizador). Se o renderizador ignorasse o layout, a
 * prova falharia igual.
 *
 * NÃO PROVA: que o valor venha do banco. Essa metade é exatamente o gap — e a bancada DIZ
 * isso na tela, em vez de se passar por uma view do store.
 */
export function ViewLabPage() {
  const [schema, setSchema] = useState<MetaEntitySchema | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Layout editável em tempo real: é o "SQL" desta bancada, já que o SQL não pode gravar.
  const [pivotLayout, setPivotLayout] = useState('{"groupBy":["status"],"aggregateOp":"count"}');
  const [treeLayout, setTreeLayout] = useState('{"parentField":"unit_id","labelField":"order_number"}');
  const [graphLayout, setGraphLayout] = useState(
    '{"categoryField":"status","chartType":"bar","aggregateOp":"count"}',
  );

  /** Carrega o schema REAL da entidade (não inventamos campos) e linhas reais. */
  useEffect(() => {
    const controller = new AbortController();
    fetchEntitySchema('service-orders', controller.signal)
      .then((result) => {
        setSchema(result);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    /*
     * AS LINHAS VÊM PELO CLIENTE DA ENGINE, não por `fetch` cru.
     *
     * O token de acesso vive em MEMÓRIA (`tokenStore`), nunca em `sessionStorage` — um `fetch`
     * com `sessionStorage.getItem('cisne.accessToken')` mandaria `null`, o servidor devolveria
     * 401 e a bancada renderizaria com ZERO linhas. Uma bancada sem dado prova nada sobre
     * layout, então este caminho tem de ser o mesmo que as telas reais usam.
     */
    listServiceOrders({ limit: 50, offset: 0 }, controller.signal)
      .then((response) => {
        setRows(
          response.items.map((item) => ({
            id: item.id,
            order_number: item.orderNumber,
            status: item.status,
            unit_id: item.unitId,
            row_version: item.rowVersion,
            updated_at: item.updatedAt,
            created_at: null,
            deadline_at: item.deadlineAt,
          })),
        );
      })
      .catch(() => setRows([]));
    return () => controller.abort();
  }, []);

  /** Schema com o layout da bancada aplicado — a MESMA forma que o store devolveria. */
  const labSchema = useMemo<MetaEntitySchema | null>(() => {
    if (!schema) {
      return null;
    }
    const parse = (raw: string): Record<string, unknown> => {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    return {
      ...schema,
      views: [
        ...schema.views,
        { viewType: 'pivot', label: 'Bancada: pivot', layout: parse(pivotLayout), isDefault: false },
        { viewType: 'tree', label: 'Bancada: árvore', layout: parse(treeLayout), isDefault: false },
        { viewType: 'graph', label: 'Bancada: gráfico', layout: parse(graphLayout), isDefault: false },
      ] as MetaEntitySchema['views'],
    };
  }, [schema, pivotLayout, treeLayout, graphLayout]);

  /**
   * Linhas no formato da engine.
   *
   * A conversão camelCase → snake_case já aconteceu na carga (o adaptador da listagem é o
   * mesmo caminho das telas reais); aqui só se garante o `id` que `DynamicListRow` exige.
   */
  const engineRows = useMemo(() => {
    return rows.map((item, index) => {
      const rawId = item['id'];
      const id =
        typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : String(index);
      return { ...item, id };
    });
  }, [rows]);

  if (status === 'loading') {
    return (
      <div data-testid="view-lab" className="p-4 text-sm text-slate-500">
        {t('common.loading', 'Carregando…')}
      </div>
    );
  }

  if (status === 'error' || !labSchema) {
    return (
      <div data-testid="view-lab" data-lab-status="error" className="p-4 text-sm text-red-700">
        {t('lab.schemaError', 'Não foi possível ler o schema de service-orders.')}
      </div>
    );
  }

  return (
    <div data-testid="view-lab" data-lab-entity="service-orders" data-lab-rows={engineRows.length} className="p-4">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900">
          {t('lab.title', 'Bancada de views V4')}
        </h1>
        <p className="text-sm text-slate-600">
          {t(
            'lab.subtitle',
            'pivot, tree e graph são capacidades da engine que o CHECK de meta.views ainda não permite declarar no store. Esta bancada as dirige pelo MESMO caminho de layout, com o schema e as linhas REAIS desta entidade.',
          )}
        </p>
      </header>

      {/* O GAP É DECLARADO NA PRÓPRIA TELA. */}
      <div
        data-testid="lab-db-gap"
        className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        <p className="font-semibold">
          GAP_DE_BANCO — {t('lab.gap', 'o metadata store não aceita estes view_type.')}
        </p>
        <p className="mt-1">
          <code>meta_views_type_chk CHECK (view_type IN ('form','list','kanban','calendar'))</code>.
          {' '}
          {t(
            'lab.gapFix',
            'Ampliar o CHECK exige migration em packages/database/ (fora do escopo desta track). Quando ele for ampliado, estas views funcionam no store sem nenhuma alteração de código.',
          )}
        </p>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          {t('lab.pivot', 'Tabela dinâmica (pivot)')}
        </h2>
        <label className="mb-2 block text-xs text-slate-500">
          layout (o que o store guardaria):
          <textarea
            data-lab-layout="pivot"
            value={pivotLayout}
            onChange={(event) => setPivotLayout(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-slate-300 p-1 font-mono text-[11px]"
          />
        </label>
        <DynamicPivot schema={labSchema} rows={engineRows} viewType="pivot" />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          {t('lab.tree', 'Árvore (tree)')}
        </h2>
        <label className="mb-2 block text-xs text-slate-500">
          layout:
          <textarea
            data-lab-layout="tree"
            value={treeLayout}
            onChange={(event) => setTreeLayout(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-slate-300 p-1 font-mono text-[11px]"
          />
        </label>
        <DynamicTree schema={labSchema} rows={engineRows} viewType="tree" />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          {t('lab.graph', 'Gráfico (graph)')}
        </h2>
        <label className="mb-2 block text-xs text-slate-500">
          layout:
          <textarea
            data-lab-layout="graph"
            value={graphLayout}
            onChange={(event) => setGraphLayout(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-slate-300 p-1 font-mono text-[11px]"
          />
        </label>
        <DynamicGraph schema={labSchema} rows={engineRows} viewType="graph" />
      </section>
    </div>
  );
}
