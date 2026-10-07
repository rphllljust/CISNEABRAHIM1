import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './utils/cn';

/**
 * DATATABLE — a grade enterprise: densa, escaneavel e com TRILHA DE LEITURA.
 *
 * Estas primitivas carregavam `px-6 py-3.5` (padding de 24px na horizontal e 14px na vertical por
 * celula): altura de linha ~88px. Era a densidade LEGADA, irmã de `moduleTableClass`, e fazia
 * `DocumentsPage` e `ClientsListPage` renderizarem visivelmente mais folgadas que as worklists ja
 * migradas — de novo "dois produtos" na mesma sidebar.
 *
 * O QUE **NAO** MUDOU: a API dos componentes (mesmos nomes, mesmas props, mesmo `className` de
 * override vindo do chamador, que continua vencendo), o `overflow-x-auto` do wrapper, a semantica de
 * tabela e `cisne-type-money` na celula numerica. Nenhum comportamento, coluna ou dado foi alterado.
 *
 * FOUNDATION (v2) — a densidade agora vem de TOKEN, nao de numero escrito na celula:
 *   - altura de linha de `--row-height`;
 *   - o dado da celula usa o papel `body` (13px) e o NUMERO usa o papel `meta-numeric`, ambos com
 *     `tabular-nums`, para que a coluna de valor alinhe digito a digito;
 *   - o cabecalho usa o papel `label` (11px uppercase), que e SUBORDINADO ao dado — cabecalho de
 *     grade e rotulo, nao conteudo;
 *   - a ultima borda e removida na ultima linha, para nao desenhar uma linha solta no fim da grade.
 */
export function DataTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table
        className={cn(
          'w-full border-separate border-spacing-0 bg-white text-[length:var(--type-body-size)]',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function DataTableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="sticky top-0 z-10 bg-gray-50" {...props} />;
}

export function DataTableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-gray-100', className)} {...props} />;
}

export function DataTableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'h-[var(--row-height)] transition-colors hover:bg-brand-50/40 data-[selected=true]:bg-brand-50',
        className,
      )}
      {...props}
    />
  );
}

export function DataTableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-gray-300 bg-gray-50 px-2 py-1 text-left text-[length:var(--type-micro-size)] font-semibold tracking-wide text-gray-600 uppercase whitespace-nowrap',
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
        'border-b border-gray-100 px-2 py-1 align-middle text-[length:var(--type-body-size)] text-gray-800',
        className,
      )}
      {...props}
    />
  );
}

/**
 * CELULA NUMERICA — valor de dinheiro/quantidade alinhado a direita e com tabular-nums.
 *
 * Numeros so comparam quando alinham pela direita E pela virgula. Sem `tabular-nums` a coluna
 * "treme" e o operador perde a comparação vertical, que e a razao de a grade existir.
 */
export function DataTableNumericCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'cisne-type-money border-b border-gray-100 px-2 py-1 text-right align-middle whitespace-nowrap text-[length:var(--type-body-size)] font-medium text-gray-900',
        className,
      )}
      {...props}
    />
  );
}
