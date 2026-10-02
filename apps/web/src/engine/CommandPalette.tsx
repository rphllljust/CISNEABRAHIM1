import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema } from './types';

/**
 * Command palette (Ctrl+K).
 *
 * Duas famílias de entrada:
 *   - NAVEGAÇÃO: telas, fornecidas pela tela (a engine não conhece a malha de rotas do app);
 *   - AÇÕES: transições do workflow da entidade atual que o ator PODE executar, mais os
 *     comandos globais declarados pela tela.
 *
 * A engine não inventa destino nem comando: se a lista chega vazia, a palette diz que não há
 * nada — não preenche com atalho inventado.
 */
export type PaletteDestination = {
  id: string;
  label: string;
  path: string;
  group?: string;
};

export type PaletteAction = {
  id: string;
  label: string;
  run: () => void;
  /** Permissão exigida, para desabilitar em vez de esconder — a palette explica o porquê. */
  allowed?: boolean;
};

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  destinations: PaletteDestination[];
  actions: PaletteAction[];
  onNavigate: (path: string) => void;
};

export function CommandPalette({
  open,
  onClose,
  destinations,
  actions,
  onNavigate,
}: CommandPaletteProps): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlight(0);
    }
  }, [open]);

  const normalized = query.trim().toLowerCase();

  const matchedDestinations = useMemo(
    () =>
      destinations.filter((destination) =>
        matches(destination.label, destination.group, normalized),
      ),
    [destinations, normalized],
  );

  const matchedActions = useMemo(
    () => actions.filter((action) => matches(action.label, undefined, normalized)),
    [actions, normalized],
  );

  const total = matchedDestinations.length + matchedActions.length;

  const commit = useCallback(
    (index: number) => {
      if (index < matchedDestinations.length) {
        const destination = matchedDestinations[index];
        if (destination) {
          onNavigate(destination.path);
          onClose();
        }
        return;
      }
      const action = matchedActions[index - matchedDestinations.length];
      if (action && action.allowed !== false) {
        action.run();
        onClose();
      }
    },
    [matchedDestinations, matchedActions, onNavigate, onClose],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.placeholder')}
        className="mt-16 w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          data-testid="command-palette-input"
          className="w-full rounded-t-lg border-b border-gray-200 px-4 py-3 text-sm outline-none"
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((current) => (total === 0 ? 0 : (current + 1) % total));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((current) => (total === 0 ? 0 : (current - 1 + total) % total));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(highlight);
            }
          }}
        />

        <ul className="max-h-80 overflow-y-auto p-1" data-testid="command-palette-results">
          {total === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">{t('palette.empty')}</li>
          ) : null}

          {matchedDestinations.map((destination, index) => (
            <li key={destination.id}>
              <button
                type="button"
                data-testid="command-palette-item"
                data-item-kind="navigate"
                data-item-label={destination.label}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                  index === highlight ? 'bg-slate-100' : ''
                }`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(index)}
              >
                <span>{destination.label}</span>
                <span className="text-[11px] uppercase tracking-wide text-gray-400">
                  {destination.group ?? t('palette.navigate')}
                </span>
              </button>
            </li>
          ))}

          {matchedActions.map((action, offset) => {
            const index = matchedDestinations.length + offset;
            return (
              <li key={action.id}>
                <button
                  type="button"
                  data-testid="command-palette-item"
                  data-item-kind="action"
                  data-item-label={action.label}
                  data-item-allowed={action.allowed === false ? 'false' : 'true'}
                  disabled={action.allowed === false}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm disabled:opacity-50 ${
                    index === highlight ? 'bg-slate-100' : ''
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(index)}
                >
                  <span>{action.label}</span>
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">
                    {t('palette.actions')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          Esc fecha · ↑↓ navega · Enter confirma · {t('palette.hint')} abre
        </p>
      </div>
    </div>
  );
}

/**
 * Liga o atalho Ctrl+K (e Cmd+K no macOS).
 *
 * O listener vive no `document` porque o atalho é global — prendê-lo a um elemento faria a
 * palette só abrir com foco no lugar certo.
 */
export function useCommandPaletteShortcut(onOpen: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpen, enabled]);
}

/**
 * Ações da palette derivadas do workflow da entidade.
 *
 * Uma transição que o ator não pode executar entra DESABILITADA, não ausente: a palette é o
 * lugar de descobrir que a ação existe e falta permissão.
 */
export function paletteActionsFromSchema(
  schema: MetaEntitySchema | null,
  onCommand: (command: string) => void,
): PaletteAction[] {
  if (!schema?.workflow) {
    return [];
  }
  return schema.workflow.transitions
    .slice()
    .sort((left, right) => left.buttonOrder - right.buttonOrder)
    .map((transition) => ({
      id: `command-${transition.command}`,
      label: transition.label,
      allowed: transition.allowed,
      run: () => onCommand(transition.command),
    }));
}

function matches(label: string, group: string | undefined, query: string): boolean {
  if (query === '') {
    return true;
  }
  return (
    label.toLowerCase().includes(query) || (group?.toLowerCase().includes(query) ?? false)
  );
}
