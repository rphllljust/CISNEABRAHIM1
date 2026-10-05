import type { BillingDocumentDetail } from '../types/billing.types';
import { BILLING_DOCUMENT_STATUSES } from '../types/billing.types';
import { formatDateTimePtBr, formatMoneyBrl } from '../utils/billing-format';

/**
 * Rotulo humano do status do DOCUMENTO (nao do registro de preparacao). O contrato publica
 * `FINALIZED`/`CANCELLED`; exibir o enum cru seria vazar codigo tecnico para a superficie
 * operacional. Sem status conhecido, o codigo permanece como ultimo recurso.
 */
const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  [BILLING_DOCUMENT_STATUSES.Finalized]: 'Finalizada',
  [BILLING_DOCUMENT_STATUSES.Cancelled]: 'Cancelada',
};

function formatDocumentStatus(status: string): string {
  return DOCUMENT_STATUS_LABELS[status] ?? status;
}

function documentStatusModifier(status: string): string {
  if (status === BILLING_DOCUMENT_STATUSES.Finalized) {
    return 'finalized';
  }
  if (status === BILLING_DOCUMENT_STATUSES.Cancelled) {
    return 'cancelled';
  }
  return 'neutral';
}

type BillingDocumentIssuedListProps = {
  documents: BillingDocumentDetail[];
  onDownload: (document: BillingDocumentDetail) => void;
  downloadingId: string | null;
};

export function BillingDocumentIssuedList({
  documents,
  onDownload,
  downloadingId,
}: BillingDocumentIssuedListProps) {
  if (documents.length === 0) {
    return <p className="billing-documents__empty">Nenhum documento emitido nesta preparação.</p>;
  }

  return (
    <ul className="billing-doc-issued-list">
      {documents.map((document) => (
        <li key={document.id} className="billing-doc-issued-list__item">
          <div>
            <p className="billing-doc-issued-list__number">{document.documentNumber}</p>
            <p className="billing-doc-issued-list__meta">
              <span className={`billing-doc-status billing-doc-status--${documentStatusModifier(document.status)}`}>
                {formatDocumentStatus(document.status)}
              </span>{' '}
              · v{document.versionNumber} · {formatDateTimePtBr(document.issuedAt)}
            </p>
            <p className="billing-doc-issued-list__amount">
              {formatMoneyBrl(document.totalAmount, document.currencyCode)}
            </p>
          </div>
          {document.status === 'FINALIZED' ? (
            <button
              type="button"
              className="billing-button"
              disabled={downloadingId === document.id}
              onClick={() => onDownload(document)}
            >
              {downloadingId === document.id ? 'Baixando…' : 'Baixar PDF'}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
