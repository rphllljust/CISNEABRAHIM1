import { useMemo } from 'react';
import { t } from '../i18n';
import { toDisplayText } from './FieldRenderer';
import { applyAggregation, formatAggregate, readAggregation } from './metadata-v2';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * SUBFORMULÁRIO — linhas filhas editáveis DENTRO do formulário do pai.
 *
 * Espelha o que os três ERPs de referência já resolveram, e não inventa gramática nova:
 *
 *   Odoo        — One2Many inline (`<field name="line_ids"><tree editable="bottom">`): o filho
 *                 é uma TABELA editável embutida no form do pai, com add/remove por linha e o
 *                 `parentField` implícito que o ORM preenche na gravação.
 *   ERPNext     — Table field / DocType filho: o `istable: 1` do DocType filho rende um grid
 *                 no form do pai, com `in_list_view` decidindo as colunas e a FK do pai
 *                 preenchida pelo framework.
 *   iDempiere   — AD_Tab filho (Tab Level > 0) com grid editável: as colunas vêm do Application
 *                 Dictionary e o vínculo com o pai é o `AD_Column` de link.
 *
 * O CONTRATO COMUM AOS TRÊS, e é o que esta engine implementa: as colunas NÃO são escritas
 * aqui — vêm do schema do FILHO; o vínculo com o pai NÃO é digitado pelo operador — é o
 * `parentField`, aplicado pela tela na gravação; as ações são exatamente TRÊS (adicionar linha,
 * remover linha, editar célula), e o rodapé totaliza o que o metadado declarar agregável.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE `onChange` A CADA TECLA, E NÃO UM "SALVAR" DO SUBFORM
 *
 * O Odoo só grava no save do pai; o ERPNext tem `onchange` por célula; o iDempiere grava no
 * save do registro. Nenhum dos três mantém um estado de rascunho SEPARADO do formulário — a
 * linha editada É o valor do pai. Reproduzir isso aqui significa que a engine não guarda cópia:
 * ela emite a lista inteira a cada edição e a TELA decide quando persistir. Guardar um buffer
 * interno criaria duas verdades sobre a mesma linha, e a divergência entre elas é justamente o
 * defeito que o "dirty state complexo" produz num ERP.
 */

/** Linha filha. O `id` é do cliente quando a linha é nova e ainda não existe no servidor. */
export type SubformRow = Record<string, unknown> & { id: string };

export type DynamicSubformProps = {
  /**
   * Schema do FILHO — não do pai.
   *
   * `null` é aceito pela mesma razão do `DynamicList`: enquanto o metadado não chega não há
   * coluna para desenhar, e derrubar a árvore por um atraso de rede que a tela não controla
   * seria trocar um grid vazio por uma tela em branco.
   */
  schema: MetaEntitySchema | null;
  rows: SubformRow[];
  /** Emitido a cada add/remove/edição, com a lista COMPLETA. */
  onChange: (rows: SubformRow[]) => void;
  /**
   * FK que aponta para o pai.
   *
   * Não é renderizada como coluna editável: nos três ERPs o vínculo é preenchido pelo
   * framework na gravação, e deixar o operador digitá-lo é como um ERP produz órfão.
   */
  parentField?: string;
  /** Id do pai, gravado nas linhas emitidas em `parentField`. */
  parentId?: string;
  readOnly?: boolean;
  /** Rótulo da seção. Sem ele, usa o rótulo do schema filho. */
  title?: string;
};

export function DynamicSubform({
  schema,
  rows,
  onChange,
  parentField,
  parentId,
  readOnly = false,
  title,
}: DynamicSubformProps): React.ReactElement {
  const columns = useSubformColumns(schema);
  const locked = readOnly || !schema;

  const totals = useMemo(
    () => buildSubformTotals(columns, rows),
    [columns, rows],
  );

  if (!schema) {
    return (
      <p className="text-sm text-gray-600" data-testid="dynamic-subform-awaiting-schema" aria-busy="true">
        {t('common.loading')}
      </p>
    );
  }

  /** Nova linha: só o `id` do cliente e a FK do pai. Campo obrigatório vazio é o estado inicial
   *  correto — preenchê-lo com um default inventaria dado empresarial. */
  const addRow = (): void => {
    const id = newClientRowId();
    onChange([...rows, stampParent({ id }, parentField, parentId)]);
  };

  const removeRow = (id: string): void => {
    onChange(rows.filter((row) => row.id !== id));
  };

  const editCell = (id: string, field: string, value: unknown): void => {
    onChange(
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const totalColumns = columns.length + (locked ? 0 : 1);

  return (
    <section data-testid="dynamic-subform" data-entity={schema.name} data-row-count={String(rows.length)}>
      <div className="mb-2 flex items-end justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title ?? schema.label}</h3>
        {!locked ? (
          <button
            type="button"
            data-testid="dynamic-subform-add"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            onClick={addRow}
          >
            {t('subform.addLine')}
          </button>
        ) : null}
      </div>

      <table className="w-full text-sm" aria-label={schema.label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.name}
                scope="col"
                className="border-b border-gray-200 px-2 py-1.5 text-left text-xs font-semibold text-gray-600"
              >
                {column.label}
                {column.required ? ' *' : ''}
              </th>
            ))}
            {!locked ? (
              <th scope="col" className="w-20 border-b border-gray-200 px-2 py-1.5 text-right text-xs font-semibold text-gray-600">
                {t('common.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={totalColumns} className="px-2 py-3 text-gray-500">
                {t('subform.empty')}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={row.id} data-testid="dynamic-subform-row" data-row-id={row.id}>
                {columns.map((column) => (
                  <td key={column.name} className="border-b border-gray-100 px-1 py-1">
                    <SubformCell
                      field={column}
                      rowId={row.id}
                      rowIndex={index}
                      value={row[column.name]}
                      readOnly={readOnly || column.readOnly}
                      onChange={editCell}
                    />
                  </td>
                ))}
                {!locked ? (
                  <td className="border-b border-gray-100 px-2 py-1 text-right">
                    <button
                      type="button"
                      data-testid="dynamic-subform-remove"
                      data-row-id={row.id}
                      aria-label={`${t('subform.removeLine')} ${index + 1}`}
                      className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      onClick={() => removeRow(row.id)}
                    >
                      {t('subform.removeLine')}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
        {totals.length > 0 ? (
          <tfoot>
            <tr data-testid="dynamic-subform-totals">
              {columns.map((column, index) => (
                <td
                  key={column.name}
                  data-total-field={column.name}
                  className="border-t border-gray-300 px-2 py-1.5 text-xs font-semibold tabular-nums"
                >
                  {index === 0 ? (
                    <span data-testid="dynamic-subform-total-count">
                      {rows.length} {t('subform.lineCount').toLowerCase()}
                    </span>
                  ) : null}
                  {subformTotalLabel(column, totals)}
                </td>
              ))}
              {!locked ? <td className="border-t border-gray-300" /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </section>
  );
}

/**
 * Uma célula editável. O controle segue o TIPO do metadado — mesmo mapa de `DynamicForm`.
 *
 * `link` sai como texto porque a engine não resolve a entidade apontada aqui: um seletor de
 * registro relacionado exige uma consulta que a linha do grid não tem como fazer sozinha. O
 * Odoo resolve isso com um many2one widget que busca no servidor; enquanto esta engine não tem
 * esse widget, o campo continua EDITÁVEL como identificador — pior seria um dropdown vazio que
 * finge ser um seletor.
 */
function SubformCell({
  field,
  rowId,
  rowIndex,
  value,
  readOnly,
  onChange,
}: {
  field: MetaField;
  rowId: string;
  rowIndex: number;
  value: unknown;
  readOnly: boolean;
  onChange: (rowId: string, field: string, value: unknown) => void;
}): React.ReactElement {
  // O nome acessível é a COLUNA + a LINHA: sem o índice, três linhas produzem três controles
  // idênticos para o leitor de tela — e para o localizador de teste.
  const label = `${field.label} ${t('subform.line')} ${rowIndex + 1}`;
  const common = {
    'data-subform-field': field.name,
    'data-row-id': rowId,
    'aria-label': label,
    disabled: readOnly,
    className:
      'w-full min-w-24 rounded border border-gray-300 px-1.5 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-600',
  } as const;

  if (field.type === 'select') {
    return (
      <select
        {...common}
        data-field-type="select"
        value={toDisplayText(value)}
        onChange={(event) => onChange(rowId, field.name, event.target.value)}
      >
        <option value="">—</option>
        {(field.options?.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'bool') {
    return (
      <input
        {...common}
        type="checkbox"
        data-field-type="bool"
        checked={value === true}
        onChange={(event) => onChange(rowId, field.name, event.target.checked)}
      />
    );
  }

  const inputType =
    field.type === 'currency' || field.type === 'integer'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'datetime'
          ? 'datetime-local'
          : 'text';

  return (
    <input
      {...common}
      type={inputType}
      data-field-type={field.type}
      value={toDisplayText(value)}
      onChange={(event) => onChange(rowId, field.name, event.target.value)}
    />
  );
}

/**
 * Colunas do subformulário, na ordem derivada da view `list` do FILHO.
 *
 * Mesma regra do `DynamicList` — a lista de colunas do grid é a mesma da list view, que é o que
 * o Odoo faz com o `<tree>` embutido no `<field>`. A FK do pai não entra: ela é vínculo, não
 * coluna que o operador vê.
 */
export function useSubformColumns(schema: MetaEntitySchema | null): MetaField[] {
  return useMemo(() => {
    if (!schema) {
      return [];
    }
    const listView = schema.views.find((view) => view.viewType === 'list');
    const declared = listView?.layout.columns ?? [];
    const byName = new Map(schema.fields.map((field) => [field.name, field]));
    const allowed = (field: MetaField): boolean =>
      field.inList &&
      !field.readOnly &&
      schema.allowedPermLevels.includes(field.permLevel);

    if (declared.length > 0) {
      const resolved = declared
        .map((name) => byName.get(name))
        .filter((field): field is MetaField => field !== undefined && allowed(field));
      if (resolved.length > 0) {
        return resolved;
      }
    }
    // Sem `in_list` declarado o grid ficaria sem coluna nenhuma e o subformulário viraria uma
    // caixa vazia com um botão. Cai para os campos de formulário, que é o conjunto que o
    // metadado já marcou como editável.
    return schema.fields
      .filter((field) => allowed(field) || (field.inForm && !field.readOnly && schema.allowedPermLevels.includes(field.permLevel)))
      .slice()
      .sort((left, right) => left.fieldOrder - right.fieldOrder);
  }, [schema]);
}

/**
 * Totais do rodapé, pelas agregações DECLARADAS no metadado do filho.
 *
 * Sem `aggregation` declarada não há rodapé — a engine não soma toda coluna `currency` por
 * conta própria. É a mesma regra do `DynamicList`, e ela existe porque um total que ninguém
 * declarou é um número sem dono.
 */
function buildSubformTotals(
  columns: MetaField[],
  rows: SubformRow[],
): Array<{ name: string; kind: string; total: number | null; field: MetaField }> {
  const entries: Array<{ name: string; kind: string; total: number | null; field: MetaField }> = [];
  for (const column of columns) {
    const kind = readAggregation(column.options ?? null, column.aggregation);
    if (!kind) {
      continue;
    }
    const values = rows.map((row) => row[column.name]);
    entries.push({ name: column.name, kind, total: applyAggregation(kind, values), field: column });
  }
  return entries;
}

function subformTotalLabel(
  column: MetaField,
  totals: ReadonlyArray<{ name: string; kind: string; total: number | null; field: MetaField }>,
): React.ReactNode {
  const entry = totals.find((candidate) => candidate.name === column.name);
  if (!entry) {
    return null;
  }
  return (
    <span data-aggregate-kind={entry.kind} className="ml-1">
      Total: {formatAggregate(entry.kind as never, entry.total, column.type)}
    </span>
  );
}

/**
 * Id de linha nova, do LADO DO CLIENTE.
 *
 * O servidor ainda não conhece a linha, então não há id dele para usar — e usar `index` ou
 * `crypto.randomUUID` colidiria entre duas linhas adicionadas no mesmo tick ou dependeria de
 * contexto seguro. O contador por sessão é estável, único e não finge ser um id do banco.
 */
let clientRowSeq = 0;
function newClientRowId(): string {
  clientRowSeq += 1;
  return `new-${clientRowSeq}-${Date.now().toString(36)}`;
}

function stampParent(
  row: SubformRow,
  parentField?: string,
  parentId?: string,
): SubformRow {
  if (!parentField || !parentId) {
    return row;
  }
  return { ...row, [parentField]: parentId };
}
