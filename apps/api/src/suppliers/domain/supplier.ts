export const SUPPLIER_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
  /**
   * ARQUIVADO (Fase B): estado terminal do fornecedor. Diferente de INATIVO, que é reversível:
   * um fornecedor arquivado saiu do cadastro vivo e só volta por `activate`, que é a porta
   * explícita de retorno. O valor é NOVO nesta sessão e exige migration (o enum do banco só
   * tinha ACTIVE/INACTIVE).
   */
  Archived: 'ARCHIVED',
} as const;

export type SupplierStatus = (typeof SUPPLIER_STATUSES)[keyof typeof SUPPLIER_STATUSES];

export const SUPPLIER_HISTORY_KINDS = {
  Created: 'CREATED',
  Updated: 'UPDATED',
  Deactivated: 'DEACTIVATED',
  Activated: 'ACTIVATED',
  Archived: 'ARCHIVED',
} as const;

export class SupplierError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function assertSupplierActive(status: string): void {
  if (status !== SUPPLIER_STATUSES.Active) {
    throw new SupplierError('SUPPLIER_INACTIVE');
  }
}
