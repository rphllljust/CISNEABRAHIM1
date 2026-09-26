import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';

/**
 * Unidades operacionais disponiveis para o usuario autenticado. Delegacao para o hook
 * compartilhado do shell, preservando o nome usado pelo modulo fiscal.
 */
export function useFiscalUnits(): {
  units: string[];
  unitId: string;
  setUnitId: (value: string) => void;
} {
  return useOperationalUnits();
}
