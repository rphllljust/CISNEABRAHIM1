import { CATALOG_LINEAGE_STATUSES, type CatalogLineageStatus } from '../types/service-catalog.types';

type ServiceDefinitionStatusBadgeProps = {
  status: CatalogLineageStatus;
};

/**
 * ROTULO DE CICLO DA DEFINICAO — a UNICA traducao deste enum.
 *
 * Exportado porque o cabecalho da object page passou a exibir o estado ao lado da identidade.
 * Duas traducoes para o mesmo enum divergem na primeira mudanca de rotulo; uma so, nao.
 */
export function serviceDefinitionStatusLabel(status: CatalogLineageStatus): string {
  return status === CATALOG_LINEAGE_STATUSES.Active ? 'Ativo' : 'Inativo';
}

export function ServiceDefinitionStatusBadge({ status }: ServiceDefinitionStatusBadgeProps) {
  const label = serviceDefinitionStatusLabel(status);
  const className =
    status === CATALOG_LINEAGE_STATUSES.Active
      ? 'catalog-status catalog-status--active'
      : 'catalog-status catalog-status--inactive';

  return (
    <span className={className} aria-label={`Status da definição: ${label}`}>
      {label}
    </span>
  );
}
