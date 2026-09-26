import { useEffect, useState } from 'react';
import { listOperationalUnits } from '../../requests/api/service-requests-api';

/**
 * Unidades operacionais visiveis para o usuario autenticado. Fonte unica ja existente em
 * Requests; usada pelos filtros e formularios dos modulos de backoffice (fiscal e
 * contabilidade) para que o operador escolha a unidade por codigo legivel em vez de digitar
 * um identificador livre. Consumo puro: nenhuma regra de autorizacao e decidida aqui — a
 * consulta de cada modulo continua sendo autorizada no servidor.
 */
export function useOperationalUnits(): {
  units: string[];
  unitId: string;
  setUnitId: (value: string) => void;
} {
  const [units, setUnits] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void listOperationalUnits(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setUnits(response.items);
        setUnitId((current) => current || response.items[0] || '');
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return { units, unitId, setUnitId };
}
