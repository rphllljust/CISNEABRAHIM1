import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SHELL_NAV_ITEMS } from '../../shell/nav-config';
import { isNavItemVisible } from '../../shell/useNavAccess';
import type { NavAccessMap } from '../../shell/types';
import { cn } from '../../ui/utils/cn';
import {
  buildSearchCommand,
  normalizeCommandText,
  rankCommands,
  COMMAND_GROUPS,
  type OperatorCommand,
} from './registry';

/**
 * COMMAND CENTER (Ctrl+K) — Navegar + Buscar + Criar + Ver.
 *
 * Sem IA, sem linguagem natural complexa: casamento deterministico de tokens
 * sobre um registro explicito de comandos (ver `registry.ts`).
 *
 * O menu lateral permanece a fonte de verdade da navegacao: os comandos de
 * navegacao sao DERIVADOS de SHELL_NAV_ITEMS e filtrados por `isNavItemVisible`,
 * ou seja, pelo mesmo acesso ja apurado pelo shell. A paleta nao decide acesso;
 * ela respeita o que o shell ja decidiu.
 *
 * A paleta nao executa transicao de dominio: apenas navega ate o ponto de decisao.
 */

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  access: NavAccessMap;
  accessLoading: boolean;
};

export function CommandPalette({ open, onClose, access, accessLoading }: CommandPaletteProps) {
  const navigate = useNavigate();
  const titleId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  /** Navegacao derivada do menu real, respeitando o acesso ja apurado. */
  const navigationCommands = useMemo<OperatorCommand[]>(() => {
    const byPath = new Map<string, string>();
    for (const item of SHELL_NAV_ITEMS) {
      if (!isNavItemVisible(item.id, access, accessLoading)) {
        continue;
      }
      // O menu pode repetir o mesmo destino; o mais especifico vence.
      const existing = byPath.get(item.path);
      if (!existing) {
        byPath.set(item.path, item.label);
      }
    }
    return [...byPath.entries()].map(([path, label]) => ({
      id: `nav:${path}`,
      kind: 'navigate' as const,
      group: COMMAND_GROUPS.navigate,
      label: `Ir para ${label}`,
      to: path,
      keywords: [label, 'abrir', 'ir', 'navegar'],
    }));
  }, [access, accessLoading]);

  const results = useMemo(() => {
    const ranked = rankCommands({ query, navigationCommands, limit: 12 });
    const search = buildSearchCommand(query);
    return search ? [...ranked, search] : ranked;
  }, [query, navigationCommands]);

  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    setQuery('');
    setActiveIndex(0);
    return undefined;
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runCommand = useCallback(
    (command: OperatorCommand) => {
      onClose();
      void navigate(command.to);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = results[activeIndex];
        if (command) {
          runCommand(command);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        restoreFocusRef.current?.focus();
      }
    },
    [activeIndex, results, runCommand, onClose],
  );

  if (!open) {
    return null;
  }

  // Agrupa preservando a ordem de relevancia dos resultados.
  const grouped: { group: string; commands: OperatorCommand[] }[] = [];
  for (const command of results) {
    const bucket = grouped.find((entry) => entry.group === command.group);
    if (bucket) {
      bucket.commands.push(command);
    } else {
      grouped.push({ group: command.group, commands: [command] });
    }
  }

  const activeCommandId = results[activeIndex] ? `command-option-${results[activeIndex].id}` : undefined;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fechar central de comandos"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute top-[12vh] left-1/2 flex max-h-[70vh] w-[min(40rem,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-gray-900/10"
      >
        <h2 id={titleId} className="cisne-sr-only">
          Central de comandos
        </h2>

        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <span className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
            Ctrl K
          </span>
          <label className="cisne-sr-only" htmlFor={`${titleId}-input`}>
            Comando ou busca
          </label>
          <input
            ref={inputRef}
            id={`${titleId}-input`}
            className="w-full border-0 bg-transparent px-1 py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400"
            placeholder="Navegar, ver lista filtrada, criar ou buscar…"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeCommandId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <ul
          id={listboxId}
          role="listbox"
          aria-label="Comandos disponíveis"
          className="m-0 flex-1 list-none overflow-auto p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-gray-500">
              Nenhum comando corresponde a “{query}”. A central usa comandos explícitos — tente
              “vencidos”, “rascunhos contábeis” ou “nova despesa”.
            </li>
          ) : (
            grouped.map((bucket) => (
              <li key={bucket.group} role="presentation">
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
                  {bucket.group}
                </p>
                <ul role="presentation" className="m-0 list-none p-0">
                  {bucket.commands.map((command) => {
                    const index = results.indexOf(command);
                    const isActive = index === activeIndex;
                    return (
                      <li key={command.id} role="presentation">
                        <button
                          type="button"
                          id={`command-option-${command.id}`}
                          role="option"
                          aria-selected={isActive}
                          className={cn(
                            'flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left',
                            isActive ? 'bg-brand-50' : 'hover:bg-gray-50',
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => runCommand(command)}
                        >
                          <span className="text-[13px] font-medium text-gray-900">
                            {command.label}
                          </span>
                          {command.hint ? (
                            <span className="text-[11px] text-gray-500">{command.hint}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
          ↑↓ navegar · Enter abrir · Esc fechar · somente comandos explícitos, sem IA
        </p>
      </div>
    </div>
  );
}

/** Atalho global do Command Center. Um unico dono do Ctrl+K. */
export function useCommandPaletteShortcut(open: boolean, setOpen: (next: boolean) => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);
}

export { normalizeCommandText };
