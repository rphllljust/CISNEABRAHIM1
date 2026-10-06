/**
 * CISNE — COMMAND REGISTRY: CONTRATO
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE MODULO ELIMINA
 * ---------------------------------------------------------------------------------------------
 *
 * Conforme a Pagina 11 do relatorio, o gap e: "acoes inconsistentes espalhadas em formularios
 * locais". Hoje cada tela decide sozinha o que pode fazer com o objeto que tem na mao:
 *
 *   - PayablesListPage monta seus botoes e o proprio `disabled`;
 *   - PayableDetailPage repete a MESMA regra para o MESMO pagamento;
 *   - o SmartRelationBar de outra tela inventa um terceiro caminho para a mesma acao.
 *
 * O resultado medido nao e estetico, e operacional: a MESMA acao aparece habilitada na lista e
 * desabilitada no detalhe; o rotulo muda de tela para tela; e o motivo real de indisponibilidade
 * (estado do objeto, capability ausente, entrada obrigatoria faltando) chega ao operador como um
 * botao cinza sem explicacao.
 *
 * A acao deixa de ser um `<button>` escrito a mao e passa a ser um FATO DECLARADO: um
 * `CommandDefinition` que descreve id, rotulo, intencao, capability exigida, estados permitidos,
 * confirmacao, entradas obrigatorias e o handler/endpoint que executa.
 *
 * ---------------------------------------------------------------------------------------------
 * LIMITE DELIBERADO — ESTE MODULO NAO E FRONTEIRA DE SEGURANCA
 * ---------------------------------------------------------------------------------------------
 *
 * `capability` e `allowedStates` decidem o que a INTERFACE oferece. O servidor continua sendo o
 * boundary: ele revalida capability, estado e versao em toda requisicao. Um ator que alcance o
 * endpoint por fora do registry recebe a mesma negacao de sempre. O registry elimina a
 * DIVERGENCIA entre telas, nao a autorizacao.
 *
 * Por isso `evaluateCommand` distingue `hidden` de `denied`:
 *   - `hidden`  — sem capability: a acao NEM APARECE (nem rotulo, nem contagem, nem "oculto");
 *   - `denied`  — tem capability, mas o estado/entrada atual nao permite: aparece desabilitada
 *                 COM O MOTIVO REAL, que e informacao operacional legitima.
 */

/** Como o comando se apresenta ao operador. */
export type CommandIntent =
  /** Cria um registro novo. */
  | 'create'
  /** Altera o objeto em foco (editar, ajustar). */
  | 'mutate'
  /** Transicao de estado irreversivel ou sensivel: exige confirmacao explicita. */
  | 'transition'
  /** Navegacao pura: nao escreve nada. */
  | 'navigate'
  /** Leitura derivada: relatorio, exportacao, conferencia. */
  | 'inspect';

/**
 * Como o comando e executado.
 *
 * `handler` e a forma PRIMARIA: o comando e uma funcao tipada sobre o objeto em foco. `endpoint`
 * descreve o contrato HTTP que o handler usa, para que a documentacao da acao (e o proprio
 * Command Palette) possam dizer o que vai acontecer sem abrir o codigo.
 */
export type CommandExecution = {
  /** Executa a acao. Recebe as entradas ja validadas. */
  handler?: (input: CommandInvocation) => void | Promise<void>;
  /** Navegacao declarativa (comandos de intencao `navigate`). */
  to?: string;
  /** Contrato HTTP real, quando o handler escreve no servidor. */
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
};

/**
 * Entrada obrigatoria do comando (motivo de estorno, referencia de pagamento, valor...).
 *
 * `required: true` significa: sem este valor o comando NAO executa. A interface pede o dado
 * ANTES, em vez de deixar o operador descobrir por erro 400 do servidor.
 */
export type CommandInput = {
  name: string;
  label: string;
  /** Texto de apoio: formato esperado, de onde vem o dado. */
  hint?: string;
  required?: boolean;
  /** Valor inicial sugerido (ex.: o motivo padrao do dominio). */
  defaultValue?: string;
  /**
   * Conjunto fechado de valores. Quando presente, a interface oferece escolha em vez de texto
   * livre — impede que o operador digite um estado que o dominio nao reconhece.
   */
  options?: { value: string; label: string }[];
  /** Comprimento minimo, quando o dominio exige justificativa nao-trivial. */
  minLength?: number;
};

/**
 * Confirmacao explicita. Obrigatoria em `transition`.
 *
 * `consequence` NAO e decoracao: e a frase que diz o que muda irreversivelmente. Confirmacao sem
 * consequencia declarada treina o operador a clicar "sim" — e o proximo estorno acontece sem
 * leitura.
 */
export type CommandConfirmation = {
  title: string;
  consequence: string;
  /** Verbo do botao de confirmacao (ex.: "Estornar pagamento"). */
  confirmLabel: string;
};

/**
 * Escopo do comando — a que objeto ele se aplica.
 *
 * `entity` e a chave estavel da entidade (ex.: `finance.payable`). `view` restringe a comando de
 * superficie (ex.: a list report), quando a acao so faz sentido ali.
 */
export type CommandScope = {
  entity: string;
  view?: string;
};

export type CommandDefinition = {
  /** Identificador estavel e namespaced. Ex.: `finance.payable.reversePayment`. */
  id: string;
  label: string;
  /** Uma linha: o que este comando faz. Usado na paleta e no tooltip. */
  description?: string;
  intent: CommandIntent;
  scope: CommandScope;
  /**
   * Capability REAL exigida, no formato do PDP (`finance:payable:reverse`).
   *
   * Ausente = comando nao exige capability propria (ex.: navegacao para superficie cujo acesso
   * ja foi decidido na entrada). NUNCA usar ausencia de capability para "sempre habilitado":
   * isso e o que produz acao visivel que o servidor nega.
   */
  capability?: string;
  /**
   * Estados do objeto em que o comando existe.
   *
   * Ausente = vale em qualquer estado (nao ha restricao de state machine). `[]` nao e valido:
   * um comando que nao vale em nenhum estado nao deve ser declarado.
   */
  allowedStates?: string[];
  /** Estados em que a acao e TERMINAL — nunca reoferecida. */
  terminalStates?: string[];
  confirmation?: CommandConfirmation;
  inputs?: CommandInput[];
  execution: CommandExecution;
  /**
   * Ordem de apresentacao. Menor primeiro. Sem isto a barra de acoes reordena entre telas e o
   * operador perde memoria muscular — que e metade do valor de um ERP.
   */
  order?: number;
  /** Grupo visual (ex.: "Pagamento", "Titulo"). */
  group?: string;
};

/** Objeto em foco no momento da avaliacao. */
export type CommandContext = {
  entity: string;
  /** Estado atual REAL do objeto. Ausente = desconhecido. */
  state?: string | null;
  /** Lifecycle do titulo (ACTIVE/CANCELLED), quando aplicavel. */
  lifecycle?: string | null;
  /** View/superficie corrente. */
  view?: string;
  /**
   * Capabilities efetivas do ator para este objeto, ja resolvidas pelo servidor.
   *
   * `null`/`undefined` = DESCONHECIDO, e desconhecido NAO autoriza: um comando com capability
   * declarada fica `hidden` enquanto o conjunto nao for resolvido (fail-closed).
   */
  capabilities?: ReadonlySet<string> | null;
  /** Valores de entrada ja disponiveis (ex.: vindo do formulario corrente). */
  inputs?: Record<string, string | undefined>;
  /** Objeto de negocio em foco (id, referencia) — repassado ao handler. */
  target?: CommandTarget;
};

/** O objeto de negocio sobre o qual o comando age. */
export type CommandTarget = {
  id: string;
  /** Referencia humana (ex.: "PAG-2026-0041"). */
  reference?: string;
  [key: string]: unknown;
};

/** Chamada ja autorizada e com entradas validadas. */
export type CommandInvocation = {
  commandId: string;
  target?: CommandTarget;
  inputs: Record<string, string>;
  /** Contexto completo da avaliacao, para o handler decidir detalhes. */
  context: CommandContext;
};

/**
 * Resultado da avaliacao.
 *
 * `available` e o UNICO estado em que o comando executa. `disabled` carrega `reason` — o motivo
 * real, que a interface mostra. `hidden` nao deve ser renderizado de forma alguma.
 */
export type CommandAvailability =
  | { status: 'available' }
  | { status: 'disabled'; reason: string; missingInputs?: string[] }
  | { status: 'hidden'; reason: string };

/** Comando resolvido: definicao + veredito + entradas pendentes. */
export type ResolvedCommand = {
  definition: CommandDefinition;
  availability: CommandAvailability;
};
