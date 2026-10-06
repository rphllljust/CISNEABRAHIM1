/**
 * SAVED VIEW BAR — O SELETOR DE VISUALIZACOES
 *
 * Conforme a Pagina 11 do relatorio, a personalizacao e objeto de PRODUTO: o operador escolhe,
 * nomeia, fixa como padrao e reaplica o proprio recorte. Este componente materializa isso.
 *
 * ELE NAO DECIDE NADA DE DADO. Nao filtra, nao ordena, nao consulta. Ele apresenta as views, e
 * quem aplica o recorte e a pagina (via `onApply` do hook). Separar as duas coisas e o que impede
 * o seletor de virar uma segunda fonte de verdade sobre a lista.
 *
 * `dirty` governa a acao de atualizar: "Salvar alterações" so aparece quando o operador MUDOU algo
 * em relacao a view ativa. Oferecer o botao sempre faria o operador salvar sem saber se havia
 * mudanca — e um salvamento que nao muda nada corrompe a confianca no indicador.
 */

import { useState } from 'react';
import type { CisneSavedView, SavedViewScope } from './types';

export type SavedViewBarProps = {
  views: CisneSavedView[];
  activeView: CisneSavedView | null;
  dirty: boolean;
  scopeNotice: string | null;
  onApply: (view: CisneSavedView) => void;
  onSave: (name: string, scope: SavedViewScope) => { ok: boolean; reason?: string };
  onSaveChanges: () => { ok: boolean; reason?: string };
  onSetDefault: (viewId: string) => void;
  onRename: (viewId: string, name: string) => { ok: boolean; reason?: string };
  onRemove: (viewId: string) => void;
  /** Rótulo curto da superfície, para o texto do estado vazio. */
  surfaceLabel: string;
  className?: string;
};

export function SavedViewBar({
  views,
  activeView,
  dirty,
  scopeNotice,
  onApply,
  onSave,
  onSaveChanges,
  onSetDefault,
  onRename,
  onRemove,
  surfaceLabel,
  className,
}: SavedViewBarProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<SavedViewScope>('PERSONAL');
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function submitSave() {
    const result = onSave(name, scope);
    if (!result.ok) {
      setError(result.reason ?? 'Não foi possível salvar.');
      return;
    }
    setError(null);
    setName('');
    setSaving(false);
  }

  function submitSaveChanges() {
    const result = onSaveChanges();
    setError(result.ok ? null : (result.reason ?? 'Não foi possível atualizar.'));
  }

  function submitRename(viewId: string) {
    const result = onRename(viewId, renameValue);
    if (!result.ok) {
      setError(result.reason ?? 'Não foi possível renomear.');
      return;
    }
    setError(null);
    setRenaming(null);
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="saved-view-select">
          Visualização
        </label>
        <select
          id="saved-view-select"
          value={activeView?.id ?? ''}
          onChange={(event) => {
            const next = views.find((view) => view.id === event.target.value);
            if (next) {
              onApply(next);
            }
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">
            {views.length === 0
              ? `Nenhuma visualização salva em ${surfaceLabel}`
              : 'Sem visualização aplicada'}
          </option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
              {view.isDefault ? ' (padrão)' : ''}
              {view.scope === 'ROLE' ? ' · perfil' : ''}
            </option>
          ))}
        </select>

        {activeView ? (
          <button
            type="button"
            onClick={() => onSetDefault(activeView.id)}
            disabled={activeView.isDefault}
            className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
            title={
              activeView.isDefault
                ? 'Esta já é a visualização que abre por padrão.'
                : 'Abrir esta visualização automaticamente ao entrar na tela.'
            }
          >
            {activeView.isDefault ? 'Padrão ativo' : 'Tornar padrão'}
          </button>
        ) : null}

        {/*
          "Salvar alterações" SO com divergencia real. Sem `dirty`, o botao sumiria do operador que
          acabou de aplicar a view — e cujo estado E a view, sem alteracao a persistir.
        */}
        {activeView && dirty ? (
          <button
            type="button"
            onClick={submitSaveChanges}
            className="rounded-md bg-amber-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            title="Gravar o estado atual da lista nesta visualização."
          >
            Salvar alterações
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setSaving((current) => !current)}
          className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Salvar como nova…
        </button>
      </div>

      {activeView ? (
        <p className="mt-1 text-xs text-slate-500">
          {scopeNotice}
          {dirty ? ' · A lista foi alterada desde a última gravação.' : ''}
        </p>
      ) : null}

      {saving ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow">
              <label htmlFor="saved-view-name" className="block text-xs font-medium text-slate-700">
                Nome da visualização
              </label>
              <input
                id="saved-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Ex.: Vencidas 7 dias — cobrança"
              />
            </div>
            <div>
              <label htmlFor="saved-view-scope" className="block text-xs font-medium text-slate-700">
                Escopo
              </label>
              <select
                id="saved-view-scope"
                value={scope}
                onChange={(event) => setScope(event.target.value as SavedViewScope)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="PERSONAL">Somente eu</option>
                <option value="ROLE">Perfil</option>
              </select>
            </div>
            <button
              type="button"
              onClick={submitSave}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={() => {
                setSaving(false);
                setError(null);
              }}
              className="rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {views.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {views.map((view) => (
            <li
              key={view.id}
              className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs"
            >
              {renaming === view.id ? (
                <>
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    maxLength={60}
                    aria-label={`Novo nome para ${view.name}`}
                    className="w-40 rounded border border-slate-300 px-1 py-0.5"
                  />
                  <button type="button" onClick={() => submitRename(view.id)} className="text-slate-700">
                    OK
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-slate-500">
                    ×
                  </button>
                </>
              ) : (
                <>
                  <span className="text-slate-700">{view.name}</span>
                  {view.isDefault ? <span className="text-slate-400">padrão</span> : null}
                  <button
                    type="button"
                    onClick={() => onApply(view)}
                    className="text-slate-500 hover:text-slate-800"
                    aria-label={`Aplicar ${view.name}`}
                  >
                    aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(view.id);
                      setRenameValue(view.name);
                    }}
                    className="text-slate-500 hover:text-slate-800"
                    aria-label={`Renomear ${view.name}`}
                  >
                    renomear
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(view.id)}
                    className="text-slate-500 hover:text-red-700"
                    aria-label={`Excluir ${view.name}`}
                  >
                    excluir
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
