import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { resolveShellBreadcrumbs } from './nav-config';
import { ShellBreadcrumbs } from './ShellBreadcrumbs';

describe('shell breadcrumbs', () => {
  it('builds hierarchy for nested client route', () => {
    expect(resolveShellBreadcrumbs('/app/clients/new')).toEqual([
      { label: 'Início', href: '/app' },
      { label: 'Clientes', href: '/app/clients' },
      { label: 'Novo cliente' },
    ]);
  });

  it('renders breadcrumbs for section pages', () => {
    render(
      <MemoryRouter initialEntries={['/app/clients']}>
        <ShellBreadcrumbs />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveClass(
      'shell-breadcrumbs__trail',
    );
    expect(screen.getByText('Clientes')).toHaveAttribute('aria-current', 'page');
  });
});
