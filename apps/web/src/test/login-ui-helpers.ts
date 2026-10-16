import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** Shared selectors for the premium login screen — single source for e2e and component tests. */
export const LOGIN_USUARIO_LABEL = /^usuário/i;
export const LOGIN_SENHA_LABEL = /^senha/i;
export const LOGIN_SUBMIT_BUTTON = /^entrar/i;
export const LOGIN_FORM_HEADING = /acessar conta/i;

type LoginCredentials = {
  login: string;
  password: string;
};

const DEFAULT_CREDENTIALS: LoginCredentials = {
  login: 'user@test',
  password: 'Password1!',
};

export async function submitLoginForm(
  user: UserEvent,
  credentials: LoginCredentials = DEFAULT_CREDENTIALS,
): Promise<void> {
  await user.type(await screen.findByLabelText(LOGIN_USUARIO_LABEL), credentials.login);
  await user.type(screen.getByLabelText(LOGIN_SENHA_LABEL), credentials.password);
  await user.click(screen.getByRole('button', { name: LOGIN_SUBMIT_BUTTON }));
}

export async function loginAndReachApp(user: UserEvent): Promise<void> {
  await submitLoginForm(user);
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Central de operações' })).toBeInTheDocument();
  });
}
