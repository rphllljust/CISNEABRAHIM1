import { formatMoneyBrl, formatPaymentDueHint } from '../utils/billing-format';

type BillingSummaryPanelProps = {
  itemCount: number;
  totalAmount: string | null;
  currencyCode: string;
  paymentTerms: string;
  preparedAt?: string | null;
};

export function BillingSummaryPanel({
  itemCount,
  totalAmount,
  currencyCode,
  paymentTerms,
  preparedAt,
}: BillingSummaryPanelProps) {
  return (
    <section className="billing-summary" aria-labelledby="billing-summary-heading">
      <h2 id="billing-summary-heading">Resumo financeiro</h2>
      <dl className="billing-summary__grid">
        <div>
          <dt>Itens</dt>
          <dd className="billing-summary__value">{itemCount}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd className="billing-summary__value billing-summary__total">
            {formatMoneyBrl(totalAmount, currencyCode)}
          </dd>
        </div>
        <div>
          <dt>Condição comercial</dt>
          <dd>{paymentTerms || '—'}</dd>
        </div>
        <div>
          <dt>Vencimento estimado</dt>
          <dd>{formatPaymentDueHint(paymentTerms, preparedAt ?? undefined)}</dd>
        </div>
      </dl>
    </section>
  );
}
