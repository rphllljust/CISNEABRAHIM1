import { useId, useState } from 'react';
import {
  EXECUTION_EVIDENCE_KINDS,
  type ExecutionEvidenceKind,
} from '../types/service-order-execution.types';
import { isMeasuredEntryKind, labelForEvidenceKind } from '../utils/execution-requirements';

export type ActivitySubmitPayload =
  | { kind: typeof EXECUTION_EVIDENCE_KINDS.Observation; text: string }
  | { kind: typeof EXECUTION_EVIDENCE_KINDS.Quantity; quantityValue: string; unitCode: string }
  | { kind: typeof EXECUTION_EVIDENCE_KINDS.Mileage; value: string }
  | { kind: typeof EXECUTION_EVIDENCE_KINDS.HourMeter; value: string };

type ExecutionActivityPanelProps = {
  open: boolean;
  pendingKinds: ExecutionEvidenceKind[];
  defaultUnitCode: string | null;
  allowedUnits: string[];
  disabled?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (payload: ActivitySubmitPayload) => void;
};

const fieldClass = 'flex min-w-0 flex-col gap-1.5';
const labelClass = 'text-sm font-semibold text-gray-700';
const controlClass =
  'min-h-9 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';

export function ExecutionActivityPanel({
  open,
  pendingKinds,
  defaultUnitCode,
  allowedUnits,
  disabled = false,
  busy = false,
  onClose,
  onSubmit,
}: ExecutionActivityPanelProps) {
  const formId = useId();
  const [selectedKind, setSelectedKind] = useState<ExecutionEvidenceKind | ''>('');
  const [text, setText] = useState('');
  const [quantityValue, setQuantityValue] = useState('');
  const [unitCode, setUnitCode] = useState(defaultUnitCode ?? allowedUnits[0] ?? '');
  const [measuredValue, setMeasuredValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const activeKind = (selectedKind || pendingKinds[0] || '') as ExecutionEvidenceKind;

  return (
    <section className="execution-section execution-activity" aria-labelledby={`${formId}-title`}>
      <div className="execution-activity__header">
        <h2 id={`${formId}-title`}>Registrar atividade</h2>
        <button type="button" className="button-link" onClick={onClose}>
          Fechar
        </button>
      </div>
      <form
        className="execution-activity__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!activeKind) {
            setError('Selecione o tipo de registro.');
            return;
          }
          if (activeKind === EXECUTION_EVIDENCE_KINDS.Observation) {
            if (!text.trim()) {
              setError('Informe a observação.');
              return;
            }
            setError(null);
            onSubmit({ kind: EXECUTION_EVIDENCE_KINDS.Observation, text: text.trim() });
            return;
          }
          if (activeKind === EXECUTION_EVIDENCE_KINDS.Quantity) {
            if (!quantityValue.trim() || !unitCode.trim()) {
              setError('Informe quantidade e unidade.');
              return;
            }
            setError(null);
            onSubmit({
              kind: EXECUTION_EVIDENCE_KINDS.Quantity,
              quantityValue: quantityValue.trim(),
              unitCode: unitCode.trim(),
            });
            return;
          }
          if (isMeasuredEntryKind(activeKind)) {
            if (!measuredValue.trim()) {
              setError('Informe o valor medido.');
              return;
            }
            setError(null);
            onSubmit({
              kind:
                activeKind === EXECUTION_EVIDENCE_KINDS.Mileage
                  ? EXECUTION_EVIDENCE_KINDS.Mileage
                  : EXECUTION_EVIDENCE_KINDS.HourMeter,
              value: measuredValue.trim(),
            });
          }
        }}
      >
        {error ? (
          <div className="execution-error-summary" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        {pendingKinds.length > 1 ? (
          <div className={fieldClass}>
            <label htmlFor={`${formId}-kind`} className={labelClass}>
              Tipo
            </label>
            <select
              id={`${formId}-kind`}
              value={activeKind}
              disabled={disabled || busy}
              className={controlClass}
              onChange={(event) => setSelectedKind(event.target.value as ExecutionEvidenceKind)}
            >
              {pendingKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {labelForEvidenceKind(kind)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {activeKind === EXECUTION_EVIDENCE_KINDS.Observation ? (
          <div className={fieldClass}>
            <label htmlFor={`${formId}-text`} className={labelClass}>
              Observação
            </label>
            <textarea
              id={`${formId}-text`}
              className={`${controlClass} min-h-28`}
              rows={4}
              value={text}
              disabled={disabled || busy}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        ) : null}
        {activeKind === EXECUTION_EVIDENCE_KINDS.Quantity ? (
          <>
            <div className={fieldClass}>
              <label htmlFor={`${formId}-quantity`} className={labelClass}>
                Quantidade
              </label>
              <input
                id={`${formId}-quantity`}
                inputMode="decimal"
                value={quantityValue}
                disabled={disabled || busy}
                className={controlClass}
                onChange={(event) => setQuantityValue(event.target.value)}
              />
            </div>
            <div className={fieldClass}>
              <label htmlFor={`${formId}-unit`} className={labelClass}>
                Unidade
              </label>
              {allowedUnits.length > 0 ? (
                <select
                  id={`${formId}-unit`}
                  value={unitCode}
                  disabled={disabled || busy}
                  className={controlClass}
                  onChange={(event) => setUnitCode(event.target.value)}
                >
                  {allowedUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${formId}-unit`}
                  value={unitCode}
                  disabled={disabled || busy}
                  className={controlClass}
                  onChange={(event) => setUnitCode(event.target.value)}
                />
              )}
            </div>
          </>
        ) : null}
        {isMeasuredEntryKind(activeKind) ? (
          <div className={fieldClass}>
            <label htmlFor={`${formId}-measured`} className={labelClass}>
              {labelForEvidenceKind(activeKind)}
            </label>
            <input
              id={`${formId}-measured`}
              inputMode="decimal"
              value={measuredValue}
              disabled={disabled || busy}
              className={controlClass}
              onChange={(event) => setMeasuredValue(event.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={disabled || busy}>
            {busy ? 'Salvando…' : 'Salvar registro'}
          </button>
        </div>
      </form>
    </section>
  );
}
