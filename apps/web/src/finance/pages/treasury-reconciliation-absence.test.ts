import { describe, expect, it } from 'vitest';
import { canSelectTreasuryAccounts, movementCountOrUnknown, transferDestinationPlaceholder } from './treasury-engine-rows';

describe('tesouraria: ausência não é zero', () => {
  it('mantém desconhecido quando a reconciliação não foi lida', () => {
    expect(movementCountOrUnknown(null)).toBeNull();
  });

  it('mantém zero quando a API informou zero movimentos', () => {
    expect(movementCountOrUnknown({ movementCount: 0 })).toBe(0);
  });

  it('transporta contagem positiva do servidor', () => {
    expect(movementCountOrUnknown({ movementCount: 7 })).toBe(7);
  });
});


describe('tesouraria: estados da consulta de destinos', () => {
  it('não interpreta erro de API como ausência de contas', () => {
    expect(transferDestinationPlaceholder('error', 0)).toBe('Falha ao consultar contas de destino');
  });

  it('distingue carregamento e acesso negado', () => {
    expect(transferDestinationPlaceholder('loading', 0)).toBe('Carregando contas de destino…');
    expect(transferDestinationPlaceholder('denied', 0)).toBe('Sem permissão para consultar contas de destino');
  });

  it('só mostra lista vazia após resposta válida da API', () => {
    expect(transferDestinationPlaceholder('ready', 0)).toBe('Nenhuma outra conta ativa disponível');
    expect(transferDestinationPlaceholder('ready', 2)).toBe('Selecione…');
  });
});

describe('tesouraria: estorno não aceita seleção sem contas consultadas', () => {
  it.each(['idle', 'loading', 'error', 'denied'] as const)(
    'bloqueia seletores durante %s',
    (phase) => {
      expect(canSelectTreasuryAccounts(phase)).toBe(false);
      expect(transferDestinationPlaceholder(phase, 0)).not.toBe('Nenhuma outra conta ativa disponível');
    },
  );

  it('habilita seletores apenas após resposta válida', () => {
    expect(canSelectTreasuryAccounts('ready')).toBe(true);
  });
});
