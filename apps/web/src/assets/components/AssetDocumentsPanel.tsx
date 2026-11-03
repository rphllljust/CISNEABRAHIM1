import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDocuments } from '../../documents/api/documents-api';
import type { DocumentDetail } from '../../documents/types/document.types';
import {
  AssetDocumentsApiError,
  attachAssetDocument,
  listAssetDocuments,
} from '../api/asset-documents-api';

type LinkState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; items: DocumentDetail[]; scope: 'RECENT_WINDOW' };
type SearchState =
  | { phase: 'idle' | 'loading' | 'error' | 'denied' }
  | { phase: 'ready'; items: DocumentDetail[] };

export function AssetDocumentsPanel({ assetId, unitId }: { assetId: string; unitId: string }) {
  const [state, setState] = useState<LinkState>({ phase: 'loading' });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ phase: 'idle' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await listAssetDocuments(assetId, signal);
      if (!signal?.aborted) setState({ phase: 'ready', ...response });
    } catch (error) {
      if (signal?.aborted) return;
      setState({
        phase: error instanceof AssetDocumentsApiError && error.kind === 'denied'
          ? 'denied' : 'error',
      });
    }
  }, [assetId]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    setSearch({ phase: 'idle' });
    setActionError(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, unitId]);

  const find = async () => {
    setSearch({ phase: 'loading' });
    try {
      const result = await listDocuments(undefined, { unitId, q: query, limit: 20 });
      setSearch({ phase: 'ready', items: result.items.filter((item) => item.unitId === unitId) });
    } catch (error) {
      setSearch({
        phase: error instanceof Error && 'kind' in error && error.kind === 'denied'
          ? 'denied' : 'error',
      });
    }
  };

  const attach = async (documentId: string) => {
    setPendingId(documentId);
    setActionError(null);
    try {
      await attachAssetDocument(assetId, documentId);
      await load();
      setSearch({ phase: 'idle' });
      setQuery('');
    } catch (error) {
      setActionError(
        error instanceof AssetDocumentsApiError && error.kind === 'denied'
          ? 'Sem autorização para vincular este documento ao ativo.'
          : 'Não foi possível vincular o documento. Verifique as permissões e tente novamente.',
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      {state.phase === 'loading' ? <p>Consultando documentos vinculados…</p> : null}
      {state.phase === 'denied'
        ? <p role="status">Acesso aos documentos deste ativo não autorizado.</p> : null}
      {state.phase === 'error'
        ? <div role="alert">Não foi possível consultar documentos. <button type="button" onClick={() => void load()}>Tentar novamente</button></div>
        : null}
      {state.phase === 'ready' ? (
        <>
          {state.items.length === 0 ? (
            <p>Nenhum documento autorizado encontrado nos vínculos recentes.</p>
          ) : (
            <ul className="space-y-2">
              {state.items.map((doc) => (
                <li key={doc.id} className="flex items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                  <span className="min-w-0 break-words font-medium">{doc.title}</span>
                  <span className="shrink-0 text-xs text-gray-600">
                    {doc.categoryCode} · v{doc.currentVersionNumber ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-600">
            A consulta cobre os vínculos recentes autorizados, não o histórico completo do GED.
          </p>
        </>
      ) : null}

      {state.phase !== 'denied' && state.phase !== 'loading' ? (
        <div className="border-t border-gray-200 pt-3">
          <p className="font-medium">Vincular documento existente</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="Buscar documento para vincular"
              type="search"
              className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por título"
            />
            <button type="button" className="rounded border border-gray-300 px-3 py-2" onClick={() => void find()}>
              Buscar no GED
            </button>
          </div>
          {search.phase === 'loading' ? <p>Buscando…</p> : null}
          {search.phase === 'denied' ? <p>Consulta ao GED não autorizada.</p> : null}
          {search.phase === 'error' ? <p role="alert">Falha na busca de documentos.</p> : null}
          {search.phase === 'ready' ? (
            <ul className="mt-2 space-y-2">
              {search.items.length === 0 ? <li>Nenhum documento autorizado encontrado.</li> : null}
              {search.items.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-2">
                  <span>{doc.title}</span>
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
                    onClick={() => void attach(doc.id)}
                  >
                    {pendingId === doc.id ? 'Vinculando…' : 'Vincular'}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {actionError ? <p role="alert" className="mt-2 text-red-700">{actionError}</p> : null}
          <Link to="/app/documents" className="mt-3 inline-block text-brand-700">
            Abrir Gestão de Documentos
          </Link>
        </div>
      ) : null}
    </div>
  );
}
