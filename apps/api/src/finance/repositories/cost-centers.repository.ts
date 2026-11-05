import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { Pool } from 'pg';

/**
 * CENTRO DE CUSTO — referencia para quem ESCOLHE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE REPOSITORIO EXISTE
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * `fin.payables.cost_center_id` e `fin.expenses.cost_center_id` sao `uuid NOT NULL` sem
 * `REFERENCES`. Antes da migration 0118 nao existia tabela de centro de custo em nenhum ponto
 * da cadeia: o valor so podia vir de literal, e era o que as suites faziam
 * (`costCenterId: crypto.randomUUID()`).
 *
 * A `CISNE_FINISH_MATRIX` registrava isso como `PARK: HUMAN_LOOKUP_API_GAP` em quatro
 * consumidores: conferencia de compra, nota de fornecedor, apuracao fiscal e despesa. Todos
 * exigiam do operador um identificador que nenhuma tela podia oferecer.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * LIMITE DECLARADO
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este repositorio NAO cria taxonomia de centro de custo. Nenhuma linha e semeada: a
 * classificacao real de gasto e decisao empresarial, nao engenharia (AGENTS.md §24).
 * A leitura e somente leitura; a criacao passa pelo servico, que valida e audita.
 */

export type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ListCostCentersInput = {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
};

export type CreateCostCenterPersistenceInput = {
  code: string;
  name: string;
  actorIdentityId: string;
};

const COST_CENTER_RETURNING = `
  id, code, name, status, created_at, updated_at
`;

@Injectable()
export class CostCentersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Listagem paginada com busca por codigo OU nome.
   *
   * `search` e parametrizado: nenhum nome de coluna e nenhum fragmento de SQL vem do cliente.
   * `status` ja chega validado contra o conjunto fechado do dominio — aqui ele so compara.
   */
  async list(input: ListCostCentersInput): Promise<CostCenterRow[]> {
    const { where, parameters } = this.buildFilter(input);
    const paged = [...parameters, input.limit, input.offset];

    const result = await this.pool().query<CostCenterRow>(
      `SELECT ${COST_CENTER_RETURNING}
         FROM fin.cost_centers
         ${where}
        ORDER BY code ASC
        LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
      paged,
    );
    return result.rows;
  }

  /**
   * Total do MESMO recorte da listagem.
   *
   * Chamado separadamente (e nao como `COUNT(*) OVER ()`) para manter o shape do contrato
   * `{ items, limit, offset, total, totalPages }` igual ao das demais listagens do Financeiro.
   * As duas consultas compartilham `buildFilter`, entao nao podem divergir.
   */
  async count(input: Pick<ListCostCentersInput, 'search' | 'status'>): Promise<number> {
    const { where, parameters } = this.buildFilter(input);
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM fin.cost_centers ${where}`,
      parameters,
    );
    return Number.parseInt(result.rows[0]?.total ?? '0', 10);
  }

  async findById(costCenterId: string): Promise<CostCenterRow | null> {
    const result = await this.pool().query<CostCenterRow>(
      `SELECT ${COST_CENTER_RETURNING} FROM fin.cost_centers WHERE id = $1`,
      [costCenterId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Existencia por id, usada para VALIDAR a referencia antes de persistir um titulo.
   *
   * Sem esta checagem, `cost_center_id` continuaria aceitando qualquer UUID — a lacuna trocaria
   * de forma (de "nao consigo escolher" para "escolhi e gravou lixo") sem sair do lugar.
   */
  async exists(costCenterId: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM fin.cost_centers WHERE id = $1) AS exists`,
      [costCenterId],
    );
    return result.rows[0]?.exists === true;
  }

  async create(input: CreateCostCenterPersistenceInput): Promise<CostCenterRow> {
    const result = await this.pool().query<CostCenterRow>(
      `INSERT INTO fin.cost_centers (code, name, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, $3, $3)
       RETURNING ${COST_CENTER_RETURNING}`,
      [input.code, input.name, input.actorIdentityId],
    );
    return result.rows[0]!;
  }

  /** Unica fonte do recorte — listagem e contagem nao podem divergir por construcao. */
  private buildFilter(input: Pick<ListCostCentersInput, 'search' | 'status'>): {
    where: string;
    parameters: unknown[];
  } {
    const conditions: string[] = [];
    const parameters: unknown[] = [];

    if (input.search) {
      parameters.push(`%${input.search}%`);
      conditions.push(`(code ILIKE $${parameters.length} OR name ILIKE $${parameters.length})`);
    }
    if (input.status) {
      parameters.push(input.status);
      conditions.push(`status = $${parameters.length}`);
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      parameters,
    };
  }
}
