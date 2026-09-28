import { describe, expect, it } from 'vitest';
import {
  CLIENTS_ALLOWED_FILTERS,
  clientViewConfig,
  clientViewToParams,
  hasSavableViewConfig,
} from './client-view-config';
import { sanitizeSmartListConfig } from '../../operator';
import { CLIENT_LIST_SORTS } from '../types/client.types';
import type { ClientListParams } from './client-list-params';

/**
 * COMERCIAL — visões salvas nunca gravam o termo de busca.
 */

const emptyParams: ClientListParams = {
  q: '',
  status: '',
  sort: CLIENT_LIST_SORTS.LegalName,
  direction: 'asc',
  purchaseOrderRequirement: '',
};

describe('visão salva de Clientes', () => {
  it('NÃO inclui o termo de busca na configuração persistível', () => {
    const config = clientViewConfig({
      ...emptyParams,
      q: 'Amaggi',
      status: 'ACTIVE',
    });

    expect(config.filters).toEqual({ status: 'ACTIVE' });
    // O termo de busca (razão social/CNPJ digitado) não existe na visão.
    expect(JSON.stringify(config)).not.toContain('Amaggi');
  });

  it('rejeita persistir busca livre mesmo se alguém tentar injetá-la', () => {
    const forged = sanitizeSmartListConfig(
      {
        filters: { q: 'Amaggi' },
        sortKey: null,
        sortDirection: 'asc',
        groupKey: null,
      },
      CLIENTS_ALLOWED_FILTERS,
    );
    // `q` não é chave declarada da lista: a visão é recusada, não salva parcialmente.
    expect(forged).toBeNull();
  });

  it('aceita apenas status, coluna e direção que o domínio realmente oferece', () => {
    expect(
      sanitizeSmartListConfig(
        {
          filters: { status: 'ACTIVE' },
          sortKey: CLIENT_LIST_SORTS.UpdatedAt,
          sortDirection: 'desc',
          groupKey: null,
        },
        CLIENTS_ALLOWED_FILTERS,
      ),
    ).not.toBeNull();

    expect(
      sanitizeSmartListConfig(
        { filters: { status: 'ARQUIVADO' }, sortKey: null, sortDirection: 'asc', groupKey: null },
        CLIENTS_ALLOWED_FILTERS,
      ),
    ).toBeNull();

    expect(
      sanitizeSmartListConfig(
        {
          filters: { status: 'ACTIVE' },
          sortKey: 'razaoSocial',
          sortDirection: 'asc',
          groupKey: null,
        },
        CLIENTS_ALLOWED_FILTERS,
      )?.sortKey,
    ).toBeNull();
  });

  it('só considera "há visão a salvar" quando existe configuração enumerada', () => {
    expect(hasSavableViewConfig(emptyParams)).toBe(false);
    expect(hasSavableViewConfig({ ...emptyParams, q: 'Amaggi' })).toBe(false);
    expect(hasSavableViewConfig({ ...emptyParams, status: 'INACTIVE' })).toBe(true);
    expect(hasSavableViewConfig({ ...emptyParams, sort: CLIENT_LIST_SORTS.UpdatedAt })).toBe(true);
  });

  it('aplicar uma visão devolve parâmetros válidos e não injeta texto livre', () => {
    const params = clientViewToParams({
      filters: { status: 'INACTIVE' },
      sortKey: CLIENT_LIST_SORTS.UpdatedAt,
      sortDirection: 'desc',
      groupKey: null,
    });

    expect(params.status).toBe('INACTIVE');
    expect(params.sort).toBe(CLIENT_LIST_SORTS.UpdatedAt);
    expect(params.direction).toBe('desc');
    // Aplicar visão não define `q`: o texto do operador permanece intocado.
    expect(params).not.toHaveProperty('q');
  });

  it('status desconhecido na visão não vira filtro aplicado', () => {
    const params = clientViewToParams({
      filters: { status: 'ARQUIVADO' },
      sortKey: null,
      sortDirection: 'asc',
      groupKey: null,
    });
    expect(params.status).toBe('');
  });
});
