import { useEffect, useState } from 'react';
import { listOperationalUnits } from '../../requests/api/service-requests-api';

/**
 * Unidades operacionais visiveis para o usuario autenticado.
 *
 * PARK_API_GAP — o contrato de `/requests/service-requests/operational-units` publica
 * `{"items": ["UN-DEV-001", "unit-synthetic-homolog"]}`: identificadores internos, SEM nome
 * humano. Em HML isso e um slug de ambiente somado a um codigo tecnico. Nenhum rotulo e
 * inventado aqui — fabricar "Unidade 1 — Porto Velho" seria pior que o codigo, porque afirmaria
 * um nome que nao existe no ERP.
 *
 * O que a superficie pode fazer honestamente e NAO repetir o identificador cru como se fosse um
 * nome. O filtro declara o ESCOPO e mantem o valor real no `value` do controle, que e o que a
 * consulta autorizada envia. Quando o backend publicar o nome, basta trocar `label`.
 */
export type OperationalUnitOption = {
  /** Valor enviado a API — identificador real, nunca exibido como se fosse nome. */
  value: string;
  /** Rotulo exibido. Hoje derivado do escopo; amanha, o nome publicado pelo backend. */
  label: string;
};

export function useOperationalUnits(): {
  units: string[];
  options: OperationalUnitOption[];
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

  const options: OperationalUnitOption[] = units.map((value, index) => ({
    value,
    label: units.length === 1 ? 'Unidade autorizada' : `Unidade autorizada ${index + 1}`,
  }));

  return { units, options, unitId, setUnitId };
}

/**
 * OPCOES DE UNIDADE para `<select>` — um unico lugar decide como a unidade aparece.
 *
 * Ate aqui cada tela montava `units.map((unit) => <option key={unit} value={unit}>{unit}</option>)`,
 * o que colocava o identificador interno (`unit-synthetic-homolog`) na cara do operador em doze
 * superficies de backoffice. Centralizar aqui evita que a proxima tela repita o erro e faz a
 * correcao valer para todas as que ja existem.
 */
export function OperationalUnitOptions({
  options,
  includeAllLabel,
}: {
  options: OperationalUnitOption[];
  /** Quando informado, adiciona a opcao "todas" com o rotulo dado. */
  includeAllLabel?: string;
}) {
  if (options.length === 0) {
    return <option value="">Nenhuma unidade autorizada</option>;
  }
  return (
    <>
      {includeAllLabel ? <option value="">{includeAllLabel}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

/** Rotulo humano da unidade selecionada; nunca o identificador interno. */
export function operationalUnitLabel(
  options: OperationalUnitOption[],
  unitId: string,
  fallback = 'Unidade autorizada',
): string {
  return options.find((option) => option.value === unitId)?.label ?? fallback;
}
