import { useOperationalUnits, type OperationalUnitOption } from '../../shell/hooks/useOperationalUnits';

/**
 * Unidades operacionais disponiveis para o usuario autenticado. Delegacao para o hook
 * compartilhado do shell, preservando o nome usado pelo modulo fiscal.
 *
 * `options` e repassado porque as superficies fiscais passaram a renderizar o escopo pelo
 * primitivo compartilhado `OperationalUnitOptions` — o mesmo das demais familias — em vez de
 * montar um ordinal `Unidade N` a mao. O valor enviado a API nao muda.
 */
export function useFiscalUnits(): {
  units: string[];
  options: OperationalUnitOption[];
  unitId: string;
  setUnitId: (value: string) => void;
} {
  return useOperationalUnits();
}
