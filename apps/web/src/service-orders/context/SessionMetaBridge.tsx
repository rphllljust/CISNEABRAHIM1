import type { ReactNode } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { SessionMetaProvider } from './SessionMetaProvider';

/**
 * Ponte entre o `AuthProvider` (sessão técnica) e o `SessionMetaProvider`
 * (identidade, permissões e catálogo de comandos).
 *
 * Existe porque o `SessionMetaProvider` precisa saber se há sessão autenticada antes de
 * chamar `/me` e `/command-catalog`, e `useAuth` só pode ser lido ABAIXO do `AuthProvider`.
 * Sem esta ponte, o provider de metadados não teria como ser montado no mesmo nível.
 *
 * Cobre a árvore inteira (inclusive `/login`): a hidratação só dispara quando o status é
 * `authenticated`, então em rota pública nada é chamado.
 */
export function SessionMetaBridge({ children }: { children?: ReactNode }) {
  const { status } = useAuth();

  return (
    <SessionMetaProvider enabled={status === 'authenticated'}>{children}</SessionMetaProvider>
  );
}
