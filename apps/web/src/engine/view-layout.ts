/**
 * VIEWS COMO DADOS — leitura do layout declarado no metadata store.
 *
 * A tese desta camada: uma view NÃO é um componente React. É um REGISTRO em `meta.views`
 * cujo `layout` (JSONB) diz o que desenhar. O componente é o RENDERIZADOR de um `view_type`;
 * o layout é o CONTEÚDO. Trocar o conteúdo é um UPDATE, não um deploy.
 *
 * Consequência prática, e é isso que os E2E provam: mudar `layout.dateField` via SQL muda a
 * coluna que o calendário usa, sem tocar em uma linha de TypeScript.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE A LEITURA É DEFENSIVA
 *
 * O `layout` chega como `Record<string, unknown>` de um banco que qualquer administrador
 * pode editar. Um layout malformado NÃO pode derrubar a tela: cada leitor abaixo valida a
 * forma, aplica o default declarado e segue. Layout torto produz uma view DEGRADADA e
 * EXPLICADA, nunca uma tela em branco — uma tela em branco o operador lê como "não há dado",
 * que é uma mentira cara num ERP.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * NOMES DE CAMPO VÊM DO METADADO, NÃO DO BANCO
 *
 * Um `dateField` que não existe em `schema.fields` é um erro de configuração, e a engine o
 * trata como tal: `resolveViewField` devolve `null` e o renderizador mostra o campo
 * esperado em vez de renderizar uma coluna vazia. Isso transforma "a tela está estranha" em
 * "o metadado aponta para um campo que não existe" — diagnosticável sem abrir o código.
 */

import type { MetaEntitySchema, MetaField, MetaView } from './types';

/** O layout é JSON livre por contrato; estes são os leitores que o interpretam. */
export type ViewLayout = Record<string, unknown>;

/** Resultado de resolver um nome de campo declarado no layout. */
export type ResolvedViewField = {
  name: string;
  field: MetaField | null;
  /** `true` quando o layout aponta para um campo que o schema não conhece. */
  missing: boolean;
};

/**
 * Escolhe a view de um tipo no schema.
 *
 * Um tipo pode ter mais de uma view declarada (o store não impõe unicidade por tipo), e a
 * `isDefault` desempata — é para isso que ela existe. Sem nenhuma default, vale a primeira
 * na ordem do servidor, que é estável (`ORDER BY view_type`).
 */
export function findView(schema: MetaEntitySchema, viewType: string): MetaView | null {
  const candidates = schema.views.filter((view) => view.viewType === viewType);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.find((view) => view.isDefault) ?? candidates[0] ?? null;
}

/** Layout da view, ou `null` quando a view não existe no store. */
export function readLayout(schema: MetaEntitySchema, viewType: string): ViewLayout | null {
  const view = findView(schema, viewType);
  if (!view || typeof view.layout !== 'object' || view.layout === null) {
    return null;
  }
  return view.layout as ViewLayout;
}

/**
 * Lê uma chave de layout como nome de campo não vazio.
 *
 * Devolve `null` para ausente, tipo errado ou string em branco — os três são "não
 * declarado", e tratá-los igual evita que `"  "` vire uma coluna sem título.
 */
export function readFieldName(layout: ViewLayout | null, key: string): string | null {
  if (!layout) {
    return null;
  }
  const value = layout[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

/**
 * Lê uma chave de layout como lista de nomes de campo.
 *
 * Entradas não-string são descartadas individualmente em vez de invalidar a lista inteira:
 * uma lista com um item torto ainda tem itens bons.
 */
export function readFieldList(layout: ViewLayout | null, key: string): string[] {
  if (!layout) {
    return [];
  }
  const value = layout[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Lê uma chave de layout como string qualquer (não necessariamente um campo). */
export function readString(layout: ViewLayout | null, key: string): string | null {
  if (!layout) {
    return null;
  }
  const value = layout[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

/** Lê uma chave de layout como booleano, com default explícito. */
export function readBoolean(layout: ViewLayout | null, key: string, fallback: boolean): boolean {
  if (!layout) {
    return fallback;
  }
  const value = layout[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Lê um nome de campo do layout e o resolve contra o schema.
 *
 * O par (nome declarado, campo real) é o que permite o renderizador distinguir "o
 * administrador não configurou esta coluna" de "configurou errado". As duas situações
 * exigem mensagens diferentes.
 */
export function resolveViewField(
  schema: MetaEntitySchema,
  layout: ViewLayout | null,
  key: string,
): ResolvedViewField | null {
  const name = readFieldName(layout, key);
  if (!name) {
    return null;
  }
  const field = schema.fields.find((candidate) => candidate.name === name) ?? null;
  return { name, field, missing: field === null };
}

/**
 * Resolve uma lista de campos do layout contra o schema.
 *
 * Campos desconhecidos são PRESERVADOS com `mostra ausente` implícita via `field: null`:
 * quem chama decide se avisa ou silencia, mas a informação não é perdida no caminho.
 */
export function resolveViewFieldList(
  schema: MetaEntitySchema,
  layout: ViewLayout | null,
  key: string,
): ResolvedViewField[] {
  return readFieldList(layout, key).map((name) => {
    const field = schema.fields.find((candidate) => candidate.name === name) ?? null;
    return { name, field, missing: field === null };
  });
}

/**
 * Campos que a engine pode oferecer como escolha num seletor.
 *
 * Exclui `readOnly` (um campo somente-leitura não pertence a uma tela de edição) e os de
 * nível acima do ator — que o servidor já filtrou, mas a checagem aqui evita que um schema
 * vindo de cache antigo reintroduza um campo que o ator perdeu o direito de ver.
 */
export function selectableFields(schema: MetaEntitySchema): MetaField[] {
  return schema.fields.filter(
    (field) => !field.readOnly && schema.allowedPermLevels.includes(field.permLevel),
  );
}

/** Rótulo de um campo resolvido, caindo no próprio nome quando o metadado não o tem. */
export function fieldLabel(resolved: ResolvedViewField): string {
  return resolved.field?.label ?? resolved.name;
}
