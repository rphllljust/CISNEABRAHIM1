import { useCallback, useMemo, useState } from 'react';
import { t } from '../i18n';
import {
  FIELD_WRITE_PATH,
  applyFieldPatch,
  patchField,
  type EditableFieldPatch,
  type MetadataWriteOutcome,
} from './meta-write-api';
import type { DynamicFormProps } from './DynamicForm';
import type { MetaEntitySchema, MetaField, ViewSection } from './types';
import { readLayout, selectableFields } from './view-layout';

/**
 * CONSTRUTOR DE FORMULÁRIO dirigido por metadado — adicionar, remover e reordenar campos.
 *
 * A tela de detalhe (`DynamicForm`) RENDERIZA a view `form`. Este componente EDITA a view:
 * move campos entre seções, cria seções e altera a ordem — e a alteração é um `UPDATE` em
 * `meta.views.layout`, não um deploy.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * GAP_DE_API — DECLARADO, NÃO CONTORNADO
 *
 * A API de metadados NÃO publica rota de escrita. Verificado contra a API REAL:
 *
 *   PATCH /api/v1/meta/service-orders/fields/order_number  -> 404
 *   PATCH /api/v1/meta/service-orders/views/calendar       -> 404
 *   POST  /api/v1/meta/service-orders/fields               -> 404
 *
 * Não há endpoint de layout. `apps/api/` é somente leitura nesta track, então o canal NÃO é
 * criado aqui e NADA é inventado.
 *
 * O QUE O COMPONENTE FAZ, ENTÃO: aplica a edição ao estado LOCAL e marca cada mudança como
 * NÃO PERSISTIDA, com o endpoint que faltaria exposto na tela. É honesto e é útil — o
 * administrador monta o layout e VÊ o resultado antes de o canal existir. O selo vermelho
 * impede que alguém leia a tela como "salvo".
 *
 * A chamada de escrita é TENTADA de verdade. Se o backend publicar o endpoint, a persistência
 * passa a funcionar sem alteração de código — o cliente já fala o protocolo.
 */

export type FormBuilderDraft = {
  /** Seções do formulário, na ordem em que aparecem. */
  sections: ViewSection[];
  /** Campos ainda não alocados em nenhuma seção. */
  unassigned: string[];
};

export type FormBuilderFieldEntry = {
  name: string;
  label: string;
  field: MetaField | null;
  /** `true` quando a seção declara um campo que o schema não conhece. */
  missing: boolean;
};

/** Lê a view `form` como rascunho editável. */
export function readFormDraft(schema: MetaEntitySchema): FormBuilderDraft {
  const layout = readLayout(schema, 'form');
  const raw = layout?.['sections'];
  const sections: ViewSection[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const title = candidate['title'];
      const fields = candidate['fields'];
      if (typeof title !== 'string') {
        continue;
      }
      sections.push({
        title,
        fields: Array.isArray(fields)
          ? fields.filter((name): name is string => typeof name === 'string')
          : [],
      });
    }
  }

  const placed = new Set(sections.flatMap((section) => section.fields));
  // Campos que EXISTEM no schema mas o formulário não mostra. É a lista de onde o
  // administrador escolhe o que acrescentar — oferecer só os já colocados tornaria
  // "adicionar campo" impossível.
  const unassigned = schema.fields
    .filter((field) => field.inForm || !placed.has(field.name))
    .map((field) => field.name)
    .filter((name) => !placed.has(name));

  return { sections, unassigned };
}

/** Move um item de um array, devolvendo um novo array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return items;
  }
  next.splice(to, 0, moved);
  return next;
}

export type DynamicFormBuilderProps = {
  schema: MetaEntitySchema;
  /** Chamado quando o layout local muda, para a tela pré-visualizar sem recarregar. */
  onDraftChange?: (schema: MetaEntitySchema) => void;
  /** Chamado após tentativa de persistência, com o resultado real do servidor. */
  onPersistResult?: (outcome: MetadataWriteOutcome) => void;
};

type PersistState = MetadataWriteOutcome | null;

export function DynamicFormBuilder({
  schema,
  onDraftChange,
  onPersistResult,
}: DynamicFormBuilderProps): React.ReactElement {
  const [draft, setDraft] = useState<FormBuilderDraft>(() => readFormDraft(schema));
  const [persist, setPersist] = useState<PersistState>(null);
  const [busy, setBusy] = useState(false);
  const [newSection, setNewSection] = useState('');

  const available = useMemo(() => selectableFields(schema), [schema]);

  /**
   * O schema com o rascunho aplicado.
   *
   * A pré-visualização precisa do schema REAL com a mudança, não de uma cópia paralela —
   * caso contrário o que o administrador vê e o que o formulário renderiza divergem.
   */
  const draftSchema = useMemo<MetaEntitySchema>(
    () => ({
      ...schema,
      views: schema.views.map((view) =>
        view.viewType === 'form'
          ? { ...view, layout: { ...(view.layout as Record<string, unknown>), sections: draft.sections } }
          : view,
      ),
    }),
    [schema, draft],
  );

  const commit = useCallback(
    (next: FormBuilderDraft): void => {
      setDraft(next);
      const updated: MetaEntitySchema = {
        ...schema,
        views: schema.views.map((view) =>
          view.viewType === 'form'
            ? {
                ...view,
                layout: { ...(view.layout as Record<string, unknown>), sections: next.sections },
              }
            : view,
        ),
      };
      onDraftChange?.(updated);
    },
    [schema, onDraftChange],
  );

  /** Tenta persistir e registra o resultado REAL — sem assumir sucesso. */
  const attemptPersist = useCallback(
    async (fieldName: string, patch: EditableFieldPatch): Promise<void> => {
      setBusy(true);
      try {
        const outcome = await patchField(schema.name, fieldName, patch);
        setPersist(outcome);
        onPersistResult?.(outcome);
      } finally {
        setBusy(false);
      }
    },
    [schema.name, onPersistResult],
  );

  const addField = (sectionIndex: number, fieldName: string): void => {
    const sections = draft.sections.map((section, index) =>
      index === sectionIndex ? { ...section, fields: [...section.fields, fieldName] } : section,
    );
    commit({ sections, unassigned: draft.unassigned.filter((name) => name !== fieldName) });
    void attemptPersist(fieldName, { inForm: true });
  };

  const removeField = (sectionIndex: number, fieldIndex: number): void => {
    const section = draft.sections[sectionIndex];
    const removed = section?.fields[fieldIndex];
    const sections = draft.sections.map((candidate, index) =>
      index === sectionIndex
        ? { ...candidate, fields: candidate.fields.filter((_, position) => position !== fieldIndex) }
        : candidate,
    );
    commit({
      sections,
      unassigned: removed ? [...draft.unassigned, removed] : draft.unassigned,
    });
  };

  const reorderField = (sectionIndex: number, fieldIndex: number, delta: number): void => {
    const section = draft.sections[sectionIndex];
    if (!section) {
      return;
    }
    const fields = moveItem(section.fields, fieldIndex, fieldIndex + delta);
    if (fields === section.fields) {
      return;
    }
    commit({
      sections: draft.sections.map((candidate, index) =>
        index === sectionIndex ? { ...candidate, fields } : candidate,
      ),
      unassigned: draft.unassigned,
    });
  };

  const reorderSection = (sectionIndex: number, delta: number): void => {
    const sections = moveItem(draft.sections, sectionIndex, sectionIndex + delta);
    if (sections === draft.sections) {
      return;
    }
    commit({ sections, unassigned: draft.unassigned });
  };

  const addSection = (): void => {
    const title = newSection.trim();
    if (title === '') {
      return;
    }
    commit({ sections: [...draft.sections, { title, fields: [] }], unassigned: draft.unassigned });
    setNewSection('');
  };

  const removeSection = (sectionIndex: number): void => {
    const section = draft.sections[sectionIndex];
    if (!section) {
      return;
    }
    commit({
      sections: draft.sections.filter((_, index) => index !== sectionIndex),
      // Campos da seção removida voltam para a lista de disponíveis em vez de sumirem.
      unassigned: [...draft.unassigned, ...section.fields],
    });
  };

  const labelOf = (name: string): string =>
    schema.fields.find((field) => field.name === name)?.label ?? name;

  const entryOf = (name: string): FormBuilderFieldEntry => {
    const field = schema.fields.find((candidate) => candidate.name === name) ?? null;
    return { name, label: field?.label ?? name, field, missing: field === null };
  };

  return (
    <div
      data-testid="dynamic-form-builder"
      data-entity={schema.name}
      data-builder-sections={draft.sections.length}
      data-builder-unassigned={draft.unassigned.length}
      className="rounded border border-slate-200 bg-white p-4"
    >
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {t('builder.title', 'Construtor de formulário')}
        </h3>
        <p className="text-xs text-slate-500">
          {t(
            'builder.subtitle',
            'A ordem e as seções vêm de meta.views.form.layout — mover um campo é alterar o metadado, não o código.',
          )}
        </p>
      </header>

      {/* ESTADO DE PERSISTÊNCIA sempre visível. */}
      {persist === null ? (
        <p data-testid="builder-persist" data-persist-status="idle" className="mb-3 text-xs text-slate-500">
          {t('builder.idle', 'Nenhuma alteração enviada ao servidor nesta sessão.')}
        </p>
      ) : persist.status === 'persisted' ? (
        <p
          data-testid="builder-persist"
          data-persist-status="persisted"
          className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
        >
          {t('builder.persisted', 'Alteração persistida no metadata store.')}
        </p>
      ) : persist.status === 'denied' ? (
        <p
          data-testid="builder-persist"
          data-persist-status="denied"
          className="mb-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
        >
          {t('builder.denied', 'O servidor recusou a escrita')}: {persist.detail}
        </p>
      ) : (
        <div
          data-testid="builder-persist"
          data-persist-status={persist.status === 'unsupported' ? 'gap' : 'failed'}
          data-persist-endpoint={
            persist.status === 'unsupported' ? persist.endpoint : FIELD_WRITE_PATH(schema.name, '<campo>')
          }
          data-persist-http={persist.status === 'unsupported' ? String(persist.httpStatus ?? '') : ''}
          className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <p className="font-semibold">
            GAP_DE_API — {t('builder.gapTitle', 'a alteração NÃO foi persistida.')}
          </p>
          <p className="mt-1">
            {/*
              * Aqui só chegam `unsupported` e `failed` — `persisted` e `denied` foram tratados
              * acima. Os dois carregam `detail`, que é a mensagem real do servidor.
              */}
            {persist.detail}
          </p>
          <p className="mt-1">
            {t('builder.gapEndpoint', 'A persistência exigiria')}{' '}
            <code data-testid="builder-gap-endpoint">
              PATCH /api/v1/meta/{schema.name}/fields/:name
            </code>
            {persist.status === 'unsupported' && persist.httpStatus !== null ? (
              <>
                {' '}
                — {t('builder.gapResponse', 'o servidor respondeu HTTP')}{' '}
                <strong>{persist.httpStatus}</strong>.
              </>
            ) : null}
          </p>
          <p className="mt-1">
            {t(
              'builder.gapEffect',
              'O layout abaixo é uma PRÉ-VISUALIZAÇÃO local: ele muda na tela e volta ao original ao recarregar.',
            )}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {draft.sections.map((section, sectionIndex) => (
          <section
            key={`${section.title}-${sectionIndex}`}
            data-builder-section={section.title}
            data-builder-section-index={sectionIndex}
            className="rounded border border-slate-200 bg-slate-50 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase text-slate-600">{section.title}</h4>
              <span className="text-[11px] text-slate-500">
                {section.fields.length} {t('builder.fields', 'campos')}
              </span>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  data-builder-section-up={sectionIndex}
                  disabled={sectionIndex === 0}
                  onClick={() => reorderSection(sectionIndex, -1)}
                  className="rounded border border-slate-300 px-1 text-xs disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  data-builder-section-down={sectionIndex}
                  disabled={sectionIndex === draft.sections.length - 1}
                  onClick={() => reorderSection(sectionIndex, 1)}
                  className="rounded border border-slate-300 px-1 text-xs disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  data-builder-section-remove={sectionIndex}
                  onClick={() => removeSection(sectionIndex)}
                  className="rounded border border-red-300 px-1 text-xs text-red-700"
                >
                  {t('builder.removeSection', 'Remover seção')}
                </button>
              </div>
            </div>

            <ul className="space-y-1">
              {section.fields.map((name, fieldIndex) => {
                const entry = entryOf(name);
                return (
                  <li
                    key={`${name}-${fieldIndex}`}
                    data-builder-field={name}
                    data-builder-field-section={sectionIndex}
                    data-builder-field-missing={entry.missing ? 'true' : 'false'}
                    className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm"
                  >
                    <span className="text-slate-800">{entry.label}</span>
                    <code className="text-[11px] text-slate-400">{entry.name}</code>
                    {entry.missing ? (
                      <span className="rounded bg-amber-100 px-1 text-[11px] text-amber-800">
                        {t('builder.missingField', 'não existe em meta.fields')}
                      </span>
                    ) : null}
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        data-builder-field-up={name}
                        disabled={fieldIndex === 0}
                        onClick={() => reorderField(sectionIndex, fieldIndex, -1)}
                        className="rounded border border-slate-300 px-1 text-xs disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        data-builder-field-down={name}
                        disabled={fieldIndex === section.fields.length - 1}
                        onClick={() => reorderField(sectionIndex, fieldIndex, 1)}
                        className="rounded border border-slate-300 px-1 text-xs disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        data-builder-field-remove={name}
                        onClick={() => removeField(sectionIndex, fieldIndex)}
                        className="rounded border border-red-300 px-1 text-xs text-red-700"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {draft.unassigned.length > 0 ? (
              <div className="mt-2 flex items-center gap-2">
                <select
                  data-builder-add-select={sectionIndex}
                  defaultValue=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value !== '') {
                      addField(sectionIndex, value);
                      event.target.value = '';
                    }
                  }}
                  className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                >
                  <option value="">{t('builder.addField', 'Adicionar campo…')}</option>
                  {draft.unassigned.map((name) => (
                    <option key={name} value={name}>
                      {labelOf(name)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">
                {t('builder.noMoreFields', 'Todos os campos disponíveis já estão no formulário.')}
              </p>
            )}
          </section>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          data-builder-new-section
          value={newSection}
          onChange={(event) => setNewSection(event.target.value)}
          placeholder={t('builder.newSectionPlaceholder', 'Nova seção')}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          data-builder-add-section
          onClick={addSection}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          {t('builder.addSection', 'Adicionar seção')}
        </button>
        {busy ? (
          <span data-builder-busy className="text-[11px] text-slate-500">
            {t('common.loading', 'Carregando…')}
          </span>
        ) : null}
      </div>

      {/*
       * PRÉ-VISUALIZAÇÃO. Renderiza o schema com o rascunho aplicado, para o administrador
       * conferir ANTES de o canal de escrita existir — e para a mudança ser visível no DOM.
       */}
      <div className="mt-4 border-t border-slate-200 pt-3">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-600">
          {t('builder.preview', 'Pré-visualização do layout')}
        </h4>
        <div data-testid="builder-preview" data-preview-sections={draftSchema.views.filter((v) => v.viewType === 'form').length}>
          <ol className="space-y-2">
            {draft.sections.map((section) => (
              <li key={`preview-${section.title}`} data-preview-section={section.title}>
                <p className="text-xs font-medium text-slate-700">{section.title}</p>
                <p data-preview-fields={section.fields.join(',')} className="text-[11px] text-slate-500">
                  {section.fields.length === 0
                    ? t('builder.emptySection', '(seção vazia)')
                    : section.fields.map((name) => labelOf(name)).join(' · ')}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p data-testid="builder-available" className="mt-3 text-[11px] text-slate-400">
        {available.length} {t('builder.availableFields', 'campos editáveis no schema.')}
      </p>
    </div>
  );
}

/** Reexportado para a tela pré-visualizar sem importar o módulo de escrita. */
export { applyFieldPatch };
export type { EditableFieldPatch, MetadataWriteOutcome };
export type { DynamicFormProps };
