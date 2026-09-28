import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestsFetchMock } from '../../test/requests-fetch-mock';
import { renderRequestRoutes } from '../../test/render-request-routes';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';

describe('ServiceRequestEditPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows version conflict and reload option', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({ versionConflictOnUpdate: true, requestUpdateAllowed: true }),
    );
    const user = userEvent.setup();
    renderRequestRoutes('/app/requests/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/edit');

    const description = await screen.findByLabelText(/^descrição/i, { selector: 'textarea' });
    expect(description).toBeInTheDocument();

    await user.clear(description);
    await user.type(description, 'Descrição atualizada');
    await user.click(screen.getByRole('button', { name: /salvar rascunho/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /recarregar dados atuais/i })).toBeInTheDocument();
    });
  });
});
