import { useId } from 'react';

type BillingPrepareDialogProps = {
  open: boolean;
  paymentTerms: string;
  totalAmount: string | null;
  currencyCode: string;
  onPaymentTermsChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
};

export function BillingPrepareDialog({
  open,
  paymentTerms,
  totalAmount,
  currencyCode,
  onPaymentTermsChange,
  onClose,
  onConfirm,
  confirming,
}: BillingPrepareDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  if (!open) {
    return null;
  }

  return (
    <dialog className="billing-dialog" open aria-labelledby={titleId} aria-describedby={descriptionId}>
      <form
        method="dialog"
        className="billing-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h2 id={titleId}>Preparar faturamento</h2>
        <p id={descriptionId}>
          Confirme a condição comercial aplicável. {totalAmount === null
            ? 'O valor será calculado e validado pelo servidor a partir da base contratual persistida.'
            : <>O total será derivado dos itens da medição aprovada ({new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(Number(totalAmount))}).</>}
        </p>
        <label className="billing-field">
          <span>Condição comercial</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            value={paymentTerms}
            onChange={(event) => onPaymentTermsChange(event.target.value)}
            required
          />
        </label>
        <div className="billing-dialog__actions">
          <button type="button" className="billing-button" onClick={onClose} disabled={confirming}>
            Cancelar
          </button>
          <button type="submit" className="billing-button billing-button--primary" disabled={confirming}>
            {confirming ? 'Preparando…' : 'Confirmar preparação'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
