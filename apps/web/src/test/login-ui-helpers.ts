import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** Shared selectors for the premium login screen — single source for e2e and component tests. */
export const LOGIN_USUARIO_LABEL = /^usuário/i;
export const LOGIN_SENHA_LABEL = /^senha/i;
export const LOGIN_SUBMIT_BUTTON = /^entrar/i;
export const LOGIN_FORM_HEADING = /acessar conta/i;
export const APP_HOME_HEADING = /^central de operações\b/i;

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
  const heading = await screen.findByRole('heading', { level: 1, name: APP_HOME_HEADING });
  expect(heading).toBeVisible();
  expect(screen.getByRole('main')).toContainElement(heading);
}
