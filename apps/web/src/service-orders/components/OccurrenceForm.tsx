import { useId, useState } from 'react';

type OccurrenceFormProps = {
  open: boolean;
  disabled?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: { occurrenceCode: string; description: string }) => void;
};

const fieldClass = 'flex min-w-0 flex-col gap-1.5';
const labelClass = 'text-sm font-semibold text-gray-700';
const controlClass =
  'min-h-9 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';

export function OccurrenceForm({ open, disabled = false, busy = false, onClose, onSubmit }: OccurrenceFormProps) {
  const formId = useId();
  const [occurrenceCode, setOccurrenceCode] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  return (
    <section className="execution-section execution-occurrence" aria-labelledby={`${formId}-title`}>
      <div className="execution-occurrence__header">
        <h2 id={`${formId}-title`}>Registrar ocorrência</h2>
        <button type="button" className="button-link" onClick={onClose}>
          Fechar
        </button>
      </div>
      <form
        id={formId}
        className="execution-occurrence__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!occurrenceCode.trim() || !description.trim()) {
            setError('Informe o código e a descrição da ocorrência.');
            return;
          }
          setError(null);
          onSubmit({ occurrenceCode: occurrenceCode.trim(), description: description.trim() });
        }}
      >
        {error ? (
          <div className="execution-error-summary" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        <div className={fieldClass}>
          <label htmlFor={`${formId}-code`} className={labelClass}>
            Código
          </label>
          <input
            id={`${formId}-code`}
            name="occurrenceCode"
            value={occurrenceCode}
            disabled={disabled || busy}
            onChange={(event) => setOccurrenceCode(event.target.value)}
            autoComplete="off"
            className={controlClass}
          />
        </div>
        <div className={fieldClass}>
          <label htmlFor={`${formId}-description`} className={labelClass}>
            Descrição
          </label>
          <textarea
            id={`${formId}-description`}
            name="description"
            className={`${controlClass} min-h-24`}
            rows={3}
            value={description}
            disabled={disabled || busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={disabled || busy}>
            {busy ? 'Salvando…' : 'Registrar ocorrência'}
          </button>
        </div>
      </form>
    </section>
  );
}
