import { useState } from 'react';
import { Button, type ButtonVariant } from '../../ui/Button';
import { DocumentsApiError } from '../api/documents-api';
import { mapDocumentErrorToMessage } from '../api/document-error-messages';
import { downloadDocumentContent } from '../api/documents-api';

type DocumentDownloadActionProps = {
  documentId: string;
  versionNumber: number;
  filename: string;
  disabled?: boolean;
  label?: string;
  /**
   * Aparencia da acao. O padrao preserva o botao discreto ja usado nos paineis das entidades; a
   * listagem de Documentos pede `secondary`, porque fora do contexto da entidade a acao precisa
   * parecer BOTAO e nao texto solto.
   */
  variant?: ButtonVariant;
};

/** Glifo de download: decorativo, o nome acessivel vem do botao. */
function DownloadGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8" />
      <path d="M4.5 6.8 8 10.3l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

export function DocumentDownloadAction({
  documentId,
  versionNumber,
  filename,
  disabled = false,
  label = 'Baixar',
  variant = 'ghost',
}: DocumentDownloadActionProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename: resolvedName } = await downloadDocumentContent(documentId, versionNumber);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = resolvedName || filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof DocumentsApiError
          ? mapDocumentErrorToMessage(err.code, err.status)
          : 'Não foi possível baixar o arquivo.',
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <span className="doc-download-action">
      <Button
        type="button"
        variant={variant}
        disabled={disabled || downloading}
        onClick={() => void handleDownload()}
        // Nome acessivel continua carregando o arquivo: em listas com titulos repetidos (evidencias
        // de UAT, por exemplo) "Baixar" sozinho nao diz QUAL documento sera baixado.
        aria-label={`${label} ${filename}`}
      >
        <DownloadGlyph />
        {downloading ? 'Baixando…' : label}
      </Button>
      {error ? (
        <span className="doc-download-action__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
