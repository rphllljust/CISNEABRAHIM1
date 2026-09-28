import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../ui/utils/cn';
import type { BuiltInView, SavedView, UseSavedViewsResult } from './useSavedViews';

/**
 * SAVED VIEWS BAR — barra de visoes de uma smart list.
 *
 * Aplica visao de sistema (embutida) e visao salva local. Salvar/renomear/remover
 * agem apenas sobre configuracao de visualizacao; nenhuma visao amplia acesso.
 */

export type SavedViewsBarProps = {
  views: SavedView[];
  builtInViews: BuiltInView[];
  activeViewId: string | null;
  onApply: (view: { id: string; config: SavedView['config'] }) => void;
  onSave: UseSavedViewsResult['saveView'];
  onRename: UseSavedViewsResult['renameView'];
  onRemove: UseSavedViewsResult['removeView'];
  currentConfig: SavedView['config'];
  canSave: boolean;
  /** Rotulo do estado sem visao aplicada. */
  allLabel?: string;
  className?: string;
};

export function SavedViewsBar({
  views,
  builtInViews,
  activeViewId,
  onApply,
  onSave,
  onRename,
  onRemove,
  currentConfig,
  canSave,
  allLabel = 'Tudo',
  className,
}: SavedViewsBarProps) {
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const nameInputId = useId();
  const renameInputId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saving) {
      nameRef.current?.focus();
    }
  }, [saving]);

  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
    }
  }, [renamingId]);

  function commitSave() {
    const created = onSave(draftName, currentConfig);
    if (!created) {
      setNotice('Não foi possível salvar: use um nome curto e apenas filtros da tela.');
      return;
    }
    setNotice(`Visão "${created.name}" salva neste dispositivo.`);
    setSaving(false);
    setDraftName('');
    onApply(created);
  }

  function commitRename(id: string) {
    const ok = onRename(id, renameDraft);
    setNotice(ok ? 'Visão renomeada.' : 'Nome inválido.');
    setRenamingId(null);
    setRenameDraft('');
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-gray-50/70 px-3 py-2',
        className,
      )}
      role="group"
      aria-label="Visões salvas desta lista"
    >
      <span className="mr-1 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
        Visões
      </span>

      <ViewChip
        label={allLabel}
        active={activeViewId === null}
        onClick={() => onApply({ id: '__all__', config: { filters: {}, sortKey: null, sortDirection: 'asc', groupKey: null } })}
      />

      {builtInViews.map((view) => (
        <ViewChip
          key={view.id}
          label={view.name}
          title={view.description}
          system
          active={activeViewId === view.id}
          onClick={() => onApply({ id: view.id, config: view.config })}
        />
      ))}

      {views.map((view) =>
        renamingId === view.id ? (
          <span key={view.id} className="inline-flex items-center gap-1">
            <label className="cisne-sr-only" htmlFor={renameInputId}>
              Novo nome da visão
            </label>
            <input
              ref={renameRef}
              id={renameInputId}
              className="w-40 rounded-md border border-gray-300 px-2 py-1 text-xs"
              value={renameDraft}
              maxLength={48}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename(view.id);
                }
                if (event.key === 'Escape') {
                  setRenamingId(null);
                }
              }}
            />
            <button
              type="button"
              className="rounded px-1.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
              onClick={() => commitRename(view.id)}
            >
              OK
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
              onClick={() => setRenamingId(null)}
            >
              Cancelar
            </button>
          </span>
        ) : (
          <span key={view.id} className="inline-flex items-center">
            <ViewChip
              label={view.name}
              active={activeViewId === view.id}
              onClick={() => onApply(view)}
            />
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label={`Renomear visão ${view.name}`}
              onClick={() => {
                setRenamingId(view.id);
                setRenameDraft(view.name);
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="rounded px-1 py-0.5 text-[11px] text-gray-400 hover:bg-red-50 hover:text-red-700"
              aria-label={`Remover visão ${view.name}`}
              onClick={() => {
                onRemove(view.id);
                setNotice(`Visão "${view.name}" removida.`);
              }}
            >
              ✕
            </button>
          </span>
        ),
      )}

      {saving ? (
        <span className="inline-flex items-center gap-1">
          <label className="cisne-sr-only" htmlFor={nameInputId}>
            Nome da nova visão
          </label>
          <input
            ref={nameRef}
            id={nameInputId}
            className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs"
            placeholder="Ex.: Vencidos"
            value={draftName}
            maxLength={48}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitSave();
              }
              if (event.key === 'Escape') {
                setSaving(false);
                setDraftName('');
              }
            }}
          />
          <button
            type="button"
            className="rounded px-1.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            onClick={commitSave}
          >
            Salvar
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
            onClick={() => {
              setSaving(false);
              setDraftName('');
            }}
          >
            Cancelar
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="ml-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSave}
          title={
            canSave
              ? 'Salvar os filtros e a ordenação atuais neste dispositivo'
              : 'Aplique um filtro ou uma ordenação para salvar uma visão'
          }
          onClick={() => setSaving(true)}
        >
          + Salvar visão
        </button>
      )}

      <span aria-live="polite" className="ml-auto text-[11px] text-gray-500">
        {notice}
      </span>
    </div>
  );
}

function ViewChip({
  label,
  active,
  system = false,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  system?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
        system && !active ? 'border-dashed' : '',
      )}
    >
      {label}
    </button>
  );
}
