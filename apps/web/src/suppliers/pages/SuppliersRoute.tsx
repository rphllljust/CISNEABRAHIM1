import type { ReactNode } from 'react';
import { BackofficeCapabilityRoute } from '../../financial-ui/BackofficeCapabilityRoute';
import { probeSupplierListAccess } from '../api/suppliers-api';

/**
 * Gate de acesso do módulo de fornecedores.
 *
 * Vive em arquivo próprio desde a migração para a engine: antes estava dentro de
 * `SuppliersPage.tsx`, que foi DELETADO. O gate NÃO é JSX artesanal de entidade — é a
 * checagem de concessão do módulo, e continua valendo para as telas renderizadas pela engine.
 *
 * A concessão exigida é a de LISTA: sem ela o ator não entra em nenhuma rota de fornecedor,
 * e a navegação por lista continua sendo o caminho de entrada — não um identificador digitado.
 */
export function SuppliersRoute({ children }: { children: ReactNode }) {
  return (
    <BackofficeCapabilityRoute probe={probeSupplierListAccess} capabilityId="suppliers:supplier:list">
      {children}
    </BackofficeCapabilityRoute>
  );
}
