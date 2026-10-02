import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSuppliers } from '../api/suppliers-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import {
  DynamicList,
  useEntitySchema,
  type MetaEntitySchema,
} from '../../engine';
import { supplierEngineRows, type SupplierEngineRow } from './supplier-engine-rows';

/**
 * Lista de fornecedores RENDERIZADA PELA ENGINE.
 *
 * Não há coluna, rótulo ou ordem escritos aqui: `DynamicList` lê a view `list` do metadata
 * store (`meta.views.layout.columns`) e os campos de `meta.fields`. Adicionar uma coluna é um
 * INSERT, não um deploy.
 *
 * O que permanece neste arquivo é APENAS o encanamento de dados — qual endpoint alimenta a
 * entidade — que a engine não tem como adivinhar. Nenhum JSX de tabela.
 */
export function SuppliersEngineListPage() {
  const navigate = useNavigate();
  const { schema, status } = useEntitySchema('suppliers');
  const [rows, setRows] = useState<SupplierEngineRow[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadRows = useCallback(async (signal?: AbortSignal) => {
    setRowsStatus('loading');
    try {
      const response = await listSuppliers({ limit: 50, offset: 0 }, signal);
      setRows(supplierEngineRows(response.items));
      setRowsStatus('ready');
    } catch (error) {
      if (error instanceof BackofficeApiError) {
        setRowsStatus('error');
        return;
      }
      setRowsStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    return () => controller.abort();
  }, [loadRows]);

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{schema?.label ?? 'Fornecedores'}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Lista renderizada pela engine a partir de <code>/api/v1/meta/suppliers</code>.
        </p>
      </header>

      {status === 'loading' || rowsStatus === 'loading' ? (
        <p className="text-sm text-gray-600" aria-busy="true">
          Carregando…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {rowsStatus === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar os fornecedores.
        </p>
      ) : null}

      {schema && rowsStatus === 'ready' ? (
        <DynamicList
          schema={schema}
          rows={rows}
          emptyMessage="Nenhum fornecedor cadastrado."
          onRowClick={(row) => navigate(`/app/suppliers/${row.id}`)}
        />
      ) : null}
    </div>
  );
}

export type { MetaEntitySchema };
