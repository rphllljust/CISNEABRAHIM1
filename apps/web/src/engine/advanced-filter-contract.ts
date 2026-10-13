import type { FilterGroup } from '../engine';

/**
 * CONVERSOR DA ÁRVORE DA ENGINE PARA O CONTRATO SERVER-SIDE DE FILTRO AVANÇADO.
 *
 * Uma única conversão serve TODAS as entidades governadas por metadado. O que muda entre módulos é
 * apenas o MAPA: nomes de campo da entidade → nomes aceitos pelo predicado do servidor, e o
 * conjunto de operadores que o contrato daquele domínio executa. A FORMA do payload é a mesma em
 * todo lugar (`{ connector, groups: [{ conditions: [{ field, operator, value }] }] }`), e é isso que
 * permite ao backend publicar um contrato uniforme sem que cada tela invente o seu.
 *
 * REGRA DE DESCARTE — a decisão central deste módulo.
 *
 * A engine oferece dez operadores porque serve qualquer entidade; cada domínio executa um
 * subconjunto. Operador sem equivalente é DESCARTADO, nunca aproximado. Aproximar `in` de `eq`
 * inventaria semântica sobre o domínio, e enviá-lo produziria 400 — nos dois casos o operador
 * acreditaria num recorte que o servidor não aplicou. Descartar mantém a tela honesta: ela mostra
 * exatamente o que o servidor vai executar.
 *
 * A mesma regra vale para campo fora do allow-list: não viaja. O backend recusaria com 400, e o
 * frontend nem tenta.
 */

export type AdvancedFilterCondition = {
  field: string;
  operator: string;
  value: string;
};

export type AdvancedFilterPayload = {
  connector: 'AND' | 'OR';
  groups: Array<{ conditions: AdvancedFilterCondition[] }>;
};

/**
 * Operadores da engine para operadores de contrato, por FAMÍLIA de tipo.
 *
 * Texto não recebe ordem (`>`/`<`) e data não recebe `contains`: a mesma decisão que
 * `operatorsForType` já toma na UI, repetida aqui porque o servidor valida por conta própria e o
 * frontend precisa concordar com ele.
 */
export const TEXT_OPERATOR_MAP: Record<string, string> = {
  '=': 'eq',
  '!=': 'neq',
  contains: 'contains',
};

export const DATE_OPERATOR_MAP: Record<string, string> = {
  '>': 'after',
  '>=': 'after',
  '<': 'before',
  '<=': 'before',
  '=': 'eq',
  '!=': 'neq',
};

export const ENUM_OPERATOR_MAP: Record<string, string> = {
  '=': 'eq',
  '!=': 'neq',
};

export type AdvancedFilterFieldSpec = {
  /** Nome do campo no metadado da entidade. */
  field: string;
  /** Nome do campo no contrato do servidor. */
  contractField: string;
  /** Família de operadores que o contrato executa para este campo. */
  kind: 'text' | 'date' | 'enum';
};

/**
 * Converte a árvore da engine no payload do contrato.
 *
 * Subgrupos são ACHATADOS no grupo pai com a MESMA conjunção — achatamento conservador e
 * declarado: o contrato aceita um nível (grupos com conjunção interna, ligados pelo `connector`), e
 * `(A e B) ou C` continua expressável no nível de cima. Aninhamento mais profundo perde a estrutura
 * em vez de ser silenciosamente invertido.
 */
export function advancedFilterFromGroup(
  group: FilterGroup,
  specs: readonly AdvancedFilterFieldSpec[],
): AdvancedFilterPayload | null {
  const byField = new Map(specs.map((spec) => [spec.field, spec]));
  const conditions: AdvancedFilterCondition[] = [];

  const collect = (current: FilterGroup): void => {
    for (const rule of current.rules) {
      const spec = byField.get(rule.field);
      if (!spec) {
        continue;
      }
      const map =
        spec.kind === 'date'
          ? DATE_OPERATOR_MAP
          : spec.kind === 'enum'
            ? ENUM_OPERATOR_MAP
            : TEXT_OPERATOR_MAP;
      const operator = map[rule.op];
      if (!operator) {
        continue;
      }
      const value = rule.value.trim();
      if (value === '') {
        continue;
      }
      conditions.push({ field: spec.contractField, operator, value });
    }
    for (const child of current.groups ?? []) {
      collect(child);
    }
  };

  collect(group);

  if (conditions.length === 0) {
    return null;
  }
  return { connector: group.op, groups: [{ conditions }] };
}
