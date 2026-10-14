import { RENDERABLE_VIEW_TYPES } from './DynamicViewHost';
import type { MetaEntitySchema, MetaField, MetaView } from './types';

/**
 * UMA VIEW SÓ É EXPOSTA SE PUDER SER PROVADA FUNCIONAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * `RENDERABLE_VIEW_TYPES` responde "a engine sabe desenhar este tipo?". A pergunta que
 * importa para o operador é outra: "esta view, NESTA entidade, com ESTE layout, vai mostrar
 * alguma coisa?". As duas respostas divergem, e a divergência é visível em produção.
 *
 * `meta.views` de `service-orders` declara `tree` com
 * `{"parentField":"unit_id","labelField":"order_number"}`. A engine desenha a árvore — e o
 * que aparece é uma floresta de um nível só, porque `so.service_orders` não tem coluna
 * auto-referente: `unit_id` não aponta para outra ordem de serviço, aponta para uma unidade.
 * A aba abre, pinta, responde ao clique, e o agrupamento que ela promete não existe. O
 * operador vê "Árvore por unidade" e conclui que a carteira é plana por unidade — quando o
 * que houve foi uma view declarada sobre um eixo que a entidade não possui.
 *
 * O MESMO RACIOCÍNIO VALE PARA TODA VIEW DECLARATIVA. Uma view é um par
 * (tipo, eixo-do-layout) e o eixo precisa EXISTIR no payload, senão a aba é decoração.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA FUNÇÃO **NÃO** FAZ
 *
 * Não remove aba por ausência de DADO. Entidade sem nenhuma linha em produção continua com
 * todas as suas views: "não há registro ainda" é um estado legítimo e informativo, e a tela
 * já sabe dizê-lo. O que ela remove é aba cujo EIXO não existe — condição que nenhum volume
 * de dado corrige, porque é declaração errada, não carteira vazia.
 *
 * Também não opina sobre `list` e `kanban`: as duas se sustentam sobre campos que o
 * contrato de listagem publica (`schema.fields` com `in_list`), e a ausência deles é
 * detectada pela própria engine na hora de desenhar as colunas.
 */

export type ViewCapabilityVerdict = {
  viewType: string;
  label: string;
  functional: boolean;
  /**
   * Nome do campo/eixo que a view precisa e não encontrou. `null` quando a view é funcional
   * ou quando a recusa não se deve a um campo faltante.
   */
  missingAxis: string | null;
  /** Motivo em uma frase, para log e para o aviso de tela. */
  reason: string;
};

/**
 * Campos que a view pode agrupar SEM que existam em `schema.fields`.
 *
 * São colunas que o contrato de listagem publica e o metadado não registra como campo — o
 * mesmo conjunto que `service-order-engine-rows.ts` projeta para a grade. Sem esta lista, a
 * view `tree` por unidade seria recusada por um eixo que a linha REALMENTE traz.
 */
const PAYLOAD_ONLY_FIELDS: readonly string[] = [
  'id',
  'status',
  'unit_id',
  'client_id',
  'client_snapshot',
  'order_number',
  'deadline_at',
  'created_at',
  'updated_at',
  'row_version',
  'assigned_workforce_name',
  'assigned_workforce_code',
];

function fieldExists(schema: MetaEntitySchema, field: string): boolean {
  if (PAYLOAD_ONLY_FIELDS.includes(field)) {
    return true;
  }
  return schema.fields.some((candidate: MetaField) => candidate.name === field);
}

function readAxis(layout: Record<string, unknown>, key: string): string | null {
  const raw = layout[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * O EIXO DA ÁRVORE NÃO PODE SER UMA COLUNA DE IDENTIDADE EXTERNA.
 *
 * `parentField` promete "este campo aponta para o PAI dentro desta mesma entidade". Um campo
 * que aponta para FORA (`unit_id` → unidade, `client_id` → cliente) produz uma floresta rasa:
 * cada linha vira raiz porque nenhum pai está na página — e o resultado é uma lista plana com
 * recuo, que é pior que a lista, porque mente sobre a estrutura.
 *
 * A engine já trata órfão como raiz de propósito (`DynamicTree`: "ÓRFÃO TAMBÉM É DADO, NÃO
 * LIXO"). O tratamento está certo para o dado ruim; o que não pode existir é a DECLARAÇÃO
 * que garante o caso ruim em 100% das linhas.
 */
const SELF_REFERENCE_SUFFIXES: readonly string[] = ['_id', '_pk'];

function looksSelfReferential(schema: MetaEntitySchema, parentField: string): boolean {
  /*
   * `id` e `parent_id` são auto-referentes por definição — o nome é o contrato.
   */
  if (parentField === 'id' || parentField === 'parent_id') {
    return true;
  }
  /*
   * QUALQUER OUTRO `*_id` APONTA PARA FORA.
   *
   * `MetaField` (o tipo que o servidor entrega) NÃO publica a entidade referenciada: existe
   * `name`, `label`, `type` e as flags de canal, e nada mais. Sem essa informação, a única
   * leitura sustentada é a CONVENÇÃO do schema: nesta base, `<algo>_id` é chave estrangeira
   * para outra tabela — `unit_id`, `client_id`, `contract_id`. Nenhuma delas é eixo de
   * hierarquia da própria entidade.
   *
   * A recusa é o comportamento SEGURO. Uma árvore ausente é uma perda VISÍVEL — o operador
   * perde uma aba. Uma árvore rasa é uma afirmação FALSA sobre a estrutura da carteira: as
   * abas abrem, cada linha vira raiz e a tela comunica "a carteira não tem hierarquia",
   * quando o que houve foi uma view declarada sobre um eixo que aponta para fora.
   *
   * Se um dia a entidade ganhar coluna auto-referente de verdade, ela virá como `parent_id`
   * (aceito acima) ou o metadado passará a publicar a entidade referenciada — e esta função
   * é o único ponto que precisa mudar.
   */
  const declared = schema.fields.find((candidate: MetaField) => candidate.name === parentField);
  if (!declared) {
    // Campo que o metadado nem registra: não é eixo de hierarquia desta entidade.
    return false;
  }
  return !SELF_REFERENCE_SUFFIXES.some((suffix) => parentField.endsWith(suffix));
}

function assessView(schema: MetaEntitySchema, view: MetaView): ViewCapabilityVerdict {
  const layout = (view.layout ?? {}) as Record<string, unknown>;
  const label = view.label || view.viewType;

  if (!(RENDERABLE_VIEW_TYPES as readonly string[]).includes(view.viewType)) {
    return {
      viewType: view.viewType,
      label,
      functional: false,
      missingAxis: null,
      reason: `A engine não possui renderizador para "${view.viewType}".`,
    };
  }

  switch (view.viewType) {
    case 'tree': {
      const parentField = readAxis(layout, 'parentField');
      if (!parentField) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: 'parentField',
          reason: 'A view de árvore não declara `layout.parentField`.',
        };
      }
      if (!fieldExists(schema, parentField)) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: parentField,
          reason: `A view de árvore agrupa por "${parentField}", que não existe no payload desta entidade.`,
        };
      }
      if (!looksSelfReferential(schema, parentField)) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: parentField,
          reason: `A view de árvore usa "${parentField}" como pai, mas esse campo aponta para outra entidade — a hierarquia resultante teria um nível só.`,
        };
      }
      return {
        viewType: view.viewType,
        label,
        functional: true,
        missingAxis: null,
        reason: `Hierarquia por "${parentField}".`,
      };
    }
    case 'graph': {
      const categoryField = readAxis(layout, 'categoryField');
      if (!categoryField) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: 'categoryField',
          reason: 'A view de gráfico não declara `layout.categoryField`.',
        };
      }
      if (!fieldExists(schema, categoryField)) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: categoryField,
          reason: `A view de gráfico agrupa por "${categoryField}", que não existe no payload desta entidade.`,
        };
      }
      return {
        viewType: view.viewType,
        label,
        functional: true,
        missingAxis: null,
        reason: `Contagem por "${categoryField}".`,
      };
    }
    case 'pivot': {
      const groupBy = layout.groupBy;
      /*
       * `layout` é JSON do banco, então `groupBy` chega como `unknown` e `Array.isArray`
       * estreita para `any[]` — o `any` vazaria para `find`, para `axis` e daí para a
       * mensagem de erro. `readAxis` é o portão: só passa string não vazia.
       */
      const axis: string | null = Array.isArray(groupBy)
        ? (groupBy as unknown[]).map((candidate) => readAxis({ axis: candidate }, 'axis'))[0] ??
          null
        : typeof groupBy === 'string'
          ? readAxis({ axis: groupBy }, 'axis')
          : null;
      if (!axis) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: 'groupBy',
          reason: 'A tabela dinâmica não declara `layout.groupBy`.',
        };
      }
      if (!fieldExists(schema, axis)) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: axis,
          reason: `A tabela dinâmica agrupa por "${axis}", que não existe no payload desta entidade.`,
        };
      }
      return {
        viewType: view.viewType,
        label,
        functional: true,
        missingAxis: null,
        reason: `Cruzamento por "${axis}".`,
      };
    }
    case 'calendar': {
      const dateField = readAxis(layout, 'dateField') ?? readAxis(layout, 'startField');
      if (!dateField) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: 'dateField',
          reason: 'A agenda não declara `layout.dateField`.',
        };
      }
      if (!fieldExists(schema, dateField)) {
        return {
          viewType: view.viewType,
          label,
          functional: false,
          missingAxis: dateField,
          reason: `A agenda usa "${dateField}", que não existe no payload desta entidade.`,
        };
      }
      return {
        viewType: view.viewType,
        label,
        functional: true,
        missingAxis: null,
        reason: `Datas por "${dateField}".`,
      };
    }
    default:
      // `list`, `kanban` e `form`: sustentadas pelas colunas do contrato de listagem.
      return {
        viewType: view.viewType,
        label,
        functional: true,
        missingAxis: null,
        reason: 'Superfície de coleção sustentada pelas colunas do contrato.',
      };
  }
}

/**
 * AUDITA TODAS as views declaradas para a entidade.
 *
 * Devolve veredito para cada uma, funcional ou não: a tela precisa das duas listas. As
 * recusadas não desaparecem em silêncio — quem expõe escolhe se mostra o aviso (a engine já
 * tem `UnsupportedViewNotice`) ou se apenas registra o motivo.
 */
export function auditViewCapabilities(schema: MetaEntitySchema): ViewCapabilityVerdict[] {
  return (schema.views ?? []).map((view) => assessView(schema, view));
}

/**
 * OS TIPOS QUE A TELA PODE OFERECER — a interseção entre o que a engine desenha e o que
 * esta entidade consegue alimentar.
 *
 * É esta lista (e não `RENDERABLE_VIEW_TYPES`) que a tela passa ao switcher de abas. Sem ela,
 * o switcher oferece uma aba que abre num painel de aviso — que é a forma mais educada de
 * expor uma view que não funciona.
 */
export function functionalViewTypes(schema: MetaEntitySchema): string[] {
  // A ordem é a de `RENDERABLE_VIEW_TYPES`: abas não devem dançar porque o store reordenou.
  return RENDERABLE_VIEW_TYPES.filter((viewType) =>
    auditViewCapabilities(schema).some(
      (verdict) => verdict.viewType === viewType && verdict.functional,
    ),
  );
}

/** As views recusadas, com o motivo — para registro e para o aviso de tela. */
export function nonFunctionalViews(schema: MetaEntitySchema): ViewCapabilityVerdict[] {
  return auditViewCapabilities(schema).filter((verdict) => !verdict.functional);
}
