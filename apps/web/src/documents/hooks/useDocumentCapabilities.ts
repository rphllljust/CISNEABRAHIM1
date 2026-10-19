import { useMemo } from 'react';
import type { DocumentCapabilities } from '../types/document.types';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo disparava POST multipart e criação de versão com IDs sintéticos a cada montagem
 * da tela para inferir permissão, gerando falhas reais em produção sem tentativa do operador.
 * `/me` já publica os grants efetivos da sessão; a UI apenas projeta esse contrato. O backend
 * continua sendo a barreira autoritativa.
 */
const DEFAULT_CAPABILITIES: DocumentCapabilities = {
  canCreate: false,
  canRead: false,
  canList: false,
  canUploadVersion: false,
  canDownload: false,
};

export function useDocumentCapabilities(): { capabilities: DocumentCapabilities; loading: boolean } {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<DocumentCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return DEFAULT_CAPABILITIES;
    }
    return {
      canCreate: session.can('documents:document:create'),
      canRead: session.can('documents:document:read'),
      canList: session.can('documents:document:list'),
      canUploadVersion: session.can('documents:document:upload-version'),
      canDownload: session.can('documents:document:download'),
    };
  }, [authStatus, session]);

  return {
    capabilities,
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (session.status === 'idle' || session.status === 'loading')),
  };
}
