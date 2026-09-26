import { useEffect, useState } from 'react';
import { DocumentsApiError, listDocuments } from '../api/documents-api';
import { mapDocumentErrorToMessage } from '../api/document-error-messages';
import { DocumentDownloadAction } from '../components/DocumentDownloadAction';
import { useDocumentCapabilities } from '../hooks/useDocumentCapabilities';
import type { DocumentDetail } from '../types/document.types';
import { formatDateTimePtBr } from '../utils/document-format';

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: 'Geral',
  EVIDENCE: 'Evidência',
  BILLING_DOCUMENT: 'Faturamento',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
};

export function DocumentsPage() {
  const { capabilities, loading: capabilitiesLoading } = useDocumentCapabilities();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [items, setItems] = useState<DocumentDetail[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listDocuments(controller.signal)
      .then((documents) => {
        setItems(documents);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof DocumentsApiError && error.kind === 'denied') {
          setPhase('denied');
          return;
        }
        setMessage(
          error instanceof DocumentsApiError
            ? mapDocumentErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar os documentos.',
        );
        setPhase('error');
      });
    return () => controller.abort();
  }, []);

  if (phase === 'loading' || capabilitiesLoading) {
    return (
      <main id="main-content" className="shell-page">
        <p role="status">Carregando documentos…</p>
      </main>
    );
  }

  if (phase === 'denied' || !capabilities.canList) {
    return (
      <main id="main-content" className="shell-page">
        <h1>Documentos</h1>
        <p role="alert">Você não tem permissão para listar documentos.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="shell-page">
      <h1>Documentos</h1>
      <p>Arquivos já vinculados no sistema. O envio continua nas telas de execução e das entidades.</p>
      {phase === 'error' ? <p role="alert">{message}</p> : null}
      {phase === 'ready' && items.length === 0 ? (
        <p role="status">Nenhum documento disponível no seu escopo.</p>
      ) : null}
      {items.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Tipo</th>
              <th scope="col">Situação</th>
              <th scope="col">Unidade</th>
              <th scope="col">Atualizado</th>
              <th scope="col">Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{CATEGORY_LABELS[item.categoryCode] ?? item.categoryCode}</td>
                <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                <td>{item.unitId}</td>
                <td>{formatDateTimePtBr(item.updatedAt)}</td>
                <td>
                  {capabilities.canDownload && item.currentVersionNumber ? (
                    <DocumentDownloadAction
                      documentId={item.id}
                      versionNumber={item.currentVersionNumber}
                      filename={item.title}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
