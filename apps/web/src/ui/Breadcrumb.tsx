import { Link } from 'react-router-dom';
import { cn } from './utils/cn';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type BreadcrumbProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    /*
      TRILHA DE ORIENTAÇÃO — wayfinding, não título.

      Antes: `text-sm text-gray-500` com separador de 8px de cada lado. A 14px, a trilha tinha a
      MESMA voz do dado da grade e disputava a leitura com o título da superfície — o topo da página
      lia como "título, título, título". Orientação é o nível MAIS BAIXO da hierarquia: fica em
      microtipografia, secundária, com o separador colado ao item anterior.
    */
    <nav
      aria-label="Breadcrumb"
      className={cn(
        'flex flex-wrap items-center text-[length:var(--type-micro-size)] text-[color:var(--color-text-secondary)]',
        className,
      )}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="inline-flex items-center">
            {index > 0 ? (
              <span aria-hidden="true" className="mx-1 text-[color:var(--color-divider-strong)]">
                /
              </span>
            ) : null}
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="text-[color:var(--color-text-secondary)] no-underline hover:text-[color:var(--color-brand-700)]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={cn(isLast && 'font-medium text-[color:var(--color-text-primary)]')}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
