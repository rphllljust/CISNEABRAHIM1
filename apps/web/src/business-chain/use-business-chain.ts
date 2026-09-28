import { useCallback } from 'react';
import { useAuth } from '../auth/context/AuthProvider';
import { useBackofficeQuery } from '../financial-ui/useBackofficeQuery';
import { getBusinessChain } from './api/business-chain-api';
import type { BusinessChain, BusinessChainAnchorKind } from './types';

/**
 * Leitura da cadeia empresarial do objeto.
 *
 * UMA requisicao por object page — nunca uma por no. O servidor devolve a linhagem ja
 * autorizada e ja ordenada; o cliente nao filtra, nao completa e nao infere nada.
 *
 * Falha de leitura NAO vira cadeia vazia silenciosa: `phase` distingue negacao, erro e
 * ausencia, e o painel diz exatamente o que houve.
 */
export function useBusinessChain(
  anchorKind: BusinessChainAnchorKind,
  anchorId: string,
): {
  chain: BusinessChain | null;
  phase: 'idle' | 'loading' | 'denied' | 'error' | 'ready';
  message: string | null;
  retry: () => void;
} {
  const { status } = useAuth();
  const enabled = status === 'authenticated' && anchorId.trim().length > 0;

  const loader = useCallback(
    (signal?: AbortSignal) => getBusinessChain(anchorKind, anchorId, signal),
    [anchorKind, anchorId],
  );

  const { state, reload } = useBackofficeQuery<BusinessChain>({
    loader,
    enabled,
    mapError: () => 'Não foi possível carregar a cadeia deste registro.',
  });

  return {
    chain: state.phase === 'ready' ? state.data : null,
    phase: state.phase,
    message: state.phase === 'error' ? state.message : null,
    retry: () => void reload(),
  };
}
