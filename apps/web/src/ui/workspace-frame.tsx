import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMediaQuery } from '../shell/hooks/useMediaQuery';
import { cn } from './utils/cn';

const WorkspaceContext = createContext<{
  host: HTMLElement | null;
  setOpen: (id: string, open: boolean) => void;
} | null>(null);

/** One dock per page; portals preserve the caller's data, commands and React context. */
export function WorkspaceContextHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [panels, setPanels] = useState<ReadonlySet<string>>(new Set());
  const setOpen = useCallback((id: string, open: boolean) => {
    setPanels((previous) => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ host, setOpen }), [host, setOpen]);
  return (
    <WorkspaceContext.Provider value={value}>
      <div
        className={cn(
          'grid min-h-0 min-w-0 flex-1 items-start',
          panels.size > 0 && 'xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-4',
        )}
        data-layout="context-workbench"
        data-context-open={panels.size > 0}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        <aside
          ref={setHost}
          hidden={panels.size === 0}
          aria-label="Contexto da seleção"
          className="sticky top-3 min-h-0 max-h-[calc(100dvh-7rem)] overflow-y-auto border-l border-[var(--erp-border)] bg-white"
        />
      </div>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContextDock(open: boolean): HTMLElement | null {
  const workspace = useContext(WorkspaceContext);
  const id = useId();
  const desktop = useMediaQuery('(min-width: 80rem)');
  const setOpen = workspace?.setOpen;
  useEffect(() => {
    if (!setOpen) return;
    setOpen(id, open && desktop);
    return () => setOpen(id, false);
  }, [id, open, desktop, setOpen]);
  return desktop ? (workspace?.host ?? null) : null;
}

/**
 * WORKSPACE FRAME — a geometria de area de trabalho do CISNE, em UM lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE ESTE MODULO RESOLVE
 *
 * Cada superficie do produto compunha a propria moldura: uma faixa de titulo, uma regua de
 * indicadores, a barra de visoes, a barra de filtros, a grade e — quando existia — uma coluna de
 * contexto. Eram cinco ou seis implementacoes da MESMA ideia, e elas divergiam no que importa:
 * altura de faixa, peso de tinta, onde o recorte vive, quanto a coluna de contexto ocupa.
 *
 * O sintoma medido, antes desta moldura (1600x900, dados reais de fixture):
 *
 *   /app/clients      conteudo terminava em y=497 de 900  ->  403px de canvas vazio
 *   /app/work-inbox   conteudo terminava em y=624 de 900  ->  276px de canvas vazio
 *   /app              conteudo terminava em y=1412         ->  -512px (rolagem obrigatoria)
 *
 * Ou seja: onde havia pouco dado, a tela deixava METADE da viewport branca; onde havia muito dado,
 * ela empilhava cards ate estourar. As duas coisas sao o mesmo defeito — nao existia uma moldura
 * que dissesse "esta e a area de trabalho e ela ocupa a tela".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A GRAMATICA
 *
 *   WorkspaceHeader   identidade + recorte ativo + comando primario   (uma faixa densa)
 *   WorkspaceToolbar  visoes + busca + filtros + colunas + mais      (uma faixa de comando)
 *   WorkspaceBody     area de trabalho + coluna de contexto          (a grade elastica)
 *   WorkspacePane     a superficie branca da grade (ou do contexto)
 *
 * REGRAS NAO NEGOCIAVEIS DESTA MOLDURA
 *
 * - A COLUNA DE TRABALHO OCUPA A ALTURA DISPONIVEL. `WorkspaceBody` e uma grade de altura total: o
 *   painel da fila nao encolhe para o tamanho do conteudo nem deixa canvas vazio abaixo. Um
 *   workspace com dois itens e um workspace com duzentos tem a MESMA silhueta.
 * - NAO HA CAIXA DENTRO DE CAIXA. `WorkspacePane` tem UM contorno de 1px e raio de 4px. Nada aqui
 *   desenha segunda borda, segundo raio ou sombra decorativa.
 * - SEM SOMBRA EM SUPERFICIE DE TRABALHO. Elevacao e para menu, popover, modal e drawer. Uma grade
 *   de dados elevada compete com o popover que o operador abriu por cima dela.
 * - DENSIDADE SEM POLUICAO: cada faixa tem UMA funcao. Se um elemento nao responde "o que e / por
 *   que importa / o que posso fazer", ele nao entra.
 */

/* ------------------------------------------------------------------ workspace */

/**
 * `WorkspaceFrame` — a raiz de uma area de trabalho com altura governada.
 *
 * `fill` liga a altura total: a moldura ocupa o espaco que o shell deixou e a grade dentro dela e
 * elastica. Sem `fill`, a superficie cresce com o conteudo (uso em telas de leitura/formulario).
 */
export function WorkspaceFrame({
  children,
  fill = false,
  className,
}: {
  children: ReactNode;
  /** Ocupa a altura disponivel do shell. Obrigatorio em worklist/grade. */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        fill ? 'min-h-[calc(100dvh-var(--shell-chrome-height)-42px)]' : '',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------- header */

/**
 * CABECALHO DE AREA DE TRABALHO — identidade, recorte e comando na mesma faixa.
 *
 * `count` e SEMPRE o numero publicado pelo servidor. Quando ele nao existe, o cabecalho nao afirma
 * zero: a ausencia de dado e dita pela superficie que sabe disso (a grade), nao pelo titulo.
 *
 * `scope` e a linha de RECORTE ATIVO — ela muda a cada filtro e por isso vive ao lado do dado, nao
 * do titulo. `identity` e a linha que NAO muda (o que a area e).
 */
export function WorkspaceHeader({
  title,
  identity,
  scope,
  action,
  status,
}: {
  title: string;
  /** O que esta area E, em uma linha curta. Nao muda com filtro. */
  identity?: ReactNode;
  /** O recorte ATIVO. Muda com filtro. */
  scope?: ReactNode;
  /** Comando primario da area (um so). */
  action?: ReactNode;
  /** Sinal operacional do conjunto — contagem, excecao, estado. */
  status?: ReactNode;
}) {
  return (
    <header
      className="mb-3 grid gap-3 border-l-4 border-brand-600 bg-white px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto]"
      data-layout="worklist-identity"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="m-0 text-[length:var(--type-workspace-size)] leading-tight font-[650] tracking-[-0.01em] text-[color:var(--color-text-primary)]">
            {title}
          </h1>
          {status ? <div className="min-w-0">{status}</div> : null}
        </div>
        {identity || scope ? (
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[color:var(--color-text-secondary)]">
            {identity ? <span className="min-w-0">{identity}</span> : null}
            {identity && scope ? (
              <span aria-hidden className="text-[color:var(--color-border-strong)]">
                ·
              </span>
            ) : null}
            {scope ? (
              <span className="min-w-0 text-[color:var(--color-text-muted)]">{scope}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {action ? (
        <div className="flex shrink-0 items-start gap-1.5 lg:border-l lg:border-[var(--erp-border)] lg:pl-4">
          {action}
        </div>
      ) : null}
    </header>
  );
}

/**
 * METADATA OPERACIONAL DO CONJUNTO — o status da carteira como TEXTO, nao como tres cartoes.
 *
 * Antes, "3 no recorte / 2 ativos / 1 fora de operacao" era uma faixa de tres caixas contornadas
 * acima da grade. Tres caixas para tres numeros que caibam numa linha de texto e que NAO sao a
 * tarefa do operador: eles sao contexto. Aqui eles ficam na linha de identidade do cabecalho, com o
 * numero em peso e o rotulo em muted — a leitura e a mesma e a área devolvida e de ~40px por tela.
 *
 * `alert` marca o unico numero que EXIGE o operador. Um numero normal da carteira nao pinta: se
 * tudo grita, nada grita.
 */
export function WorkspaceStatusLine({
  items,
}: {
  items: Array<{
    value: ReactNode;
    label: string;
    tone?: 'neutral' | 'alert';
    onClick?: () => void;
  }>;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-0.5 p-0 text-[12px]">
      {items.map((item, index) => {
        const content = (
          <>
            <strong
              className={cn(
                'font-semibold tabular-nums',
                item.tone === 'alert'
                  ? 'text-[color:var(--color-amber-700)]'
                  : 'text-[color:var(--color-text-primary)]',
              )}
            >
              {item.value}
            </strong>{' '}
            <span className="text-[color:var(--color-text-muted)]">{item.label}</span>
          </>
        );
        return (
          <li key={`${item.label}-${index}`} className="flex items-center gap-x-3">
            {index > 0 ? (
              <span aria-hidden className="text-[color:var(--color-border-strong)]">
                ·
              </span>
            ) : null}
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="rounded-[3px] text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                {content}
              </button>
            ) : (
              <span>{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------- toolbar */

/**
 * BARRA DE FERRAMENTAS DA BANCADA — uma faixa, um comando por funcao.
 *
 * Ordem fixa, igual em toda worklist do produto: VIEWS (o recorte) a esquerda, CONSULTA (busca,
 * filtros, colunas, mais) a direita. O operador aprende a posicao uma vez.
 */
export function WorkspaceToolbar({
  views,
  children,
  className,
}: {
  /** Visoes salvas / recortes de sistema — sempre a esquerda. */
  views?: ReactNode;
  /** Busca, filtros, ordenacao, colunas, exportacao — a direita. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-2 grid items-start gap-2 border-b border-[var(--erp-border)] bg-white p-3 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]',
        className,
      )}
      data-region="workspace-toolbar"
    >
      {views ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{views}</div> : null}
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-end gap-1.5',
          !views && 'xl:col-span-2',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * FAIXA DE FILTROS ATIVOS — aparece SOMENTE quando existe recorte aplicado.
 *
 * Um formulario de filtros permanente na barra gasta altura do dado para uma tarefa ocasional, e
 * faz a tela parecer configuracao. Aqui os filtros aplicados viram CHIPS removiveis: o operador ve
 * o que restringe a lista e tira o que nao quer, sem abrir nada.
 */
export function WorkspaceActiveFilters({
  filters,
  onClearAll,
}: {
  filters: Array<{ id: string; label: string; onRemove?: () => void }>;
  onClearAll?: () => void;
}) {
  if (filters.length === 0) {
    return null;
  }
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-[color:var(--color-divider)] pb-2"
      aria-label="Filtros ativos"
      data-region="active-filters"
    >
      <span className="cisne-meta-label">Recorte</span>
      <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
        {filters.map((filter) => (
          <li key={filter.id}>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-[color:var(--color-brand-200)] bg-[color:var(--color-brand-50)] pr-1 pl-2 text-[11px] font-medium text-[color:var(--color-brand-800)]">
              {filter.label}
              {filter.onRemove ? (
                <button
                  type="button"
                  onClick={filter.onRemove}
                  aria-label={`Remover filtro: ${filter.label}`}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-[color:var(--color-brand-700)] hover:bg-[color:var(--color-brand-100)]"
                >
                  ×
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:underline"
        >
          Limpar
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------- body */

/**
 * CORPO DA AREA DE TRABALHO — a grade elastica: FILA + CONTEXTO.
 *
 * A ALTURA E DO VIEWPORT, NAO DO CONTEUDO. Este e o ponto inteiro da moldura. `align-items: stretch`
 * faz as duas colunas ocuparem a mesma altura, entao:
 *
 *   - com 2 itens ou com 200, a silhueta e a mesma — o painel da fila termina onde a tela termina;
 *   - a coluna de contexto tem altura para mostrar situacao, proxima acao, estrutura e relacoes sem
 *     virar uma tira de 84px (era exatamente o que ela media em Clientes antes);
 *   - nao sobra "metade branca" embaixo, porque nao ha embaixo — a superficie ocupa o que existe.
 *
 * `context` ausente (ou `null`) devolve a grade de UMA coluna: o contexto e uma decisao da tela, e
 * quando nao ha objeto selecionado a superficie pode nao reservar a coluna.
 */
export function WorkspaceBody({
  children,
  context,
  contextWidth = 'clamp(320px, 24vw, 380px)',
  className,
}: {
  children: ReactNode;
  /** Coluna de contexto/suporte. `null` = grade de uma coluna. */
  context?: ReactNode;
  /** Largura da coluna de contexto. Padrao 320-380px conforme a largura do monitor. */
  contextWidth?: string;
  className?: string;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 80rem)');
  if (!context) {
    return (
      <div
        className={cn('grid min-h-0 min-w-0 flex-1 grid-cols-1', className)}
        data-region="work-split"
      >
        {children}
      </div>
    );
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Área de trabalho e contexto"
    >
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          aria-expanded={contextOpen}
          onClick={() => setContextOpen((previous) => !previous)}
          className="rounded border border-[var(--erp-border)] bg-white px-3 py-1.5 text-xs font-medium text-brand-700"
        >
          {contextOpen ? 'Fechar contexto do processo' : 'Contexto do processo'}
        </button>
      </div>
      <div
        className={cn('grid min-h-0 min-w-0 flex-1 items-stretch gap-3.5', className)}
        style={{
          gridTemplateColumns:
            contextOpen && desktop ? `minmax(0,1fr) ${contextWidth}` : 'minmax(0,1fr)',
        }}
        data-region="work-split"
      >
        <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
        {/*
        A COLUNA DE APOIO ROLA SOZINHA; ELA NAO ESTICA A PAGINA.

        DEFEITO MEDIDO: numa grade com `items-stretch`, a ALTURA DA LINHA e a do mais alto dos dois
        filhos. Quando a coluna de contexto tem mais conteudo que a fila, ela deixa de ser "leitura
        paralela" e passa a DITAR a altura da pagina inteira. Na Central Financeira isso foi medido:

            context-region = 380 x 3917 px   ->   .shell__content = 1380 x 4093 px

        Ou seja: a coluna de 380px de largura mandava na altura de uma tela de 1600px de largura, e
        a FILA — que e o trabalho — ficava com 3.918px de area morta ao lado. A composicao estava
        correta e a pagina continuava errada, porque a restricao de altura nao existia.

        Agora a coluna de apoio tem altura LIMITADA pela linha (`min-h-0` + `overflow-auto`) e rola
        internamente. A altura da bancada passa a ser a da FILA: com 2 ou com 200 itens, a silhueta e
        a mesma — que e a regra que a moldura declara desde o inicio.

        Isto NAO corta conteudo: tudo o que estava na coluna continua alcancavel por rolagem.
      */}
        {contextOpen ? (
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
            data-layout="workspace-context"
          >
            {context}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * PAINEL DE TRABALHO — a superficie branca que contem a grade.
 *
 * UMA borda de 1px, raio de 4px, SEM sombra. `flush` remove o contorno quando a superficie ja esta
 * dentro de outra moldura (object page, painel aninhado) — nunca para "deixar mais leve" por gosto.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `surface` — A CAMADA CROMATICA DO PAINEL (FINAL 4)
 *
 * O painel nasce em LEVEL 1 (branco, `--color-surface-raised`), que e o certo para a GRADE: a area
 * onde o operador trabalha e a mais clara da tela, e e dela que as outras camadas se destacam.
 *
 * A coluna de CONTEXTO e LEVEL 2: ela informa, nao opera, e precisa se distinguir do trabalho. O
 * caminho anterior era a tela passar `bg-[color:var(--color-surface-context)]` por `className` — e
 * isso NAO funcionava: `cn` e uma juncao simples de strings (nao resolve conflito entre utilitarios),
 * entao as DUAS classes de fundo eram emitidas e a ordem do CSS decidia. O painel base vinha depois
 * e vencia, deixando o contexto BRANCO igual ao trabalho. A hierarquia existia no token e nao
 * chegava a tela.
 *
 * Declarar a camada aqui resolve na origem: uma classe de fundo, escolhida pelo significado, sem
 * disputa de especificidade.
 */
export function WorkspacePane({
  children,
  flush = false,
  surface = 'work',
  className,
  as: As = 'div',
  ...rest
}: {
  children: ReactNode;
  flush?: boolean;
  /** `work` = LEVEL 1 (branco). `support` = LEVEL 2 (contexto). */
  surface?: 'work' | 'support';
  className?: string;
  as?: 'div' | 'section';
  'aria-label'?: string;
  'data-region'?: string;
}) {
  return (
    <As
      className={cn(
        'flex min-h-0 min-w-0 flex-col',
        /*
         * A CAMADA DECIDE A SUPERFICIE **E** A DIVISA.
         *
         * CONTRATO DA SUPERFICIE DE APOIO:
         *   background  #F5F7FA
         *   border-left 1px solid #D6DCE4
         *
         * O contexto se separa do trabalho por BORDA ESQUERDA, nao por contorno completo. Um
         * contorno fechado em volta da coluna faz dela uma CAIXA ao lado de outra CAIXA — o
         * vocabulario de "card", que e exatamente o que o ERP Tier-1 nao pode usar aqui. A divisa
         * de 1px a esquerda diz a mesma coisa ("isto e leitura paralela") sem criar um objeto.
         *
         * `border-strong` (#D6DCE4) e um degrau mais escuro que o divisor padrao: sobre o cinza de
         * apoio, o divisor claro desapareceria.
         */
        surface === 'support'
          ? 'bg-[color:var(--color-surface-context)] border-l border-[color:var(--color-border-strong)]'
          : 'bg-[color:var(--color-surface-raised)]',
        flush
          ? ''
          : surface === 'support'
            ? 'rounded-r-[6px]'
            : 'rounded-[6px] border border-[color:var(--color-border-default)]',
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

/**
 * CABECALHO DO PAINEL — titulo, contagem e comandos da REGIAO (nao da pagina).
 *
 * Existe para que a fila tenha identidade propria dentro do painel e para que o contador publicado
 * pelo servidor tenha um lugar declarado — nunca um numero solto flutuando sobre a grade.
 */
export function WorkspacePaneHeader({
  title,
  count,
  description,
  action,
}: {
  title: ReactNode;
  count?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-[var(--panel-head-height)] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--color-divider)] px-3.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h2 className="cisne-type-region-title m-0 text-[15px]! leading-6!">{title}</h2>
        {count !== undefined && count !== null ? (
          <span className="text-[12px] font-semibold tabular-nums text-[color:var(--color-text-secondary)]">
            {count}
          </span>
        ) : null}
        {description ? (
          <span className="text-[11px] text-[color:var(--color-text-muted)]">{description}</span>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}

/**
 * SECAO DE CONTEXTO — rotulo + conteudo, com regua entre secoes.
 *
 * A coluna de contexto nao e um card secundario: ela e uma superficie de LEITURA com secoes
 * nomeadas (Situacao, Proxima acao, Estrutura, Contatos, Relacoes). Cada secao responde uma
 * pergunta, e o rotulo e pequeno e muted para que o VALOR seja o que se le.
 */
export function ContextSection({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-b border-[color:var(--color-divider)] px-3 py-2.5 last:border-b-0',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="cisne-meta-label m-0">{title}</h3>
        {action ? <div className="flex items-center gap-1">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * LISTA DE FATOS DO CONTEXTO — pares rotulo/valor densos.
 *
 * Usada em toda coluna de contexto para que "CNPJ", "Grupo", "Responsavel" leiam IGUAL em Clientes,
 * Contratos, OS e Ativos. Sem isso cada tela inventa o proprio espacamento e a mesma informacao
 * ocupa alturas diferentes conforme o modulo.
 */
export function ContextFacts({
  facts,
  columns = 1,
}: {
  facts: Array<{ label: string; value: ReactNode }>;
  columns?: 1 | 2;
}) {
  const visible = facts.filter(
    (fact) => fact.value !== null && fact.value !== undefined && fact.value !== '',
  );
  if (visible.length === 0) {
    return <p className="cisne-type-helper m-0">Nenhum dado publicado.</p>;
  }
  return (
    <dl className={cn('m-0 grid gap-x-4 gap-y-1.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {visible.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-[10px] font-medium tracking-wide text-[color:var(--color-text-muted)] uppercase">
            {fact.label}
          </dt>
          <dd
            className="m-0 truncate text-[12px] text-[color:var(--color-text-primary)]"
            title={typeof fact.value === 'string' ? fact.value : undefined}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * ESTADO VAZIO DA MOLDURA — a estrutura PERMANECE; so o miolo da grade muda.
 *
 * Regra do contrato visual: zero resultados NAO desmonta a area de trabalho. A toolbar continua, a
 * coluna de contexto continua, o cabecalho continua. O que aparece e uma mensagem curta com uma ou
 * duas acoes reais — nunca uma ilustracao gigante no meio de um canvas vazio.
 *
 * E uma `<section>` nomeada pelo proprio titulo: o estado da grade e uma REGIAO da area de trabalho,
 * nao um texto solto — quem le a tela por regiao (leitor de tela, navegacao por landmarks) encontra
 * "Nenhum Cliente corresponde aos filtros aplicados" como um bloco identificavel.
 */
export function WorkspaceEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={title}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center"
    >
      <p className="m-0 text-[13px] font-semibold text-[color:var(--color-text-primary)]">
        {title}
      </p>
      {description ? (
        <p className="m-0 max-w-[46ch] text-[12px] text-[color:var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </section>
  );
}

/**
 * ESQUELETO DE LINHAS — a espera com a FORMA do que vai chegar.
 *
 * Sem spinner central: o shell, o cabecalho, a toolbar e o contexto continuam montados, e apenas as
 * linhas da grade aparecem como placeholders. A tela nao "desmonta" durante o carregamento.
 */
export function WorkspaceSkeletonRows({
  rows = 8,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div aria-hidden="true" className="min-h-0 flex-1">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-[color:var(--color-border-subtle)] px-3"
          style={{ height: 'var(--row-height-comfortable)' }}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <span
              key={columnIndex}
              className="h-2.5 rounded-[2px] bg-[color:var(--color-surface-sunken-soft)]"
              style={{
                width: columnIndex === 0 ? '26%' : `${12 + ((rowIndex + columnIndex) % 3) * 4}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- contadores */

/**
 * CABECALHO DE GRADE — a baliza visual do dado tabular em todo o produto.
 *
 * Altura 36px, superficie tonal clara, tinta muted de 11px. `sticky` porque numa grade de 20 linhas
 * o rotulo da coluna precisa continuar disponivel — rolar ate o fim e perder a coluna e o defeito
 * classico de grade longa em ERP.
 */
export const workspaceHeadCellClass =
  'sticky top-0 z-10 h-[36px] border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-header)] px-2.5 text-left text-[11px] font-semibold tracking-[0.02em] text-[color:var(--color-grid-head-ink)] whitespace-nowrap';

export const workspaceNumericHeadCellClass = cn(workspaceHeadCellClass, 'text-right');

/**
 * CELULA DE CORPO — 40px, a densidade de linha do contrato.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `max-h` NAO E REDUNDANTE COM `h` — ELE E O QUE FAZ A ALTURA VALER. MEDIDO.
 *
 * `h-[40px]` sozinho define a altura MINIMA de uma celula de tabela, nao a maxima: se o conteudo
 * pedir mais (uma linha de identificador FORTE + uma linha de contexto, que e o padrao do
 * identificador primario numa grade de ERP), a celula CRESCE e a densidade da grade se perde.
 *
 * Foi exatamente o que a prova de contrato mediu em Documentos, a 1600x900:
 *
 *     altura da linha de grade em /app/documents  =  47px   (contrato: 40px)
 *
 * 47px por linha entrega 17 registros na altura util onde 40px entrega 20 — uma perda de 15% de
 * produtividade por um titulo que cabe em uma linha. `max-h` fecha a altura, `leading-tight`
 * garante que as duas linhas caibam dentro dela, e `overflow-hidden` impede que o texto estoure a
 * celula em vez de ser truncado pelo proprio conteudo.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
export const workspaceCellClass =
  'h-[40px] max-h-[40px] overflow-hidden border-b border-[color:var(--color-border-subtle)] px-2.5 py-1 align-middle text-[13px] leading-tight text-[color:var(--color-text-primary)]';

export const workspaceNumericCellClass = cn(
  workspaceCellClass,
  'text-right font-medium tabular-nums whitespace-nowrap',
);

/**
 * LINHA SELECIONAVEL — o registro inteiro e o alvo, e a selecao tem accent a esquerda.
 *
 * SELECAO = AZUL DE INTERACAO (`--color-surface-selected`), nao teal.
 *
 * O teal e o acento de IDENTIDADE do CISNE (marca, accent contextual, apoio). A linha que o
 * operador esta operando e um estado de TRABALHO, e trabalho no CISNE e azul — a mesma familia da
 * acao primaria, do foco e da informacao. Com teal aqui, "selecionado" e "identidade da marca"
 * competiam pelo mesmo tom e a grade perdia a leitura de estado.
 */
export const workspaceRowClass =
  'group relative cursor-pointer transition-colors duration-100 hover:bg-[color:var(--color-grid-row-hover)] data-[selected=true]:bg-[color:var(--color-surface-selected)] data-[selected=true]:shadow-[inset_2px_0_0_0_var(--color-blue-600)]';

/** Celula com conteudo interativo — sobe acima do alvo de clique da linha. */
export const workspaceCellRaisedClass = cn(workspaceCellClass, 'relative z-[1]');
