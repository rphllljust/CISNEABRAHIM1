import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../infrastructure/database/database.service';
import { AuthorizationRepository } from '../authorization/repositories/authorization.repository';
import type { IdentityAuthzContext } from '../authorization/types/authz-decision';

/**
 * Leitura do metadata store (Camada 2 da engine).
 *
 * Este serviço NÃO contém definição de entidade: ele lê `meta.*`, que é a fonte de verdade.
 * É essa separação que faz "adicionar um campo" ser um INSERT, e não um deploy.
 *
 * A filtragem por permissão acontece AQUI, no servidor. O frontend recebe apenas os campos
 * que o usuário pode ver — um campo de `permLevel` acima do acesso do ator NÃO chega ao
 * cliente, então não há como ele aparecer no DOM por engano.
 */
export type MetaFieldDefinition = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  readOnly: boolean;
  permLevel: number;
  options: Record<string, unknown> | null;
  fieldOrder: number;
  inForm: boolean;
  inList: boolean;
  listOrder: number;
  inFilter: boolean;
  inSearch: boolean;
  /** V2 — `sum`/`count`/`avg`/`min`/`max`, ou `null` quando a coluna não totaliza. */
  aggregation: string | null;
  /** V2 — condição de visibilidade `{ field, equals }`. `null` = sempre visível. */
  visibleWhen: Record<string, unknown> | null;
};

/** Campo COMPUTADO (V2) — derivado por fórmula, sem coluna no banco. */
export type MetaComputedFieldDefinition = {
  name: string;
  label: string;
  type: string;
  /** Fórmula em JSON: `{"op":"diff_days","args":["today","updated_at"]}`. */
  formula: Record<string, unknown>;
  fieldOrder: number;
  inList: boolean;
  listOrder: number;
  inForm: boolean;
  permLevel: number;
  aggregation: string | null;
  visibleWhen: Record<string, unknown> | null;
};

export type MetaViewDefinition = {
  viewType: string;
  label: string;
  layout: Record<string, unknown>;
  isDefault: boolean;
  /** V2 — regras de cor de linha: `[{ when: { field, equals }, accent }]`. */
  rowAccent: unknown;
};

export type MetaTransitionDefinition = {
  command: string;
  label: string;
  fromStates: string[];
  toState: string;
  permission: string;
  requiresReason: boolean;
  buttonOrder: number;
  /** `true` quando o ator possui a permissão exigida pela transição. */
  allowed: boolean;
};

export type MetaWorkflowDefinition = {
  stateField: string;
  states: string[];
  transitions: MetaTransitionDefinition[];
};

export type MetaPermissionDefinition = {
  action: string;
  permLevel: number;
  requiredPermission: string | null;
  /** `true` quando o ator possui a permissão exigida. */
  allowed: boolean;
};

export type MetaEntitySchema = {
  name: string;
  label: string;
  description: string | null;
  dataSchema: string;
  dataTable: string;
  labelField: string;
  fields: MetaFieldDefinition[];
  /** V2 — campos derivados por fórmula, já filtrados por nível de permissão. */
  computedFields: MetaComputedFieldDefinition[];
  views: MetaViewDefinition[];
  workflow: MetaWorkflowDefinition | null;
  permissions: MetaPermissionDefinition[];
  /** Níveis de campo que o ator pode ver — calculado a partir dos grants reais. */
  allowedPermLevels: number[];
};

export class MetaEntityNotFoundError extends Error {
  constructor(readonly entityName: string) {
    super(`META_ENTITY_NOT_FOUND: ${entityName}`);
  }
}

/**
 * Entrada inválida na escrita de metadados — vira 422, nunca 500.
 *
 * Separada de "não encontrado" de propósito: o cliente precisa distinguir "mandei algo
 * inválido" de "o recurso não existe", porque a ação do operador é diferente.
 */
export class MetaValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Campo referenciado não existe na entidade — 404. */
export class MetaFieldNotFoundError extends Error {
  constructor(
    readonly entityName: string,
    readonly fieldName: string,
  ) {
    super(`META_FIELD_NOT_FOUND: ${entityName}.${fieldName}`);
  }
}

/** View referenciada não existe na entidade — 404. */
export class MetaViewNotFoundError extends Error {
  constructor(
    readonly entityName: string,
    readonly viewType: string,
  ) {
    super(`META_VIEW_NOT_FOUND: ${entityName}.${viewType}`);
  }
}

/**
 * Campo com o mesmo nome já existe na entidade — 409.
 *
 * O UNIQUE é `(entity_id, name)`. Sobrescrever silenciosamente um campo existente seria
 * perder a configuração dele; criar outro com o mesmo nome é impossível. Conflito explícito.
 */
export class MetaFieldConflictError extends Error {
  constructor(
    readonly entityName: string,
    readonly fieldName: string,
  ) {
    super(`META_FIELD_CONFLICT: ${entityName}.${fieldName} ja existe.`);
  }
}

type EntityRow = {
  id: string;
  name: string;
  label: string;
  description: string | null;
  data_schema: string;
  data_table: string;
  label_field: string;
};

type FieldRow = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  read_only: boolean;
  perm_level: number;
  options: Record<string, unknown> | null;
  field_order: number;
  in_form: boolean;
  in_list: boolean;
  list_order: number;
  in_filter: boolean;
  in_search: boolean;
  aggregation: string | null;
  visible_when: Record<string, unknown> | null;
};

/**
 * Linha de `meta.computed_fields` (V2).
 *
 * Tabela própria e não coluna de `meta.fields`: um campo computado NÃO tem coluna no banco —
 * é uma FÓRMULA sobre campos reais. A distinção importa porque a engine não pode tentar gravar
 * um valor derivado, e a tela não pode tratá-lo como dado persistido.
 */
type ComputedFieldRow = {
  name: string;
  label: string;
  type: string;
  formula: Record<string, unknown>;
  field_order: number;
  in_list: boolean;
  list_order: number;
  in_form: boolean;
  perm_level: number;
  aggregation: string | null;
  visible_when: Record<string, unknown> | null;
};

type ViewRow = {
  view_type: string;
  label: string;
  layout: Record<string, unknown>;
  is_default: boolean;
  row_accent: unknown;
};

type TransitionRow = {
  command: string;
  label: string;
  from_states: string[];
  to_state: string;
  permission: string;
  requires_reason: boolean;
  button_order: number;
};

type PermissionRow = {
  action: string;
  perm_level: number;
  required_permission: string | null;
};

@Injectable()
export class MetaService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly authorizationRepository: AuthorizationRepository,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Schema completo da entidade, já filtrado pelo que o ator pode ver.
   *
   * Uma única query por tabela (não uma por campo): a engine chama isto no boot de cada
   * tela, então N+1 aqui custaria em toda navegação.
   */
  async getEntitySchema(
    entityName: string,
    actor: IdentityAuthzContext,
  ): Promise<MetaEntitySchema> {
    const entity = await this.findEntity(entityName);
    if (!entity) {
      throw new MetaEntityNotFoundError(entityName);
    }

    const grants = await this.authorizationRepository.listGrants(actor.identityId, false);
    const grantedActions = new Set<string>(grants.map((grant) => grant.action));

    const [fields, computedFields, views, workflow, permissions] = await Promise.all([
      this.listFields(entity.id),
      this.listComputedFields(entity.id),
      this.listViews(entity.id),
      this.loadWorkflow(entity.id, grantedActions),
      this.listPermissions(entity.id, grantedActions),
    ]);

    /*
     * NÍVEIS PERMITIDOS — o coração da permissão por campo.
     *
     * `permLevel 0` é sempre visível para quem lê a entidade. Níveis acima exigem que o
     * ator tenha a permissão declarada para aquele nível em `meta.permissions`. Sem a
     * permissão, o nível inteiro é omitido e os campos dele nem chegam ao cliente.
     */
    const allowedPermLevels = this.resolveAllowedPermLevels(permissions);

    return {
      name: entity.name,
      label: entity.label,
      description: entity.description,
      dataSchema: entity.data_schema,
      dataTable: entity.data_table,
      labelField: entity.label_field,
      fields: fields
        .filter((field) => allowedPermLevels.includes(field.permLevel))
        .map((field) => field),
      /*
       * Campos computados passam pela MESMA barreira de nível: uma fórmula pode derivar de um
       * campo sensível, então o nível dela é conferido aqui também — fail-closed.
       */
      computedFields: computedFields.filter((field) =>
        allowedPermLevels.includes(field.permLevel),
      ),
      views,
      workflow,
      permissions,
      allowedPermLevels,
    };
  }

  /** Só os campos — atalho para telas que não precisam de views nem workflow. */
  async getEntityFields(
    entityName: string,
    actor: IdentityAuthzContext,
  ): Promise<MetaFieldDefinition[]> {
    const schema = await this.getEntitySchema(entityName, actor);
    return schema.fields;
  }

  /** View específica (`form`/`list`/`kanban`/`calendar`). */
  async getEntityView(
    entityName: string,
    viewType: string,
    actor: IdentityAuthzContext,
  ): Promise<MetaViewDefinition | null> {
    const schema = await this.getEntitySchema(entityName, actor);
    return schema.views.find((view) => view.viewType === viewType) ?? null;
  }

  /** Workflow da entidade, com `allowed` calculado por transição. */
  async getEntityWorkflow(
    entityName: string,
    actor: IdentityAuthzContext,
  ): Promise<MetaWorkflowDefinition | null> {
    const schema = await this.getEntitySchema(entityName, actor);
    return schema.workflow;
  }

  /** Lista de entidades registradas — a engine usa para descobrir o que existe. */
  async listEntities(): Promise<Array<{ name: string; label: string; description: string | null }>> {
    const result = await this.pool().query<{
      name: string;
      label: string;
      description: string | null;
    }>(
      `SELECT name, label, description FROM meta.entities WHERE enabled = true ORDER BY label`,
    );
    return result.rows;
  }

  private async findEntity(entityName: string): Promise<EntityRow | null> {
    const result = await this.pool().query<EntityRow>(
      `SELECT id, name, label, description, data_schema, data_table, label_field
         FROM meta.entities WHERE name = $1 AND enabled = true`,
      [entityName],
    );
    return result.rows[0] ?? null;
  }

  private async listFields(entityId: string): Promise<MetaFieldDefinition[]> {
    const result = await this.pool().query<FieldRow>(
      `SELECT name, label, type, required, read_only, perm_level, options,
              field_order, in_form, in_list, list_order, in_filter, in_search,
              aggregation, visible_when
         FROM meta.fields WHERE entity_id = $1 ORDER BY field_order, name`,
      [entityId],
    );
    // Mesmo mapper da escrita: leitura e escrita não podem divergir na forma do campo.
    return result.rows.map((row) => this.mapFieldRow(row));
  }

  /** Campos COMPUTADOS (V2) — derivados por fórmula, sem coluna no banco. */
  private async listComputedFields(entityId: string): Promise<MetaComputedFieldDefinition[]> {
    const result = await this.pool().query<ComputedFieldRow>(
      `SELECT name, label, type, formula, field_order, in_list, list_order, in_form,
              perm_level, aggregation, visible_when
         FROM meta.computed_fields
        WHERE entity_id = $1 AND enabled = true
        ORDER BY field_order, name`,
      [entityId],
    );
    return result.rows.map((row) => ({
      name: row.name,
      label: row.label,
      type: row.type,
      formula: row.formula,
      fieldOrder: row.field_order,
      inList: row.in_list,
      listOrder: row.list_order,
      inForm: row.in_form,
      permLevel: row.perm_level,
      aggregation: row.aggregation,
      visibleWhen: row.visible_when,
    }));
  }

  private async listViews(entityId: string): Promise<MetaViewDefinition[]> {
    const result = await this.pool().query<ViewRow>(
      `SELECT view_type, label, layout, is_default, row_accent FROM meta.views
        WHERE entity_id = $1 ORDER BY view_type`,
      [entityId],
    );
    return result.rows.map((row) => ({
      viewType: row.view_type,
      label: row.label,
      layout: row.layout ?? {},
      isDefault: row.is_default,
      rowAccent: row.row_accent,
    }));
  }

  private async loadWorkflow(
    entityId: string,
    grantedActions: ReadonlySet<string>,
  ): Promise<MetaWorkflowDefinition | null> {
    const workflow = await this.pool().query<{
      id: string;
      state_field: string;
      states: string[];
    }>(`SELECT id, state_field, states FROM meta.workflows WHERE entity_id = $1`, [entityId]);

    const row = workflow.rows[0];
    if (!row) {
      return null;
    }

    const transitions = await this.pool().query<TransitionRow>(
      `SELECT command, label, from_states, to_state, permission, requires_reason, button_order
         FROM meta.workflow_transitions WHERE workflow_id = $1 ORDER BY button_order, command`,
      [row.id],
    );

    return {
      stateField: row.state_field,
      states: row.states,
      transitions: transitions.rows.map((transition) => ({
        command: transition.command,
        label: transition.label,
        fromStates: transition.from_states,
        toState: transition.to_state,
        permission: transition.permission,
        requiresReason: transition.requires_reason,
        buttonOrder: transition.button_order,
        allowed: grantedActions.has(transition.permission),
      })),
    };
  }

  private async listPermissions(
    entityId: string,
    grantedActions: ReadonlySet<string>,
  ): Promise<MetaPermissionDefinition[]> {
    const result = await this.pool().query<PermissionRow>(
      `SELECT action, perm_level, required_permission FROM meta.permissions
        WHERE entity_id = $1 ORDER BY perm_level, action`,
      [entityId],
    );
    return result.rows.map((row) => ({
      action: row.action,
      permLevel: row.perm_level,
      requiredPermission: row.required_permission,
      allowed: row.required_permission === null || grantedActions.has(row.required_permission),
    }));
  }

  /**
   * Níveis de campo que o ator pode ver.
   *
   * Nível 0 é sempre visível (é o nível base de quem lê a entidade). Cada nível acima entra
   * na lista APENAS se todas as permissões declaradas para aquele nível estiverem
   * concedidas — política fail-closed: permissão ausente = nível omitido.
   */
  private resolveAllowedPermLevels(permissions: MetaPermissionDefinition[]): number[] {
    const levels = new Set<number>([0]);
    for (const permission of permissions) {
      if (permission.permLevel > 0 && permission.allowed && permission.requiredPermission) {
        levels.add(permission.permLevel);
      }
    }
    return [...levels].sort((left, right) => left - right);
  }

  /* ══════════════════════════════════════════════════════════════════════════════════════
     ESCRITA DE METADADOS (V4)

     Até aqui este serviço só LIA `meta.*`. O explorador e o construtor de formulário exigem
     gravação, e é esta a metade que faltava.

     ─────────────────────────────────────────────────────────────────────────────────────
     ALLOWLIST DE COLUNAS, NUNCA O CORPO CRU

     O corpo chega do cliente. Montar `UPDATE ... SET` a partir dele deixaria qualquer chave
     virar coluna — incluindo `name`, cujo rename quebraria a coluna correspondente no banco,
     e `entity_id`, que moveria o campo para outra entidade. Cada campo abaixo é mapeado
     EXPLICITAMENTE de uma chave de entrada para uma coluna; chave não listada é IGNORADA.

     ─────────────────────────────────────────────────────────────────────────────────────
     O QUE ESTE SERVIÇO NÃO DECIDE

     Autorização NÃO é decidida aqui: quem barra é o `AuthorizationGuard` no controller, com a
     capability administrativa exigida. Este serviço assume que o ator já passou pela guarda.
     Regra de negócio no frontend (ou no serviço, depois da guarda) não é boundary de segurança.
     ══════════════════════════════════════════════════════════════════════════════════════ */

  /** Erro de VALIDAÇÃO de entrada — vira 422, nunca 500. */
  private static readonly FIELD_TYPES = new Set([
    'data',
    'text',
    'currency',
    'select',
    'link',
    'date',
    'datetime',
    'bool',
    'integer',
  ]);

  /** Tipos de view que o CHECK de `meta.views` aceita. Espelha a migration 0088. */
  private static readonly VIEW_TYPES = new Set([
    'form',
    'list',
    'kanban',
    'calendar',
    'pivot',
    'tree',
    'graph',
  ]);

  private static readonly AGGREGATIONS = new Set(['sum', 'count', 'avg', 'min', 'max']);

  /**
   * Atualiza um campo de `meta.fields`.
   *
   * `name` e `entity_id` são IMUTÁVEIS por contrato: renomear um campo quebraria a coluna do
   * banco, e mover entre entidades é remoção + criação, não edição. Chaves imutáveis são
   * REJEITADAS com erro explícito em vez de silenciosamente ignoradas — uma tentativa de
   * rename precisa falhar de forma visível.
   */
  async patchField(
    entityName: string,
    fieldName: string,
    patch: Record<string, unknown>,
  ): Promise<MetaFieldDefinition> {
    const entity = await this.findEntity(entityName);
    if (!entity) {
      throw new MetaEntityNotFoundError(entityName);
    }

    for (const immutable of ['name', 'entityId', 'entity_id']) {
      if (immutable in patch) {
        throw new MetaValidationError(
          `META_FIELD_IMMUTABLE: '${immutable}' nao pode ser alterado.`,
        );
      }
    }

    const assignments: string[] = [];
    const values: unknown[] = [];

    const setText = (column: string, key: string, maxLength: number): void => {
      if (!(key in patch)) {
        return;
      }
      const value = patch[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new MetaValidationError(`META_FIELD_INVALID: '${key}' deve ser texto nao vazio.`);
      }
      if (value.length > maxLength) {
        throw new MetaValidationError(
          `META_FIELD_INVALID: '${key}' excede ${maxLength} caracteres.`,
        );
      }
      values.push(value.trim());
      assignments.push(`${column} = $${values.length}`);
    };

    const setBoolean = (column: string, key: string): void => {
      if (!(key in patch)) {
        return;
      }
      const value = patch[key];
      if (typeof value !== 'boolean') {
        throw new MetaValidationError(`META_FIELD_INVALID: '${key}' deve ser booleano.`);
      }
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    const setInteger = (column: string, key: string): void => {
      if (!(key in patch)) {
        return;
      }
      const value = patch[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new MetaValidationError(
          `META_FIELD_INVALID: '${key}' deve ser inteiro nao negativo.`,
        );
      }
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    setText('label', 'label', 160);

    if ('type' in patch) {
      const type = patch['type'];
      if (typeof type !== 'string' || !MetaService.FIELD_TYPES.has(type)) {
        throw new MetaValidationError(
          `META_FIELD_INVALID: 'type' fora do conjunto aceito (${[...MetaService.FIELD_TYPES].join(', ')}).`,
        );
      }
      values.push(type);
      assignments.push(`type = $${values.length}`);
    }

    if ('aggregation' in patch) {
      const aggregation = patch['aggregation'];
      // `null` é válido e significa "não totaliza" — é diferente de ausente.
      if (aggregation === null) {
        assignments.push('aggregation = NULL');
      } else if (typeof aggregation === 'string' && MetaService.AGGREGATIONS.has(aggregation)) {
        values.push(aggregation);
        assignments.push(`aggregation = $${values.length}`);
      } else {
        throw new MetaValidationError(
          `META_FIELD_INVALID: 'aggregation' deve ser null ou ${[...MetaService.AGGREGATIONS].join('|')}.`,
        );
      }
    }

    setInteger('perm_level', 'permLevel');
    setBoolean('required', 'required');
    setBoolean('read_only', 'readOnly');
    setBoolean('in_form', 'inForm');
    setBoolean('in_list', 'inList');
    setBoolean('in_filter', 'inFilter');
    setBoolean('in_search', 'inSearch');
    setInteger('field_order', 'fieldOrder');
    setInteger('list_order', 'listOrder');

    if (assignments.length === 0) {
      throw new MetaValidationError('META_FIELD_INVALID: nenhum campo alteravel foi enviado.');
    }

    /*
     * `perm_level` acima do que a entidade declara em `meta.permissions` é REJEITADO.
     *
     * Gravar um nível sem permissão correspondente criaria um campo que NINGUÉM vê — nem
     * quem gravou. É fail-closed: o nível precisa existir em `meta.permissions` para ser
     * atribuível, e a checagem é do servidor, não do formulário.
     */
    if ('permLevel' in patch && typeof patch['permLevel'] === 'number') {
      const declared = await this.pool().query<{ perm_level: number }>(
        `SELECT DISTINCT perm_level FROM meta.permissions WHERE entity_id = $1`,
        [entity.id],
      );
      const allowedLevels = new Set<number>([0, ...declared.rows.map((row) => row.perm_level)]);
      if (!allowedLevels.has(patch['permLevel'])) {
        throw new MetaValidationError(
          `META_FIELD_INVALID: permLevel ${patch['permLevel']} nao esta declarado em meta.permissions da entidade.`,
        );
      }
    }

    values.push(entity.id);
    values.push(fieldName);
    const updated = await this.pool().query<FieldRow>(
      `UPDATE meta.fields SET ${assignments.join(', ')}, updated_at = now()
        WHERE entity_id = $${values.length - 1} AND name = $${values.length}
        RETURNING name, label, type, required, read_only, perm_level, options,
                  field_order, in_form, in_list, list_order, in_filter, in_search,
                  aggregation, visible_when`,
      values,
    );

    const row = updated.rows[0];
    if (!row) {
      throw new MetaFieldNotFoundError(entityName, fieldName);
    }
    return this.mapFieldRow(row);
  }

  /**
   * Atualiza uma view de `meta.views`.
   *
   * `view_type` é imutável: é a CHAVE da view na entidade (o UNIQUE é `entity_id, view_type`).
   * Alterá-lo seria criar outra view, não editar esta. `layout` é JSONB livre por contrato,
   * mas precisa ser um OBJETO — array ou escalar devolveria uma view que a engine não sabe ler.
   */
  async patchView(
    entityName: string,
    viewType: string,
    patch: Record<string, unknown>,
  ): Promise<MetaViewDefinition> {
    const entity = await this.findEntity(entityName);
    if (!entity) {
      throw new MetaEntityNotFoundError(entityName);
    }

    if ('viewType' in patch || 'view_type' in patch) {
      throw new MetaValidationError(
        'META_VIEW_IMMUTABLE: view_type identifica a view na entidade e nao pode ser alterado.',
      );
    }

    const assignments: string[] = [];
    const values: unknown[] = [];

    if ('label' in patch) {
      const label = patch['label'];
      if (typeof label !== 'string' || label.trim() === '') {
        throw new MetaValidationError('META_VIEW_INVALID: label deve ser texto nao vazio.');
      }
      if (label.length > 120) {
        throw new MetaValidationError('META_VIEW_INVALID: label excede 120 caracteres.');
      }
      values.push(label.trim());
      assignments.push(`label = $${values.length}`);
    }

    if ('isDefault' in patch) {
      const isDefault = patch['isDefault'];
      if (typeof isDefault !== 'boolean') {
        throw new MetaValidationError('META_VIEW_INVALID: isDefault deve ser booleano.');
      }
      values.push(isDefault);
      assignments.push(`is_default = $${values.length}`);
    }

    if ('layout' in patch) {
      const layout = patch['layout'];
      if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) {
        throw new MetaValidationError('META_VIEW_INVALID: layout deve ser um objeto JSON.');
      }
      values.push(JSON.stringify(layout));
      assignments.push(`layout = $${values.length}::jsonb`);
    }

    if (assignments.length === 0) {
      throw new MetaValidationError('META_VIEW_INVALID: nenhum campo alteravel foi enviado.');
    }

    values.push(entity.id);
    values.push(viewType);
    const updated = await this.pool().query<ViewRow>(
      `UPDATE meta.views SET ${assignments.join(', ')}, updated_at = now()
        WHERE entity_id = $${values.length - 1} AND view_type = $${values.length}
        RETURNING view_type, label, layout, is_default, row_accent`,
      values,
    );

    const row = updated.rows[0];
    if (!row) {
      throw new MetaViewNotFoundError(entityName, viewType);
    }
    return {
      viewType: row.view_type,
      label: row.label,
      layout: row.layout ?? {},
      isDefault: row.is_default,
      rowAccent: row.row_accent,
    };
  }

  /**
   * Cria um campo em `meta.fields`.
   *
   * `name` é OBRIGATÓRIO aqui (ao contrário do PATCH, onde é imutável): é a identidade do
   * campo. O par `(entity_id, name)` é UNIQUE no store; a violação vira erro de conflito
   * explícito, não 500.
   */
  async createField(
    entityName: string,
    input: Record<string, unknown>,
  ): Promise<MetaFieldDefinition> {
    const entity = await this.findEntity(entityName);
    if (!entity) {
      throw new MetaEntityNotFoundError(entityName);
    }

    const name = input['name'];
    const label = input['label'];
    const type = input['type'];

    const namePattern = /^[a-z][a-z0-9_]*$/;
    if (typeof name !== 'string' || !namePattern.test(name) || name.length > 80) {
      throw new MetaValidationError(
        'META_FIELD_INVALID: name deve casar ^[a-z][a-z0-9_]*$ com ate 80 caracteres.',
      );
    }
    if (typeof label !== 'string' || label.trim() === '' || label.length > 160) {
      throw new MetaValidationError('META_FIELD_INVALID: label deve ser texto de 1..160.');
    }
    if (typeof type !== 'string' || !MetaService.FIELD_TYPES.has(type)) {
      throw new MetaValidationError(
        `META_FIELD_INVALID: type fora do conjunto aceito (${[...MetaService.FIELD_TYPES].join(', ')}).`,
      );
    }

    const permLevel = typeof input['permLevel'] === 'number' ? input['permLevel'] : 0;
    if (!Number.isInteger(permLevel) || permLevel < 0) {
      throw new MetaValidationError('META_FIELD_INVALID: permLevel deve ser inteiro nao negativo.');
    }

    const created = await this.pool().query<FieldRow>(
      `INSERT INTO meta.fields
         (entity_id, name, label, type, required, read_only, perm_level, options,
          field_order, in_form, in_list, list_order, in_filter, in_search)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (entity_id, name) DO NOTHING
       RETURNING name, label, type, required, read_only, perm_level, options,
                 field_order, in_form, in_list, list_order, in_filter, in_search,
                 aggregation, visible_when`,
      [
        entity.id,
        name,
        label.trim(),
        type,
        input['required'] === true,
        input['readOnly'] === true,
        permLevel,
        input['options'] ?? null,
        typeof input['fieldOrder'] === 'number' ? input['fieldOrder'] : 999,
        input['inForm'] === true,
        input['inList'] === true,
        typeof input['listOrder'] === 'number' ? input['listOrder'] : 999,
        input['inFilter'] === true,
        input['inSearch'] === true,
      ],
    );

    const row = created.rows[0];
    if (!row) {
      throw new MetaFieldConflictError(entityName, name);
    }
    return this.mapFieldRow(row);
  }

  /** Mapeia a linha de `meta.fields` para o contrato público. Um só lugar, sem divergência. */
  private mapFieldRow(row: FieldRow): MetaFieldDefinition {
    return {
      name: row.name,
      label: row.label,
      type: row.type,
      required: row.required,
      readOnly: row.read_only,
      permLevel: row.perm_level,
      options: row.options,
      fieldOrder: row.field_order,
      inForm: row.in_form,
      inList: row.in_list,
      listOrder: row.list_order,
      inFilter: row.in_filter,
      inSearch: row.in_search,
      aggregation: row.aggregation,
      visibleWhen: row.visible_when,
    };
  }
}
