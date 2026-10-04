import { getApiBaseUrl, isNetworkError } from '../auth/api/auth-api';
import { tokenStore } from '../auth/storage/token-store';
import type { MetaEntitySchema, MetaField, MetaView } from './types';

/**
 * ESCRITA de metadados — a metade que faltava da engine.
 *
 * Até aqui a engine só LIA `meta.*`. Um explorador read-write precisa gravar, e a pergunta
 * honesta é: o canal existe? Ele NÃO existe. Verificado contra o controller real
 * (`apps/api/src/meta/meta.controller.ts`), que publica exatamente 5 rotas:
 *
 *   GET  /api/v1/meta
 *   GET  /api/v1/meta/:entity
 *   GET  /api/v1/meta/:entity/fields
 *   GET  /api/v1/meta/:entity/views/:viewType
 *   GET  /api/v1/meta/:entity/workflow
 *
 * Nenhuma é POST/PATCH/PUT/DELETE. Não há `PATCH /meta/:entity/fields/:name`, nem rota para
 * views. `apps/api/` é somente leitura nesta track, então o canal não é criado aqui —
 * ele é DECLARADO como ausente (GAP_DE_API) e a UI mostra o gap em vez de fingir sucesso.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO FAZ, ENTÃO
 *
 * Ele TENTA a escrita no caminho que o contrato exigiria (`PATCH /meta/:entity/fields/:name`).
 * Se o backend um dia publicar exatamente esse endpoint, a persistência passa a funcionar sem
 * nenhuma outra alteração de código — o cliente já fala o protocolo. Enquanto não publicar, a
 * resposta é 404/405 e o resultado é `unsupported`, que a UI traduz como GAP visível.
 *
 * TENTAR E REPORTAR é melhor que (a) não tentar, e deixar a UI sem saber se falhou; ou
 * (b) inventar um endpoint que não existe. `fetch` contra uma rota inexistente é inofensivo e
 * devolve a verdade do servidor.
 */

export type MetadataWriteOutcome =
  | { status: 'persisted' }
  | { status: 'unsupported'; endpoint: string; httpStatus: number | null; detail: string }
  | { status: 'denied'; detail: string }
  | { status: 'failed'; detail: string };

/** Campos de `meta.fields` que fazem sentido editar. `name` NÃO: renomear quebraria a coluna. */
export type EditableFieldPatch = {
  label?: string;
  /**
   * Tipo do campo.
   *
   * SEM a união `FieldType` de propósito: o valor chega de um `<input>`/`<select>` como
   * `string`, e estreitá-lo aqui exigiria uma asserção na fronteira — exatamente onde a
   * validação deve acontecer. Quem decide se o tipo é válido é `meta.fields.type_check` no
   * banco; o cliente não é boundary de integridade.
   */
  type?: string;
  required?: boolean;
  readOnly?: boolean;
  permLevel?: number;
  inForm?: boolean;
  inList?: boolean;
  inFilter?: boolean;
  inSearch?: boolean;
  listOrder?: number;
  fieldOrder?: number;
  aggregation?: string | null;
};

/** Patch de `meta.views`. O `layout` é JSON livre por contrato. */
export type EditableViewPatch = {
  label?: string;
  isDefault?: boolean;
  layout?: Record<string, unknown>;
  rowAccent?: unknown;
};

/**
 * Endpoint que a escrita EXIGIRIA.
 *
 * Exportado para que o relatório e a UI citem o mesmo caminho, em vez de repetir a string em
 * dois lugares e divergirem.
 */
export const FIELD_WRITE_PATH = (entity: string, fieldName: string): string =>
  `/api/v1/meta/${encodeURIComponent(entity)}/fields/${encodeURIComponent(fieldName)}`;

export const VIEW_WRITE_PATH = (entity: string, viewType: string): string =>
  `/api/v1/meta/${encodeURIComponent(entity)}/views/${encodeURIComponent(viewType)}`;

async function writeJson(
  path: string,
  body: unknown,
): Promise<MetadataWriteOutcome> {
  const accessToken = tokenStore.getAccessToken();
  if (!accessToken) {
    return { status: 'denied', detail: 'Sem sessão: nenhum token de acesso disponível.' };
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (isNetworkError(error)) {
      return { status: 'failed', detail: 'Falha de rede ao gravar o metadado.' };
    }
    return { status: 'failed', detail: 'Falha inesperada ao gravar o metadado.' };
  }

  if (response.ok) {
    return { status: 'persisted' };
  }
  // 401/403 = o ator não pode escrever (diferente de "a rota não existe").
  if (response.status === 401 || response.status === 403) {
    return {
      status: 'denied',
      detail: `O servidor recusou a escrita (HTTP ${response.status}).`,
    };
  }
  /*
   * 404 = rota inexistente OU entidade/campo inexistente; ambos são "não persistiu". 405 =
   * a rota existe mas não aceita PATCH. São a MESMA conclusão operacional (não há canal de
   * escrita) e a UI não deve fazer o operador distinguir as duas.
   */
  return {
    status: 'unsupported',
    endpoint: path,
    httpStatus: response.status,
    detail:
      response.status === 404
        ? 'A API de metadados não publica rota de escrita (HTTP 404).'
        : response.status === 405
          ? 'A rota existe mas não aceita PATCH (HTTP 405).'
          : `A API respondeu HTTP ${response.status} e nada foi gravado.`,
  };
}

/** Grava um patch de campo. Devolve o RESULTADO, nunca lança — a UI decide o que exibir. */
export function patchField(
  entity: string,
  fieldName: string,
  patch: EditableFieldPatch,
): Promise<MetadataWriteOutcome> {
  return writeJson(FIELD_WRITE_PATH(entity, fieldName), patch);
}

/** Grava um patch de view (layout/label/default). Mesmo contrato de resultado. */
export function patchView(
  entity: string,
  viewType: string,
  patch: EditableViewPatch,
): Promise<MetadataWriteOutcome> {
  return writeJson(VIEW_WRITE_PATH(entity, viewType), patch);
}

/**
 * Aplica o patch ao schema em memória.
 *
 * Existe para o caminho DEGRADADO: sem canal de escrita, a UI ainda mostra o efeito da
 * alteração, marcado como NÃO PERSISTIDO. Isso é útil de verdade — o administrador vê o
 * resultado antes de decidir se vale abrir o canal — e é honesto, porque o selo
 * "não persistido" acompanha o estado.
 */
export function applyFieldPatch(
  schema: MetaEntitySchema,
  fieldName: string,
  patch: Partial<MetaField>,
): MetaEntitySchema {
  return {
    ...schema,
    fields: schema.fields.map((field) =>
      field.name === fieldName ? { ...field, ...patch } : field,
    ),
  };
}

export function applyViewPatch(
  schema: MetaEntitySchema,
  viewType: string,
  patch: Partial<MetaView>,
): MetaEntitySchema {
  return {
    ...schema,
    views: schema.views.map((view) =>
      view.viewType === viewType ? { ...view, ...patch } : view,
    ),
  };
}
