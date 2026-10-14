import { MEASUREMENT_STATUSES, type MeasurementStatus } from '../types/measurement.types';

/**
 * RÓTULOS DO CICLO DE MEDIÇÃO — a ÚNICA tabela de tradução deste enum.
 *
 * Exportada porque a ficha de medição passou a exibir o estado no cabeçalho padrão
 * (`EnterpriseObjectHeader`), e não mais pelo `MeasurementStatusBadge`. Duas tabelas de
 * tradução para o mesmo enum divergem na primeira mudança de rótulo; uma só, não.
 *
 * `Record<MeasurementStatus, string>` é exaustivo por tipo: acrescentar um estado ao enum
 * sem dar-lhe rótulo quebra a compilação, em vez de vazar o identificador interno na tela.
 */
export const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = {
  [MEASUREMENT_STATUSES.Draft]: 'Rascunho',
  [MEASUREMENT_STATUSES.Submitted]: 'Submetida',
  [MEASUREMENT_STATUSES.UnderReview]: 'Em análise',
  [MEASUREMENT_STATUSES.Approved]: 'Aprovada',
  [MEASUREMENT_STATUSES.Rejected]: 'Rejeitada',
};

type MeasurementStatusBadgeProps = {
  status: MeasurementStatus;
};

export function MeasurementStatusBadge({ status }: MeasurementStatusBadgeProps) {
  const modifier = status.toLowerCase().replace(/_/g, '-');
  return (
    <span className={`measurement-status measurement-status--${modifier}`}>
      <span className="measurement-sr-only">Status da medição:</span>
      {MEASUREMENT_STATUS_LABELS[status]}
    </span>
  );
}
