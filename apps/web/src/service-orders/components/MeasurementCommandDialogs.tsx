import { useEffect, useId, useRef, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import type {
  DetectedVariance,
  MeasurementWorkbenchReadModel,
} from '../types/measurement-workbench.types';
import {
  CommandImpactList,
  toleranceText,
} from './MeasurementDecisionContext';
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  stateLabel,
} from '../utils/measurement-workbench-format';

/**
 * DIÁLOGOS DE COMANDO DA MEDIÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * NÃO SÃO FORMULÁRIOS DE EDIÇÃO
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Cada diálogo apresenta: o objeto, o que muda, o impacto e o motivo obrigatório
 * quando ele é exigido. O operador confirma uma DECISÃO, não ajusta um campo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE ESTES DIÁLOGOS RESPEITAM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A habilitação vem de `availableCommands[].enabled`. O diálogo NÃO recalcula
 * elegibilidade, NÃO compara variação com tolerância e NÃO decide se o aceite é
 * exigível — ele declara o que o backend disse e coleta o que o comando precisa.
 *
 * Um diálogo que reimplementasse a regra habilitaria o botão quando o backend
 * fosse recusar — o defeito que esta capability eliminou.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ACEITE DO CLIENTE
// ═══════════════════════════════════════════════════════════════════════════════

export type AcceptanceDialogMode = 'accept' | 'reject';

export function MeasurementAcceptanceDialog({
  open,
  mode,
  workbench,
  submitting,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  mode: AcceptanceDialogMode;
  workbench: MeasurementWorkbenchReadModel;
  submitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (input: {
    observation: string;
    rejectionReason: string | null;
    customerSignerName: string | null;
  }) => void;
}) {
  const [observation, setObservation] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [customerSignerName, setCustomerSignerName] = useState('');
  const observationId = useId();
  const reasonId = useId();
  const signerId = useId();

  useEffect(() => {
    if (!open) {
      setObservation('');
      setRejectionReason('');
      setCustomerSignerName('');
    }
  }, [open]);

  const accepting = mode === 'accept';
  const amount = formatMoney(
    workbench.economics.grossValue,
    workbench.economics.currency,
  );

  /*
   * O MOTIVO É OBRIGATÓRIO NA RECUSA — e a regra é do DOMÍNIO.
   *
   * Aqui só se impede o envio de um comando que o backend recusaria por falta de
   * motivo: é validação de FORMULÁRIO (campo obrigatório vazio), não regra de
   * negócio. O backend valida de novo, com código próprio.
   */
  const confirmDisabled =
    submitting ||
    observation.trim().length === 0 ||
    (!accepting && rejectionReason.trim().length === 0);

  return (
    <ConfirmDialog
      open={open}
      title={accepting ? 'Registrar aceite do cliente' : 'Registrar recusa do cliente'}
      description={
        accepting
          ? 'O aceite fecha o ciclo de aceite desta entrega e é registrado como fato imutável.'
          : 'A recusa encerra o ciclo como RECUSADO e abre trabalho de correção. A decisão anterior não é apagada.'
      }
      confirmLabel={submitting ? 'Registrando…' : accepting ? 'Registrar aceite' : 'Registrar recusa'}
      cancelLabel="Voltar"
      confirmDisabled={confirmDisabled}
      onCancel={onCancel}
      onConfirm={() =>
        onConfirm({
          observation: observation.trim(),
          rejectionReason: accepting ? null : rejectionReason.trim(),
          customerSignerName: customerSignerName.trim() || null,
        })
      }
    >
      <div className="space-y-2 text-xs">
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
          <Fact label="Cliente" value={workbench.businessContext.customer ?? '—'} />
          <Fact label="Medição" value={workbench.identity.number ?? workbench.identity.orderNumber} />
          <Fact label="Valor" value={amount ?? 'não apurado'} />
          <Fact label="Ciclo" value={String(workbench.acceptance.latest?.cycleNumber ?? 1)} />
        </dl>

        <label htmlFor={observationId} className="block">
          <span className="text-[11px] font-medium text-gray-700">
            Observação <span aria-hidden="true">*</span>
          </span>
          <textarea
            id={observationId}
            className="mt-0.5 w-full rounded border border-gray-300 p-1 text-xs"
            rows={3}
            required
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
          />
        </label>

        {!accepting ? (
          <label htmlFor={reasonId} className="block">
            <span className="text-[11px] font-medium text-gray-700">
              Motivo da recusa <span aria-hidden="true">*</span>
            </span>
            <textarea
              id={reasonId}
              className="mt-0.5 w-full rounded border border-gray-300 p-1 text-xs"
              rows={2}
              required
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </label>
        ) : null}

        <label htmlFor={signerId} className="block">
          <span className="text-[11px] font-medium text-gray-700">Quem assinou pelo cliente</span>
          <input
            id={signerId}
            type="text"
            className="mt-0.5 w-full rounded border border-gray-300 p-1 text-xs"
            value={customerSignerName}
            onChange={(event) => setCustomerSignerName(event.target.value)}
          />
        </label>

        <CommandImpactList code={accepting ? 'RECORD_ACCEPTANCE' : 'RECORD_REJECTION'} />

        {errorMessage ? (
          <p role="alert" className="m-0 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-[10px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="m-0 truncate font-medium text-gray-900">{value}</dd>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTORIZAÇÃO DE AJUSTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AUTORIZAÇÃO DE AJUSTE — a DECISÃO sobre uma variação.
 *
 * O diálogo mostra o desvio COMPLETO (as três quantidades, o delta, o
 * percentual, a tolerância com sua fonte, o impacto financeiro) e exige o
 * MOTIVO. É isso que torna o ajuste auditável: sem motivo, ele é uma edição de
 * campo com carimbo de data.
 *
 * O `variance` recebido já veio do backend com severidade, tolerância e
 * recomendação decididas. O diálogo não as recalcula.
 */
export function MeasurementAdjustmentDialog({
  open,
  variance,
  workbench,
  submitting,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  variance: DetectedVariance | null;
  workbench: MeasurementWorkbenchReadModel;
  submitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (input: { adjustmentQuantity: string; reason: string }) => void;
}) {
  const [reason, setReason] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const reasonId = useId();
  const quantityId = useId();

  useEffect(() => {
    if (!open) {
      setReason('');
      setAdjustmentQuantity('');
    } else if (variance) {
      // A sugestão é o DELTA que o backend já calculou — não uma conta nova.
      setAdjustmentQuantity(variance.absoluteDelta);
    }
  }, [open, variance]);

  if (!variance) {
    return null;
  }

  const confirmDisabled =
    submitting || reason.trim().length === 0 || adjustmentQuantity.trim().length === 0;

  return (
    <ConfirmDialog
      open={open}
      title="Autorizar ajuste de medição"
      description="O ajuste é uma decisão registrada com motivo, autor e impacto financeiro. Ele não altera o realizado."
      confirmLabel={submitting ? 'Autorizando…' : 'Autorizar ajuste'}
      cancelLabel="Cancelar"
      confirmDisabled={confirmDisabled}
      onCancel={onCancel}
      onConfirm={() =>
        onConfirm({ adjustmentQuantity: adjustmentQuantity.trim(), reason: reason.trim() })
      }
    >
      <div className="space-y-2 text-xs">
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
          <Fact label="Medição" value={workbench.identity.number ?? workbench.identity.orderNumber} />
          <Fact label="Dimensão" value={variance.dimensionKey} />
          <Fact label="Planejado" value={formatQuantity(variance.plannedValue) ?? '—'} />
          <Fact label="Realizado" value={formatQuantity(variance.actualValue) ?? '—'} />
          <Fact label="Medido" value={formatQuantity(variance.measuredValue) ?? '—'} />
          <Fact label="Delta" value={formatQuantity(variance.absoluteDelta) ?? '—'} />
          <Fact
            label="Variação"
            value={formatSignedPercent(variance.percentageDelta) ?? 'sem base'}
          />
          <Fact
            label="Tolerância"
            value={toleranceText(variance.tolerancePercentage, variance.toleranceSource)}
          />
          <Fact
            label="Impacto financeiro"
            value={formatMoney(variance.financialImpact, variance.currencyCode) ?? 'não apurável'}
          />
          <Fact label="Severidade" value={stateLabel(variance.severity) ?? variance.severity} />
        </dl>

        <p className="m-0 rounded bg-gray-50 px-2 py-1 text-[11px] leading-snug text-gray-700">
          {variance.explanation}
        </p>

        <label htmlFor={quantityId} className="block">
          <span className="text-[11px] font-medium text-gray-700">
            Quantidade de ajuste ({variance.unitOfMeasure ?? variance.dimensionKey})
          </span>
          <input
            id={quantityId}
            type="text"
            inputMode="decimal"
            className="mt-0.5 w-full rounded border border-gray-300 p-1 text-xs tabular-nums"
            value={adjustmentQuantity}
            onChange={(event) => setAdjustmentQuantity(event.target.value)}
          />
        </label>

        <label htmlFor={reasonId} className="block">
          <span className="text-[11px] font-medium text-gray-700">
            Motivo da decisão <span aria-hidden="true">*</span>
          </span>
          <textarea
            id={reasonId}
            className="mt-0.5 w-full rounded border border-gray-300 p-1 text-xs"
            rows={3}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <CommandImpactList code="AUTHORIZE_ADJUSTMENT" />

        {errorMessage ? (
          <p role="alert" className="m-0 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFLITO DE VERSÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BANNER DE CONCORRÊNCIA.
 *
 * 409 NUNCA é "tente novamente em silêncio". Dois operadores editaram a mesma
 * medição; aplicar o comando por cima do trabalho do outro é last-write-wins — o
 * defeito que a concorrência otimista existe para impedir.
 *
 * A tela informa as VERSÕES e oferece RECARREGAR. Ela não reenvia sozinha.
 */
export function MeasurementConcurrencyBanner({
  open,
  expectedVersion,
  submitting,
  onReload,
}: {
  open: boolean;
  expectedVersion: number | null;
  submitting: boolean;
  onReload: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      containerRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      role="alert"
      tabIndex={-1}
      className="mb-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2"
    >
      <p className="m-0 text-xs font-semibold text-amber-900">A medição foi alterada</p>
      <p className="m-0 mt-0.5 text-[11px] text-amber-900">
        Outra operação alterou este registro
        {expectedVersion !== null ? ` (sua versão: ${expectedVersion})` : ''}. Recarregue o estado
        atual antes de decidir — o comando não é reaplicado automaticamente.
      </p>
      <button
        type="button"
        onClick={onReload}
        disabled={submitting}
        className="mt-1 rounded bg-amber-700 px-2 py-1 text-[11px] font-medium text-white"
      >
        Recarregar estado atual
      </button>
    </div>
  );
}
