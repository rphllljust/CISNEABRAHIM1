import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';

/**
 * CONTEXTO FINANCEIRO DO CLIENTE — READ MODEL AUTORITATIVO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE READ MODEL EXISTE, E O QUE ELE NÃO É
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A ficha do Cliente precisa responder "quanto este Cliente deve, e o que está vencido". A
 * tentação — e o defeito que esta onda existe para não cometer — é somar no navegador as páginas
 * de `GET /finance/receivables?clientId=...`. Isso produziria um TOTAL FALSO: uma página paginada
 * não é um conjunto, e o número exibido mudaria conforme o usuário paginasse.
 *
 * A alternativa correta também não é ler `fin.receivables` de dentro do módulo de Clientes: o
 * schema `fin` pertence ao contexto FINANCEIRO, e acesso direto a tabela privada de outro contexto
 * é proibido pelo gate de fronteira do repositório. O read model vive AQUI, no módulo financeiro,
 * que é o dono do dado, e é publicado por endpoint próprio.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A DERIVAÇÃO É A MESMA — E ISSO É O PONTO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Aberto, vencido e a vencer NÃO são colunas: são derivados de `lifecycle` + soma dos lançamentos
 * liquidados não estornados + `due_date` (ver `deriveReceivableStatus` e o comentário no
 * repositório de recebíveis sobre a ausência de coluna `status`). Repetir a fórmula aqui criaria
 * uma SEGUNDA verdade: no dia em que a regra de estorno mudasse, a lista e a ficha discordariam.
 *
 * Por isso os predicados são declarados UMA vez, nesta constante, e usados por este read model.
 * Eles espelham literalmente `receivables.repository.ts`; um teste de integração compara os dois
 * caminhos sobre os mesmos títulos para que a divergência falhe em vez de passar despercebida.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ESCOPO: O CLIENTE NÃO É UMA PORTA LATERAL PARA O FINANCEIRO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O read model recebe o predicado de escopo derivado das CONCESSÕES DO ATOR sobre títulos a
 * receber — nunca de parâmetro de consulta. Um ator que pode ler o Cliente mas não tem concessão
 * financeira recebe `null` (ausência), e não zeros: AUSÊNCIA ≠ ZERO. Sem essa separação, a ficha
 * do Cliente viraria um caminho para descobrir quanto a empresa fatura sem ter `finance:receivable:list`.
 */

/** Predicados de status — os MESMOS do repositório de recebíveis. Ver nota acima. */
const SETTLED_EXPR = `COALESCE((SELECT sum(s.amount) FROM fin.settlements s
    WHERE s.receivable_id = r.id AND s.reversed_at IS NULL), 0)`;
const REMAINING_EXPR = `(r.principal - ${SETTLED_EXPR})`;

const NOT_CANCELLED = `r.lifecycle <> 'CANCELLED'`;
const OVERDUE_PREDICATE = `${NOT_CANCELLED} AND ${REMAINING_EXPR} > 0 AND r.due_date < CURRENT_DATE`;
const DUE_PREDICATE = `${NOT_CANCELLED} AND ${REMAINING_EXPR} > 0 AND r.due_date >= CURRENT_DATE`;
const OPEN_PREDICATE = `${NOT_CANCELLED} AND ${REMAINING_EXPR} > 0`;
const PAID_PREDICATE = `${NOT_CANCELLED} AND ${REMAINING_EXPR} <= 0`;

export type ClientFinancialCurrencyTotals = {
  currencyCode: string;
  /** Títulos com saldo em aberto (vencidos + a vencer). */
  openAmount: string;
  overdueAmount: string;
  /** A vencer: saldo com vencimento ainda não alcançado. */
  dueAmount: string;
  /** Faturado: tudo que não foi cancelado, inclusive o já liquidado. */
  billedAmount: string;
  /** Recebido: soma dos lançamentos liquidados não estornados. */
  receivedAmount: string;
  openCount: number;
  overdueCount: number;
  dueCount: number;
  paidCount: number;
  /**
   * PRÓXIMO VENCIMENTO — o compromisso mais URGENTE entre os títulos com saldo.
   *
   * É `MIN(due_date)` sobre os títulos em aberto, e por isso INCLUI um título já vencido: o
   * vencimento mais antigo em aberto é justamente o que exige ação primeiro. Excluir os vencidos
   * faria o campo pular para um compromisso futuro e esconder o atraso — a leitura inversa da
   * intenção. `overdueCount`/`overdueAmount` continuam sendo o recorte que separa os dois casos.
   *
   * `null` quando não há nenhum título com saldo. NUNCA uma data sentinela.
   */
  nextDueDate: string | null;
};

export type ClientFinancialContext = {
  /**
   * `true` sempre que o servidor respondeu — separa "avaliado" de "não avaliado". O frontend não
   * infere ausência de dado a partir de lista vazia.
   */
  evaluated: boolean;
  /**
   * `false` quando o ator NÃO tem concessão financeira utilizável. Nesse caso os campos abaixo são
   * `null`, e não zero: sem acesso, o valor é DESCONHECIDO, não "R$ 0,00".
   */
  authorized: boolean;
  /** Totais por moeda. Lista vazia = nenhum título; `authorized: false` = não consultado. */
  currencies: ClientFinancialCurrencyTotals[] | null;
  /** Data de referência do cálculo. O vencido é sempre relativo a um "agora" explícito. */
  asOf: string;
};

@Injectable()
export class ClientFinancialContextRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Totais por moeda para UM Cliente, sob o escopo do ator.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * DESLOCAMENTO DOS PLACEHOLDERS DO ESCOPO — DEFEITO REAL, CORRIGIDO AQUI
   * ─────────────────────────────────────────────────────────────────────────────────────────
   *
   * `buildFinancialTitleListFilter` gera placeholders começando em `$1` (ex.: `client_id =
   * ANY($1::uuid[])`). Inserir o id do Cliente como PRIMEIRO parâmetro colide com esse `$1`: o
   * escopo passaria a comparar `client_id` contra o id do Cliente consultado, e a consulta
   * falharia com erro de tipo (`uuid` para `text[]`) — ou, pior, devolveria um recorte silenciosa
   * e erradamente estreito.
   *
   * A correção é DESLOCAR os placeholders do escopo pelo número de parâmetros já usados antes
   * dele, de modo que cada `$n` continue apontando para o seu próprio valor. O deslocamento é
   * aplicado por regex sobre `$n` — o predicado é texto gerado pelo próprio serviço de escopo, e
   * não entrada de usuário.
   */
  private shiftPlaceholders(clause: string, offset: number): string {
    if (offset === 0) {
      return clause;
    }
    return clause.replace(/\$(\d+)/g, (_match, index: string) => `$${Number(index) + offset}`);
  }

  async summarizeForClient(input: {
    clientId: string;
    scope: ScopeSqlPredicate;
  }): Promise<ClientFinancialCurrencyTotals[]> {
    const params: unknown[] = [input.clientId];
    const shiftedScope = this.shiftPlaceholders(input.scope.clause, params.length);
    params.push(...input.scope.params);
    const where: string[] = [`r.client_id = $1`, shiftedScope];

    const result = await this.pool().query<{
      currency_code: string;
      open_amount: string;
      overdue_amount: string;
      due_amount: string;
      billed_amount: string;
      received_amount: string;
      open_count: string;
      overdue_count: string;
      due_count: string;
      paid_count: string;
      next_due_date: string | null;
    }>(
      /*
       * UMA consulta agregada, e não cinco contagens.
       *
       * `FILTER (WHERE ...)` calcula cada recorte sobre o MESMO conjunto, dentro da mesma varredura.
       * A alternativa — uma consulta por status — multiplicaria por cinco o custo e, pior, poderia
       * enxergar estados diferentes se um título fosse liquidado entre elas.
       *
       * O próximo vencimento é `MIN(due_date)` apenas entre os títulos com SALDO — um título já
       * pago não é "o próximo a vencer", e incluí-lo faria a ficha prometer um compromisso que não
       * existe.
       */
      `SELECT
         r.currency_code,
         COALESCE(sum(${REMAINING_EXPR}) FILTER (WHERE ${OPEN_PREDICATE}), 0)::text     AS open_amount,
         COALESCE(sum(${REMAINING_EXPR}) FILTER (WHERE ${OVERDUE_PREDICATE}), 0)::text  AS overdue_amount,
         COALESCE(sum(${REMAINING_EXPR}) FILTER (WHERE ${DUE_PREDICATE}), 0)::text      AS due_amount,
         COALESCE(sum(r.principal)    FILTER (WHERE ${NOT_CANCELLED}), 0)::text         AS billed_amount,
         COALESCE(sum(${SETTLED_EXPR}) FILTER (WHERE ${NOT_CANCELLED}), 0)::text        AS received_amount,
         count(*) FILTER (WHERE ${OPEN_PREDICATE})::text                               AS open_count,
         count(*) FILTER (WHERE ${OVERDUE_PREDICATE})::text                            AS overdue_count,
         count(*) FILTER (WHERE ${DUE_PREDICATE})::text                                AS due_count,
         count(*) FILTER (WHERE ${PAID_PREDICATE})::text                               AS paid_count,
         min(r.due_date) FILTER (WHERE ${OPEN_PREDICATE})::text                        AS next_due_date
       FROM fin.receivables r
       WHERE ${where.join(' AND ')}
       GROUP BY r.currency_code
       ORDER BY r.currency_code ASC`,
      params,
    );

    return result.rows.map((row) => ({
      currencyCode: row.currency_code,
      openAmount: row.open_amount,
      overdueAmount: row.overdue_amount,
      dueAmount: row.due_amount,
      billedAmount: row.billed_amount,
      receivedAmount: row.received_amount,
      openCount: Number(row.open_count ?? '0'),
      overdueCount: Number(row.overdue_count ?? '0'),
      dueCount: Number(row.due_count ?? '0'),
      paidCount: Number(row.paid_count ?? '0'),
      nextDueDate: row.next_due_date,
    }));
  }
}
