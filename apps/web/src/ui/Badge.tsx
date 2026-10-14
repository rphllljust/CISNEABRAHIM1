import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-green-100 text-green-800 ring-green-600/20',
  warning: 'bg-orange-100 text-orange-800 ring-orange-600/20',
  error: 'bg-red-100 text-red-700 ring-red-600/20',
  info: 'bg-blue-100 text-blue-800 ring-blue-600/20',
};

export function Badge({ children, tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    /*
      TOKEN DE ESTADO — geometria governada pela DENSIDADE, cor governada pelo TOM.

      Antes: `px-2.5 py-0.5 text-xs rounded-full`. O texto do estado era maior que o texto do DADO
      da propria linha e o pilulo tinha respiro de SaaS, entao a coluna de situacao dominava a
      leitura da grade — o operador lia o selo antes do registro.

      Agora: altura FIXA no grid de densidade (1.125rem dentro de uma linha de `--row-height`),
      microtipografia, `leading-none` para nao clipar dentro da altura fixa e `tabular-nums` para
      que selos numericos alinhem na vertical. A cor NAO muda: tom e SEMANTICA de dominio, e
      inventar cor nova aqui seria inventar regra de negocio.

      O pilulo (`rounded-full`) permanece de proposito: forma arredondada e o vocabulario de
      ESTADO/TAG no CISNE (a governanca de raio em theme.css preserva `rounded-full` exatamente
      por isso) — o que estava errado era o TAMANHO, nao a forma.
    */
    <span
      className={cn(
        'inline-flex h-[1.125rem] items-center rounded-full px-1.5 text-[length:var(--type-micro-size)] leading-none font-semibold whitespace-nowrap tabular-nums ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
