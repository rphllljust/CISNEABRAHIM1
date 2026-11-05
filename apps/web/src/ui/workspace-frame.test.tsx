import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceToolbar } from './workspace-frame';

describe('WorkspaceToolbar', () => {
  it('lets the query surface span the full toolbar when saved views are absent', () => {
    const { container } = render(
      <WorkspaceToolbar>
        <button type="button">Buscar</button>
      </WorkspaceToolbar>,
    );

    const toolbar = container.querySelector('[data-region="workspace-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.children).toHaveLength(1);

    const querySurface = toolbar?.firstElementChild as HTMLElement | null;
    expect(querySurface?.className).toContain('xl:col-span-2');
  });



  it('gives dense commercial filters the full width without changing the split default', () => {
    const { container } = render(
      <WorkspaceToolbar layout="stacked" views={<button type="button">Minha visão</button>}>
        <label htmlFor="client-search">Cliente</label>
        <input id="client-search" />
      </WorkspaceToolbar>,
    );

    const toolbar = container.querySelector('[data-region="workspace-toolbar"]');
    expect(toolbar).toHaveAttribute('data-toolbar-layout', 'stacked');
    expect(toolbar?.className).toContain('xl:grid-cols-1');
    expect(toolbar?.className).not.toContain('overflow-hidden');
    expect(toolbar?.children).toHaveLength(2);

    const querySurface = toolbar?.children.item(1) as HTMLElement;
    expect(querySurface.className).not.toContain('xl:col-span-2');
  });

  it('keeps the two-column composition when saved views are present', () => {
    const { container } = render(
      <WorkspaceToolbar views={<button type="button">Minha visão</button>}>
        <button type="button">Buscar</button>
      </WorkspaceToolbar>,
    );

    const toolbar = container.querySelector('[data-region="workspace-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.children).toHaveLength(2);

    const querySurface = toolbar?.children.item(1) as HTMLElement | null;
    expect(querySurface?.className ?? '').not.toContain('xl:col-span-2');
  });
});
