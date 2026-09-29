import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './utils/cn';

/**
 * DATATABLE — a mesma DENSIDADE da grade enterprise, sem mudar a API.
 *
 * Estas primitivas carregavam `px-6 py-3.5` (padding de 24px na horizontal e 14px na vertical por
 * celula): altura de linha ~88px. Era a densidade LEGADA, irmã de `moduleTableClass`, e fazia
 * `DocumentsPage` e `ClientsListPage` renderem visivelmente mais folgadas que as worklists ja
 * migradas — de novo "dois produtos" na mesma sidebar.
 *
 * O QUE MUDOU: apenas a densidade (padding, tamanho de fonte e alinhamento vertical), alinhada aos
 * tokens da grade compartilhada (`worklistHeadCellClass` / `worklistCellClass`): ~33-40px por linha.
 *
 * O QUE **NAO** MUDOU: a API dos componentes (mesmos nomes, mesmas props, mesmo `className` de
 * override vindo do chamador, que continua vencendo), o `overflow-x-auto` do wrapper, a semantica de
 * tabela e `cisne-type-money` na celula numerica. Nenhum comportamento, coluna ou dado foi alterado.
 *
 * Efeito: as listas que usam `DataTable` passam a ter a MESMA densidade das worklists de referencia,
 * sem tocar em nenhuma tela — uma troca de token, muitos consumidores.
 */
export function DataTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn('w-full border-separate border-spacing-0 bg-white text-[13px]', className)}
        {...props}
      />
    </div>
  );
}

export function DataTableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-gray-50" {...props} />;
}

export function DataTableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-gray-100', className)} {...props} />;
}

export function DataTableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors hover:bg-brand-50/40', className)} {...props} />
  );
}

export function DataTableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-[11px] font-semibold tracking-wider text-gray-500 uppercase whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function DataTableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'border-b border-gray-100 px-2.5 py-1.5 align-middle text-[13px] text-gray-700',
        className,
      )}
      {...props}
    />
  );
}

export function DataTableNumericCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'cisne-type-money border-b border-gray-100 px-2.5 py-1.5 text-right align-middle whitespace-nowrap text-[13px] text-gray-900 tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
