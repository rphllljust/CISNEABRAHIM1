import { VERSION_STATUSES, type VersionStatus } from '../types/service-catalog.types';

type VersionStatusBadgeProps = {
  status: VersionStatus;
};

/**
 * ROTULOS DO CICLO DA VERSAO — a UNICA traducao deste enum.
 *
 * Exportado porque o cabecalho da object page passou a exibir o estado ao lado da identidade.
 * `Record<VersionStatus, string>` e exaustivo por tipo: acrescentar estado sem rotulo quebra
 * a compilacao em vez de vazar o identificador interno na tela.
 */
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  [VERSION_STATUSES.Draft]: 'Rascunho',
  [VERSION_STATUSES.Published]: 'Publicada',
  [VERSION_STATUSES.Retired]: 'Aposentada',
};

export function VersionStatusBadge({ status }: VersionStatusBadgeProps) {
  const className = `catalog-version-status catalog-version-status--${status.toLowerCase()}`;
  return (
    <span className={className} aria-label={`Status da versão: ${VERSION_STATUS_LABELS[status]}`}>
      {VERSION_STATUS_LABELS[status]}
    </span>
  );
}
