import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DocumentsApiError, listDocuments, listDocumentVersions } from '../../documents/api/documents-api';
import { DocumentDownloadAction } from '../../documents/components/DocumentDownloadAction';
import type { DocumentDetail, DocumentVersion } from '../../documents/types/document.types';
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

type VersionState =
  | { documentId: string; phase: 'loading' | 'denied' | 'error' }
  | { documentId: string; phase: 'ready'; items: DocumentVersion[] };

type Props = {
  assetId: string;
  unitId: string;
  canAttach: boolean;
  canDownload: boolean;
};

/** Reuses GED versions, downloads and PDP; never duplicates document storage. */
export function AssetDocumentsPanel({ assetId, unitId, canAttach, canDownload }: Props) {
  const [state, setState] = useState<LinkState>({ phase: 'loading' });
  const [query, setQuery] = useState('');
  const [versions, setVersions] = useState<VersionState | null>(null);
  const generationRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const versionAbortRef = useRef<AbortController | null>(null);
  const [search, setSearch] = useState<SearchState>({ phase: 'idle' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = generationRef.current;
    try {
      const response = await listAssetDocuments(assetId, signal);
      if (!signal?.aborted && generation === generationRef.current) setState({ phase: 'ready', ...response });
    } catch (error) {
      if (signal?.aborted || generation !== generationRef.current) return;
      setState({
        phase: error instanceof AssetDocumentsApiError && error.kind === 'denied'
          ? 'denied' : 'error',
      });
    }
  }, [assetId]);

  useEffect(() => {
    generationRef.current += 1;
    const controller = new AbortController();
    setState({ phase: 'loading' });
    setSearch({ phase: 'idle' });
    setVersions(null);
    setQuery('');
    setPendingId(null);
    setActionError(null);
    void load(controller.signal);
    return () => {
      generationRef.current += 1;
      controller.abort();
      searchAbortRef.current?.abort();
      versionAbortRef.current?.abort();
    };
  }, [load, unitId]);

  const find = async () => {
    if (!canAttach || state.phase !== 'ready') return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const generation = generationRef.current;
    setSearch({ phase: 'loading' });
    try {
      const result = await listDocuments(controller.signal, { unitId, q: query, limit: 20 });
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setSearch({ phase: 'ready', items: result.items.filter((item) => item.unitId === unitId) });
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setSearch({
        phase: error instanceof DocumentsApiError && error.kind === 'denied'
          ? 'denied' : 'error',
      });
    }
  };

  const toggleVersions = async (documentId: string) => {
    versionAbortRef.current?.abort();
    if (versions?.documentId === documentId) {
      setVersions(null);
      return;
    }
    const controller = new AbortController();
    versionAbortRef.current = controller;
    const generation = generationRef.current;
    setVersions({ documentId, phase: 'loading' });
    try {
      const items = await listDocumentVersions(documentId, controller.signal);
      if (!controller.signal.aborted && generation === generationRef.current) {
        setVersions({ documentId, phase: 'ready', items });
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setVersions({
        documentId,
        phase: error instanceof DocumentsApiError && error.kind === 'denied'
          ? 'denied' : 'error',
      });
    }
  };

  const attach = async (documentId: string) => {
    if (!canAttach || state.phase !== 'ready') return;
    const generation = generationRef.current;
    setPendingId(documentId);
    setActionError(null);
    try {
      await attachAssetDocument(assetId, documentId);
      if (generation !== generationRef.current) return;
      await load();
      if (generation !== generationRef.current) return;
      setSearch({ phase: 'idle' });
      setQuery('');
    } catch (error) {
      if (generation !== generationRef.current) return;
      setActionError(
        error instanceof AssetDocumentsApiError && error.kind === 'denied'
          ? 'Sem autorização para vincular este documento ao ativo.'
          : 'Não foi possível vincular o documento. Verifique as permissões e tente novamente.',
      );
    } finally {
      if (generation === generationRef.current) setPendingId(null);
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
                <li key={doc.id} className="space-y-2 border-b border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-medium">{doc.title}</span>
                    <span className="text-xs text-gray-600">
                      {doc.categoryCode} · v{doc.currentVersionNumber ?? '—'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canDownload && doc.currentVersionNumber !== null ? (
                      <DocumentDownloadAction documentId={doc.id} versionNumber={doc.currentVersionNumber}
                        filename={doc.title} variant="secondary" />
                    ) : null}
                    <button type="button" aria-expanded={versions?.documentId === doc.id}
                      className="rounded border border-gray-300 px-3 py-2"
                      onClick={() => void toggleVersions(doc.id)}>
                      {versions?.documentId === doc.id ? 'Fechar versões' : 'Ver versões'}
                    </button>
                  </div>
                  {versions?.documentId === doc.id ? (
                    <div className="space-y-2 rounded bg-gray-50 p-3">
                      {versions.phase === 'loading' ? <p role="status">Consultando versões…</p> : null}
                      {versions.phase === 'denied' ? <p role="status">Acesso às versões não autorizado.</p> : null}
                      {versions.phase === 'error' ? <p role="alert">Falha na consulta de versões.</p> : null}
                      {versions.phase === 'ready' && versions.items.length === 0 ? <p>Não há versões publicadas.</p> : null}
                      {versions.phase === 'ready' ? (
                        <ul className="space-y-2">
                          {versions.items.map((version) => (
                            <li key={version.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="min-w-0 break-words">
                                v{version.versionNumber} · {version.originalFilename}
                                {version.isCurrent ? ' · Atual' : ''}
                              </span>
                              {canDownload ? (
                                <DocumentDownloadAction documentId={doc.id} versionNumber={version.versionNumber}
                                  filename={version.originalFilename} label={'Baixar v' + version.versionNumber} />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-600">
            A consulta cobre os vínculos recentes autorizados, não o histórico completo do GED.
          </p>
        </>
      ) : null}

      {state.phase === 'ready' && canAttach ? (
        <div className="border-t border-gray-200 pt-3">
          <p className="font-medium">Vincular documento existente</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="Buscar documento para vincular"
              type="search"
              className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
              value={query}
              onChange={(event) => {
                searchAbortRef.current?.abort();
                setSearch({ phase: 'idle' });
                setQuery(event.target.value);
              }}
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
      {state.phase === 'ready' && !canAttach ? (
        <p className="text-xs text-gray-600">Vinculação indisponível para as permissões desta sessão.</p>
      ) : null}
    </div>
  );
}
