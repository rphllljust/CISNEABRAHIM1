import { useEffect, useId, useRef, type ReactNode } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open) {
      lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) {
        dialog.showModal();
      }
      const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]');
      cancelButton?.focus();
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
    lastFocusedRef.current?.focus();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <form
        method="dialog"
        className="confirm-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled) {
            onConfirm();
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {children}
        <div className="confirm-dialog__actions flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="button-secondary"
            data-dialog-cancel
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="submit" disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
