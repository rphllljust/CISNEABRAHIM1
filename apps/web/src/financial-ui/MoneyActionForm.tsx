import { useRef, useState, type FormEvent } from 'react';
import { Button, ConfirmAction, Field, Input, Textarea, VersionConflictBanner } from '../ui';
import { FormSection } from '../ui';
import { BackofficeApiError } from './enterprise-api';
import { createIdempotencyKey } from './idempotency';
import { ProcessingBanner } from './ProcessingBanner';

export function MoneyActionForm({
  title,
  description,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  amountLabel,
  reasonLabel,
  extraField,
  disabled,
  onSubmit,
  onReload,
  mapError,
}: {
  title: string;
  description: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  amountLabel?: string;
  reasonLabel?: string;
  extraField?: { id: string; label: string; name: string };
  disabled?: boolean;
  onSubmit: (input: {
    amount?: string;
    reason?: string;
    extra?: string;
    idempotencyKey: string;
  }) => Promise<void>;
  onReload?: () => void;
  mapError: (code: string | undefined, status: number) => string;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState('');
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const inflight = useRef(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  function handleOpen(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setConflict(false);
    setOpen(true);
  }

  function releaseInflight(): void {
    inflight.current = false;
  }

  async function handleConfirm() {
    if (inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setError(null);
    try {
      await onSubmit({
        amount: amount.trim() || undefined,
        reason: reason.trim() || undefined,
        extra: extra.trim() || undefined,
        idempotencyKey: idempotencyKey.current,
      });
      setOpen(false);
      idempotencyKey.current = createIdempotencyKey();
      setAmount('');
      setReason('');
      setExtra('');
      releaseInflight();
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.kind === 'version_conflict') {
        setConflict(true);
        setError(mapError(caught.code, caught.status));
        // Keep the confirm spent until cancel/reload so a second click cannot POST again.
      } else if (caught instanceof BackofficeApiError) {
        setOpen(false);
        setError(mapError(caught.code, caught.status));
        releaseInflight();
      } else {
        setError(mapError(undefined, 0));
        releaseInflight();
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <FormSection title={title} description={description}>
      <form onSubmit={handleOpen} className="space-y-4">
        {amountLabel ? (
          <Field label={amountLabel} htmlFor={`${title}-amount`} required>
            <Input
              id={`${title}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              disabled={disabled || processing}
            />
          </Field>
        ) : null}
        {extraField ? (
          <Field label={extraField.label} htmlFor={extraField.id} required>
            <Input
              id={extraField.id}
              name={extraField.name}
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              required
              disabled={disabled || processing}
            />
          </Field>
        ) : null}
        {reasonLabel ? (
          <Field label={reasonLabel} htmlFor={`${title}-reason`} required>
            <Textarea
              id={`${title}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              disabled={disabled || processing}
            />
          </Field>
        ) : null}
        {processing ? <ProcessingBanner /> : null}
        {conflict && error ? (
          <VersionConflictBanner message={error} onReload={() => (onReload ? onReload() : undefined)} />
        ) : null}
        {error && !conflict ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={disabled || processing} loading={processing}>
          {confirmLabel}
        </Button>
      </form>
      <ConfirmAction
        open={open}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        loading={processing}
        confirmDisabled={conflict}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          setOpen(false);
          releaseInflight();
        }}
      />
    </FormSection>
  );
}
