import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { cn } from '../ui/utils/cn';
import { toHumanText } from './human-text';
import type { CreateSheetSection } from './types';

/**
 * 8 — CREATE SHEET
 *
 * Padrao unico de criacao dos objetos ancoras. A criacao NAO e um formulario espalhado
 * pela tela: e uma folha lateral com SECOES EMPRESARIAIS, acoes claras e erro visivel.
 *
 * Secao so existe se tiver campo real. O conteudo de cada secao e do modulo; o contrato
 * garante a moldura, a ordem, os rotulos de acao e a coerencia de erro/submissao.
 */

export type EnterpriseCreateSheetProps = {
  open: boolean;
  title: string;
  subtitle?: string | null;
  sections: CreateSheetSection[];
  submitLabel: string;
  submittingLabel?: string;
  onSubmit: () => void;
  onClose: () => void;
  submitting?: boolean;
  /** Erro real da operacao. Nunca substitui o formulario: aparece acima das acoes. */
  error?: string | null;
  footerNote?: ReactNode;
  submitDisabled?: boolean;
  className?: string;
};

export function EnterpriseCreateSheet({
  open,
  title,
  subtitle,
  sections,
  submitLabel,
  submittingLabel,
  onSubmit,
  onClose,
  submitting = false,
  error = null,
  footerNote,
  submitDisabled = false,
  className,
}: EnterpriseCreateSheetProps) {
  const visibleSections = sections.filter((section) => section.content !== null && section.content !== undefined);
  const humanSubtitle = toHumanText(subtitle);
  const humanError = toHumanText(error);

  return (
    <Drawer open={open} title={title} onClose={onClose}>
      <form
        className={cn('flex h-full flex-col', className)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && !submitDisabled) {
            onSubmit();
          }
        }}
      >
        <div className="flex-1 overflow-auto">
          {humanSubtitle ? <p className="m-0 mb-3 text-xs text-gray-600">{humanSubtitle}</p> : null}

          {visibleSections.map((section) => (
            <section key={section.id} className="mb-4 border-b border-gray-100 pb-4 last:border-b-0">
              <h3 className="m-0 mb-0.5 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                {section.title}
              </h3>
              {section.description ? (
                <p className="m-0 mb-2 text-[11px] text-gray-500">{section.description}</p>
              ) : null}
              <div className="mt-2 flex flex-col gap-2">{section.content}</div>
            </section>
          ))}
        </div>

        <div className="mt-3 border-t border-gray-200 pt-3">
          {humanError ? (
            <p
              role="alert"
              className="m-0 mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/20 ring-inset"
            >
              {humanError}
            </p>
          ) : null}
          {footerNote ? <div className="mb-2 text-[11px] text-gray-500">{footerNote}</div> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting} loadingText={submittingLabel ?? 'Salvando…'} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
