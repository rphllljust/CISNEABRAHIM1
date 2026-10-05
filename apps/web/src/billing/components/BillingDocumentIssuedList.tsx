import type { BillingDocumentDetail } from '../types/billing.types';
import { BILLING_DOCUMENT_STATUSES } from '../types/billing.types';
import { StatusBadge, type StatusBadgeTone } from '../../ui/StatusBadge';
import { formatDateTimePtBr, formatMoneyBrl } from '../utils/billing-format';

/**
 * Rotulo humano do status do DOCUMENTO (nao do registro de preparacao). O contrato publica
 * `FINALIZED`/`CANCELLED` — uma maquina de estados DISTINTA de PREPARED/VOIDED, que
 * `BillingStatusBadge` cobre. A gramatica visual e a mesma de TODO o produto (`StatusBadge`);
 * a semantica, nao: FINALIZED e conclusao, CANCELLED e estorno.
 */
const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  [BILLING_DOCUMENT_STATUSES.Finalized]: 'Finalizada',
  [BILLING_DOCUMENT_STATUSES.Cancelled]: 'Cancelada',
};

function resolveDocumentStatusTone(status: string): StatusBadgeTone {
  if (status === BILLING_DOCUMENT_STATUSES.Finalized) {
    return 'success';
  }
  if (status === BILLING_DOCUMENT_STATUSES.Cancelled) {
    return 'error';
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
              <StatusBadge
                label={DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
                tone={resolveDocumentStatusTone(document.status)}
              />{' '}
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
