import { useEffect, useId, type ReactNode } from 'react';
import { cn } from './utils/cn';

export type DrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  side?: 'left' | 'right';
};

export function Drawer({ open, title, onClose, children, side = 'right' }: DrawerProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fechar painel"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        /*
          PAINEL LATERAL — superficie de contexto, nao caixa branca generica.
          Mantem a elevacao (aqui ela e necessaria: o painel cobre a work area) e ganha a regua de
          acento + tipografia governada, para ler como contexto empresarial do CISNE e nao como
          modal generico de template.
        */
        className={cn(
          'cisne-context-surface absolute top-0 flex h-full w-[min(24rem,100vw)] flex-col shadow-[var(--shadow-dialog)]',
          side === 'right'
            ? 'right-0 border-l-[3px] border-l-brand-600'
            : 'left-0 border-r-[3px] border-r-brand-600',
        )}
      >
        <header className="cisne-divider--section flex items-center justify-between gap-2 px-3 py-2">
          <h2 id={titleId} className="cisne-type-workspace m-0 truncate">
            {title}
          </h2>
          <button
            type="button"
            className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={onClose}
          >
            Fechar
          </button>
        </header>
        <div className="flex-1 overflow-auto px-3 py-2">{children}</div>
      </aside>
    </div>
  );
}
