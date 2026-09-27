import { HttpException, Injectable } from '@nestjs/common';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { ALLOWED_FISCAL_TRANSITIONS, FISCAL_STATUSES } from '../../fiscal/domain/fiscal-document';
import type { FiscalDocumentListItemResponse } from '../../fiscal/serializers/fiscal-response.serializer';
import { FiscalAccessService } from '../../fiscal/services/fiscal-access.service';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE FISCAL — documento REJEITADO pela autorizacao fiscal.
 *
 * `REJECTED` e o unico estado persistido de `fis.fiscal_document_status` que exige uma pessoa:
 * e uma excecao persistida (`kind = 'EXCEPTION'`) e NAO e terminal — o proprio dominio declara a
 * transicao permitida a partir dele (`ALLOWED_FISCAL_TRANSITIONS['REJECTED'] = ['DRAFT']`, aplicada
 * por `assertTransition` no repositorio). Os demais estados nao entram na fila: `DRAFT` e o rascunho
 * de quem redigiu, `READY` espera envio, `SUBMITTED` aguarda o gateway de autorizacao (maquina),
 * `AUTHORIZED` e `CANCELLED` sao terminais. `FAILED` NAO existe neste dominio — nao e inventado aqui.
 *
 * Autorizacao: `FiscalAccessService.listDocuments` e a autoridade do modulo FISCAL. Ela exige
 * `fiscal:document:list` NO ESCOPO DA UNIDADE pedida e a consulta do repositorio filtra
 * `d.unit_id = $1` — unidade fora do escopo responde 403 e e DESCARTADA sem deixar sinal (nem
 * contagem, nem item anonimizado). A fonte NAO decide autorizacao e NAO escreve SQL.
 *
 * Cobertura das unidades: as unidades candidatas vem do registro neutro de unidades do
 * `authorization.scope_refs` (`ScopeContextRepository.listUnitScopeRefs`), que NAO concede nada —
 * serve apenas para enumerar candidatos no servidor. Quem autoriza e o modulo fiscal, unidade por
 * unidade (mesmo desenho ja usado pela fonte contabil).
 *
 * NENHUM PRAZO E INVENTADO: `fis.fiscal_documents` nao persiste data de vencimento nem SLA de
 * tratamento, portanto `dueAt` e sempre `null`.
 *
 * DEDUPLICACAO: chave logica `FISCAL:DOCUMENT:<id>` — uma por documento persistido, estavel entre
 * leituras.
 */
@Injectable()
export class FiscalWorkSource implements WorkItemSource {
  readonly domain = 'FISCAL';

  constructor(
    private readonly fiscalAccess: FiscalAccessService,
    private readonly scopeContext: ScopeContextRepository,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const unitIds = await this.scopeContext.listUnitScopeRefs();
    const perUnit = await Promise.all(unitIds.map((unitId) => this.collectUnit(actor, unitId)));
    const items = perUnit.flat().filter(isWorkItem);
    return deduplicateById(items);
  }

  private async collectUnit(actor: WorkItemActor, unitId: string): Promise<WorkItem[]> {
    const rows = await this.rejectedDocuments(actor, unitId);
    if (rows === null) {
      // Unidade fora do escopo do ator: nenhum item, nenhuma contagem, nenhum sinal de existencia.
      return [];
    }
    return rows.map(toFiscalWorkItem).filter(isWorkItem);
  }

  /** Documentos REJEITADOS da unidade. `null` = a unidade nao esta autorizada para este ator. */
  private async rejectedDocuments(
    actor: WorkItemActor,
    unitId: string,
  ): Promise<FiscalDocumentListItemResponse[] | null> {
    const rows: FiscalDocumentListItemResponse[] = [];
    try {
      for (let page = 0; ; page += 1) {
        const listed = await this.fiscalAccess.listDocuments(actor, {
          unitId,
          status: FISCAL_STATUSES.Rejected,
          page,
          pageSize: FISCAL_READ_PAGE_SIZE,
        });
        rows.push(...listed.items);
        if (listed.items.length < FISCAL_READ_PAGE_SIZE) {
          break;
        }
      }
    } catch (error) {
      if (isAccessDenied(error)) {
        return null;
      }
      throw error;
    }
    return rows;
  }
}

/**
 * Tamanho de pagina desta fonte.
 *
 * `pageSize` e validado pelo proprio dominio fiscal em 1..200 (`requireFiscalPageSize`) e NAO existe
 * paginacao por cursor nessa consulta. Ler no teto do dominio e o maximo que o contrato vigente
 * permite; ler menos seria truncar trabalho por escolha propria. A fonte nunca le "quase tudo" em
 * silencio: quando o teto e atingido ela avanca de pagina ate a ultima.
 */
export const FISCAL_READ_PAGE_SIZE = 200;

/** Transicoes REAIS declaradas pelo dominio a partir de `REJECTED` (hoje: revisar para rascunho). */
const REJECTED_NEXT_STATUSES = ALLOWED_FISCAL_TRANSITIONS[FISCAL_STATUSES.Rejected];

/**
 * Normaliza UM documento fiscal persistido em item de trabalho. Puro: nenhuma consulta, nenhuma
 * decisao de acesso.
 *
 * `businessReference`: o dominio fiscal NAO publica codigo humano do documento (nao ha numero/serie
 * em `fis.fiscal_documents`) e o UUID do registro nunca vira referencia. O rotulo humano REAL
 * disponivel e a `description` persistida (NOT NULL, com CHECK de conteudo), escrita por quem emitiu.
 *
 * `occurredAt` e o fato persistido que colocou o documento na fila: a rejeicao (`rejected_at`), com
 * a criacao como fallback. Sem um fato legivel o item e OMITIDO — a fila nao inventa quando aconteceu.
 */
export function toFiscalWorkItem(row: FiscalDocumentListItemResponse): WorkItem | null {
  if (row.status !== FISCAL_STATUSES.Rejected) {
    return null;
  }
  const occurredAt = toIsoDateTime(row.rejectedAt) ?? toIsoDateTime(row.createdAt);
  if (!occurredAt) {
    return null;
  }
  const description = row.description?.trim() ?? '';

  return {
    id: `FISCAL:DOCUMENT:${row.id}`,
    domain: 'FISCAL',
    kind: 'EXCEPTION',
    businessReference: description !== '' ? description : `Documento fiscal de ${row.issuedOn}`,
    title: 'Documento fiscal rejeitado na autorização fiscal',
    contextLabel: `Unidade ${row.unitId} · origem ${row.sourceKind} · emitido em ${row.issuedOn}`,
    status: row.status,
    reason: describeRejection(row),
    occurredAt,
    dueAt: null,
    actionLabel: 'Abrir o documento fiscal rejeitado',
    targetRoute: `/app/fiscal/documents/${row.id}`,
    unitId: row.unitId,
  };
}

/**
 * Motivo em linguagem de negocio usando apenas fatos PERSISTIDOS da linha: a rejeicao, o protocolo e
 * o resultado da ultima tentativa de autorizacao. A mensagem devolvida pelo gateway existe em
 * `fis.fiscal_authorizations.message`, mas NAO faz parte do payload de listagem — busca-la exigiria
 * uma consulta por documento (N+1), o que a fonte nao faz.
 */
export function describeRejection(row: FiscalDocumentListItemResponse): string {
  const rejectedAt = toIsoDateTime(row.rejectedAt);
  const protocol = row.lastProtocolCode?.trim() ?? '';
  const outcome = row.lastAuthorizationOutcome?.trim() ?? '';
  const details = [
    protocol !== '' ? `protocolo ${protocol}` : null,
    outcome !== '' ? `resultado ${outcome}` : null,
  ].filter((part): part is string => part !== null);

  const rejection = `Documento rejeitado pela autorização fiscal${
    rejectedAt ? ` em ${rejectedAt}` : ''
  }${details.length > 0 ? ` (${details.join(', ')})` : ''}`;

  return `${rejection}. ${row.status} não é estado terminal no domínio: a única transição permitida é revisar para ${REJECTED_NEXT_STATUSES.join(
    '/',
  )}, devolvendo o documento a rascunho para correção e novo envio.`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte um timestamp PERSISTIDO em ISO 8601 real; formato inesperado nao vira data.
 *
 * A listagem fiscal devolve `rejected_at`/`created_at` (colunas `timestamptz`) sem normalizar, o que
 * em tempo de execucao chega como `Date` do driver e nao como texto — por isso a normalizacao aceita
 * os dois casos, e `issued_on` (coluna `date`) chega como `YYYY-MM-DD`.
 */
export function toIsoDateTime(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return null;
  }
  if (DATE_ONLY.test(text)) {
    return `${text}T00:00:00.000Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deduplicateById(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const unique: WorkItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

/** Negacao do dominio dono: 403 e a recusa de leitura da unidade pedida. Outra falha nao vira fila vazia. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}
