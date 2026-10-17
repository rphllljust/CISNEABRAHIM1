import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar } from './ActionBar';
import type { MetaEntitySchema } from './types';

const schema = {
  name: 'service-orders',
  label: 'Ordens de serviço',
  description: null,
  dataSchema: 'so',
  dataTable: 'service_orders',
  labelField: 'order_number',
  fields: [],
  views: [],
  permissions: [],
  allowedPermLevels: [],
  workflow: {
    stateField: 'status',
    states: ['DRAFT', 'PREPARED', 'CANCELLED'],
    transitions: [
      {
        command: 'prepare',
        label: 'Preparar',
        fromStates: ['DRAFT'],
        toState: 'PREPARED',
        permission: 'service-orders:service-order:prepare',
        requiresReason: false,
        allowed: true,
        buttonOrder: 10,
      },
      {
        command: 'cancel',
        label: 'Cancelar',
        fromStates: ['DRAFT'],
        toState: 'CANCELLED',
        permission: 'service-orders:service-order:cancel',
        requiresReason: true,
        allowed: true,
        buttonOrder: 20,
      },
    ],
  },
} satisfies MetaEntitySchema;

describe('ActionBar record capability filter', () => {
  it('renders only commands published as available for this record', () => {
    render(
      <ActionBar
        schema={schema}
        currentState="DRAFT"
        availableCommands={['cancel']}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('renders prepare when the backend publishes it as available', () => {
    render(
      <ActionBar
        schema={schema}
        currentState="DRAFT"
        availableCommands={['prepare', 'cancel']}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Preparar' })).toBeEnabled();
  });
});
