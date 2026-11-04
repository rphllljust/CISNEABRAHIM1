import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WorkbenchKpiStrip } from './WorkbenchKpiStrip';

describe('WorkbenchKpiStrip governance state', () => {
  it('keeps an explicit governed surface when no KPI is published', () => {
    render(
      <MemoryRouter>
        <WorkbenchKpiStrip kpis={[]} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Indicadores ainda não publicados para este recorte'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ausência de publicação não equivale a zero/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /abrir governança de metadados/i }),
    ).toHaveAttribute('href', '/app/admin/metadata');
  });
});
