import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './utils/cn';
import { WorkspaceHeader } from './workspace-frame';

/**
 * Composicao visual "enterprise" — componentes OPT-IN.
 *
 * Nao substituem nem alteram `ModulePage`, `ModulePageHeader`, `FilterCard` ou `DataTable`:
 * sao usados apenas pelas telas que adotam o padrao explicitamente. Nenhum comportamento,
 * filtro, rota, capability ou estado muda — so a apresentacao.
 */

/* ------------------------------------------------------------------ cabeçalho */

export function EnterpriseListHeader({
  title,
  description,
  metrics,
  action,
}: {
  title: string;
  description?: string;
  metrics?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-3 border-b border-[color:var(--color-divider-strong)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-1 py-2.5">
        <div className="min-w-0">
          {/* Mesma escala e mesma cor do `WorklistHeader`: o titulo de area de trabalho e um papel
              unico no produto, nao um estilo por tela. */}
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-[color:var(--color-navy-800)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[13px] text-[color:var(--color-text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {metrics ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-divider)] bg-[color:var(--color-surface-header)] px-1 py-2">
          {metrics}
        </div>
      ) : null}
    </header>
  );
}

export type MetricTone = 'neutral' | 'warning' | 'critical' | 'info';

/*
 * TOM SEMANTICO DO INDICADOR — as mesmas familias de estado do produto.
 *
 * `info` era teal (`border-brand-200 bg-brand-50 text-brand-800`). Isso colocava a cor de
 * IDENTIDADE do CISNE no papel de INFORMACAO, enquanto o painel operacional usa azul para isso —
 * a mesma metrica lia em duas cores dependendo da tela. Azul = informacao/operacao em todo o
 * produto; teal fica reservado a identidade (logo, accent de navegacao, contexto).
 */
const METRIC_TONE: Record<MetricTone, string> = {
  neutral:
    'border-[color:var(--erp-border)] bg-[color:var(--erp-surface)] text-[color:var(--erp-text-secondary)]',
  info: 'border-[color:var(--color-info-border)] bg-[color:var(--color-info-bg)] text-[color:var(--erp-info)]',
  warning:
    'border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-fg)]',
  critical:
    'border-[color:var(--color-critical-border)] bg-[color:var(--color-critical-bg)] text-[color:var(--color-critical-fg)]',
};

export function EnterpriseMetric({
  value,
  label,
  tone = 'neutral',
}: {
  value: ReactNode;
  label: string;
  tone?: MetricTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-[72px] min-w-[132px] flex-col items-start justify-center gap-1 rounded-md border px-2.5 py-2 text-xs',
        METRIC_TONE[tone],
      )}
    >
      <strong className="text-lg leading-none font-semibold tabular-nums">{value}</strong>
      <span className="font-medium leading-tight">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- toolbar */

export function EnterpriseToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  /*
   * SUPERFICIE DE COMANDO — a governanca vive em `.cisne-command-surface` (theme.css), nao aqui.
   *
   * Antes esta barra era `bg-gray-50/70 border-b border-gray-200 px-3 py-2 items-end`: faixa tingida
   * (card deitado), cor hardcoded fora do sistema de superficies e alinhamento pela base. Agora a
   * barra NAO tem vocabulario proprio — ela e a superficie de comando do ERP, e qualquer tela que
   * use esta primitiva herda a mesma altura, a mesma regua e o mesmo alinhamento.
   */
  return <div className={cn('cisne-command-surface', className)}>{children}</div>;
}

/** Campo compacto de toolbar: rotulo pequeno acima, controle denso abaixo. */
export function EnterpriseField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[10px] font-semibold tracking-wide text-gray-500 uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Controle de toolbar: mesma semantica dos filtros atuais, densidade governada. */
export const enterpriseControlClass =
  'min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-2 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-border-control ring-inset outline-none focus:ring-2 focus:ring-focus-ring';

/* ---------------------------------------------------------------------- tabela */

/*
 * GRADE ENTERPRISE — sem caixa. A grade e a area de trabalho; o card de segundo nivel era o que
 * fazia a lista parecer CRUD dentro de um painel.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RECOMPOSTA NA GRAMATICA DE GRADE DO CONTRATO. MEDIDO, NAO ESTIMADO.
 *
 * Esta familia de classes era a SEGUNDA linguagem de grade do produto, e ela divergia da principal
 * (`workspaceHeadCellClass` / `workspaceCellClass` em `workspace-frame.tsx`). A divergencia nao era
 * cosmetica — foi medida na prova de contrato, a 1600x900:

 *     cabecalho de grade em /app/finance/receivables  =  26,2px   (contrato: 36px)
 *     cabecalho de grade em /app/finance/payables     =  26,2px   (contrato: 36px)
 *     linha da grade                                  =  28px     (contrato: 40px)
 *
 * Ou seja: a MESMA grade media 26px de cabecalho no Financeiro e 36px em Clientes. O operador
 * aprendia duas densidades para a mesma leitura, e o Financeiro — a tela com mais linhas do produto
 * — entregava 12 registros por dobra onde caberiam 18.
 *
 * A divergencia vinha de tres decisoes que nao pertenciam a esta folha:
 *
 *   bg-gray-100    cabecalho CINZA do Tailwind, fora do sistema de superficies
 *   --row-height   28px: o token de linha COMPACTA, aplicado como padrao
 *   brand-50       hover/selecao em TEAL — cor de identidade usada como estado
 *
 * Agora a familia aponta para os MESMOS tokens e valores da grade principal: cabecalho 36px em
 * `--color-surface-header` (#F8FAFC) com regua `--color-border-strong`, linha 40px, hover neutro e
 * selecao em AZUL de interacao. Uma grade, uma densidade, uma semantica.
 */
export const enterpriseTableCardClass = 'mb-1 w-full min-w-0 max-w-full overflow-x-auto bg-white';

export const enterpriseTableClass = 'w-full border-separate border-spacing-0';

export const enterpriseHeadCellClass =
  'sticky top-0 z-10 h-[var(--grid-head-height)] border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-header)] px-2.5 text-left text-[length:var(--type-caption-size)] font-semibold tracking-[0.02em] text-[color:var(--color-grid-head-ink)] uppercase';

export const enterpriseNumericHeadCellClass = cn(enterpriseHeadCellClass, 'text-right');

export const enterpriseCellClass =
  'h-[var(--row-height-comfortable)] border-b border-[color:var(--color-border-subtle)] px-2.5 py-1 align-middle text-[length:var(--type-body-size)] text-[color:var(--color-text-primary)]';

export const enterpriseCellMutedClass = cn(
  enterpriseCellClass,
  'text-[color:var(--color-text-secondary)]',
);

export const enterpriseNumericCellClass = cn(
  enterpriseCellClass,
  'text-right font-medium tabular-nums whitespace-nowrap',
);

export const enterpriseRowClass =
  'group transition-colors duration-100 hover:bg-[color:var(--color-grid-row-hover)] data-[selected=true]:bg-[color:var(--color-surface-selected)] data-[selected=true]:shadow-[inset_2px_0_0_0_var(--color-blue-600)]';

/* -------------------------------------------------------------- células ricas */

/** Coluna de identificacao: linha forte (codigo) + linha de contexto. */
export function PrimaryRecordCell({
  href,
  identifier,
  context,
  meta,
}: {
  href: string;
  identifier: string;
  context?: string | null;
  meta?: string | null;
}) {
  return (
    <div className="min-w-0">
      <Link
        to={href}
        className="text-[13px] font-semibold text-brand-800 no-underline hover:text-brand-900 hover:underline"
      >
        {identifier}
      </Link>
      {context ? (
        <p className="mt-0.5 max-w-[38ch] truncate text-xs text-gray-500" title={context}>
          {context}
        </p>
      ) : null}
      {meta ? <p className="mt-0.5 font-mono text-[11px] text-gray-400">{meta}</p> : null}
    </div>
  );
}

/**
 * ROW CLICK — o registro inteiro e a superficie de navegacao.
 *
 * Ate aqui so o codigo do registro era clicavel: acertar 12px de texto numa grade densa e um
 * alvo pobre, e o operador de ERP trabalha a lista inteira. Esta celula estica a area do link
 * por TODA a linha (`.worklist-row-link::after` no `theme.css`), sem duplicar destino nem
 * navegacao programatica: continua sendo um `<a>` real, entao clique do meio, "abrir em nova
 * aba", foco por teclado e leitor de tela seguem funcionando.
 *
 * As colunas de acao e de conteudo interativo ficam FORA desta celula — o link esticado nunca
 * cobre um botao.
 */
export function WorklistRowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={href} className={cn('worklist-row-link', className)}>
      {children}
    </Link>
  );
}

/**
 * Status com contexto: nunca um badge solto.
 *
 * `accent` desenha a barra lateral discreta de alerta — sinaliza o fato real sem pintar a linha.
 */
export function RecordStatusCell({
  badge,
  context,
  accent = 'none',
}: {
  badge: ReactNode;
  context?: ReactNode;
  accent?: 'none' | 'warning' | 'critical';
}) {
  const accentClass =
    accent === 'critical' ? 'before:bg-red-400' : accent === 'warning' ? 'before:bg-amber-400' : '';
  return (
    <div
      className={cn(
        'relative flex flex-col items-start gap-1',
        accent !== 'none' &&
          cn(
            'pl-2.5 before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5 before:rounded-full before:content-[""]',
            accentClass,
          ),
      )}
    >
      {badge}
      {context ? <span className="text-[11px] leading-tight text-gray-500">{context}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------- exceção operacional */

/**
 * EXCEPTION-FIRST — o fato que exige atenção vem ANTES do badge de status.
 *
 * Prazo vencido, alocação sem responsável, rascunho parado: quando o backend publica o fato,
 * a linha precisa denunciá-lo na primeira leitura. Nada aqui é calculado por score ou por
 * heurística de risco — cada exceção é uma condição booleana sobre campos que já chegaram do
 * contrato. Sem fato, o componente não renderiza nada.
 */
export function WorklistException({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'critical' | 'info';
}) {
  const toneClass = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    critical: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- ações */
/**
 * Uma acao primaria visivel; as secundarias ficam sob "•••" para nao competir.
 * Usa `<details>` nativo: sem biblioteca nova e sem estado de aplicacao.
 *
 * LADO A LADO, não empilhado. Empilhar gastava ~42px de altura por linha numa grade densa — o
 * mesmo espaço que uma célula de texto usa — e deixava o "•••" boiando sozinho num vazio abaixo do
 * botão. Em linha, a coluna de AÇÕES passa a ter a altura de um controle, e a grade volta a ser
 * densa sem perder nenhuma ação.
 */
export function RowActionMenu({
  primary,
  secondary,
  label,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  label: string;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-1">
      {primary}
      {secondary ? (
        <details className="relative">
          <summary
            className="cursor-pointer list-none rounded border border-transparent px-1.5 py-0.5 text-sm leading-none font-semibold text-gray-400 marker:content-[''] hover:border-gray-200 hover:bg-gray-100 hover:text-gray-700"
            aria-label={`Mais ações — ${label}`}
            title={`Mais ações — ${label}`}
          >
            •••
          </summary>
          {/*
            `data-elevated` — a escotilha SEMANTICA da governanca de superficie.

            O painel de "Mais ações" FLUTUA sobre a grade (posicionado `absolute`), e elevação
            em superfície flutuante é legítima: a regra global de `theme.css` preserva diálogo,
            menu, listbox, tooltip e overlay declarado.

            Ele não era nenhum desses para o seletor: é um `<div>` sem `role`, então a
            governança o tratava como superfície de trabalho e mandava remover a sombra — o que
            faria o menu se confundir com a linha atrás dele. `data-elevated` é exatamente o
            canal que a foundation reserva para este caso: elevação EXPLÍCITA, nunca default.
          */}
          <div
            data-elevated="true"
            className="cisne-raised-surface absolute right-0 z-20 mt-1 flex min-w-56 flex-col gap-0.5 rounded-md p-1 text-left"
          >
            {secondary}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Botao de acao primaria compacto, para uso dentro da linha.
 *
 * O primario e o UNICO elemento em brand na linha; por isso ele nao carrega contorno duplicado
 * (borda + fundo da mesma cor) — o que fazia a acao primaria da linha parecer um botao secundario
 * contornado, junto com todas as outras.
 */
export const rowPrimaryActionClass =
  'cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-cisne-action px-2 text-white no-underline transition-colors hover:bg-cisne-action-hover disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Acao secundaria dentro do menu "•••" — discreta ate o hover, para que o menu leia como lista de
 * comandos e nao como um bloco de botoes.
 */
export const rowSecondaryActionClass =
  'cisne-type-action w-full rounded px-2 py-1 text-left text-gray-600 no-underline hover:bg-gray-100 hover:text-gray-900';

/* -------------------------------------------------- worklist compacta (densa) */

/**
 * Gramatica de worklist enterprise — toolbar compacta + grade densa.
 *
 * `FilterCard` (padding de 6) e `moduleTableCellClass` (3.5 por linha) gastam a largura
 * do desktop sem entregar informacao: o operador ve poucas linhas e muito vazio. Estas
 * primitivas entregam a mesma semantica — busca, filtro, contagem, acao — em altura de
 * uma linha, para que mais registros caibam na primeira dobra.
 *
 * Sao OPT-IN: nenhum comportamento, filtro, rota, capability ou estado muda; telas que
 * nao as adotam permanecem identicas.
 */

/**
 * Cabecalho da worklist: titulo + contagem + contexto + acoes.
 *
 * `metrics` e a faixa OPCIONAL de indicadores do dominio, reservada para worklists que tem
 * numeros agregados reais (Frota). Ela mora DENTRO do cabecalho, na mesma faixa vertical das
 * demais telas: um resumo em cartao proprio empurrava a toolbar e a primeira linha da grade
 * para fora da dobra e fazia a tela parecer de outro produto.
 */
export function WorklistHeader({
  title,
  description,
  count,
  context,
  action,
  metrics,
}: {
  title: string;
  /**
   * Descrição curta da ÁREA DE TRABALHO — o que a carteira é, em uma linha.
   *
   * Existe separada de `context` de propósito: `context` declara o RECORTE ATIVO (muda a cada
   * filtro), e `description` declara a NATUREZA da área (não muda). Antes, as duas coisas
   * dividiam o mesmo lugar, e o operador perdia a segunda assim que aplicava o primeiro filtro.
   */
  description?: string;
  count?: number | null;
  context?: ReactNode;
  action?: ReactNode;
  metrics?: ReactNode;
}) {
  /*
   * CABEÇALHO INTEGRADO AO CANVAS — uma faixa, não um card.
   *
   * Antes: `border-y` + `bg-surface-header` (banda cinza) envolvendo um eyebrow "Área de trabalho",
   * um `<h1>` de 28px e uma linha de indicadores. Medido em 1600×900, esse bloco empilhado com as
   * faixas seguintes consumia 239px e deixava a TABELA com 226px — cinco linhas — e 301px vazios
   * abaixo. O cabeçalho dominava a tela: o sintoma exato de "página de cadastro".
   *
   * Agora: sem banda de fundo, sem eyebrow, título na escala de identidade de área (22px) e os
   * indicadores NA MESMA LINHA do título, à direita. O cabeçalho deixa de ser um bloco e passa a
   * ser a primeira linha da bancada.
   */
  return (
    <>
      <WorkspaceHeader
        title={title}
        identity={description}
        scope={context}
        action={action}
        status={
          typeof count === 'number' ? (
            <span
              aria-label={`${count} registros no recorte`}
              className="text-lg font-semibold tabular-nums"
            >
              {count}
            </span>
          ) : undefined
        }
      />
      {metrics ? <div className="mb-2 flex flex-wrap items-center gap-2">{metrics}</div> : null}
    </>
  );
}

/**
 * Barra compacta de filtros: uma linha, densa, alinhada a esquerda.
 *
 * FOUNDATION: perdeu a caixa branca contornada. A barra de filtros pertence a AREA DE TRABALHO, e
 * separa-se do cabecalho e da grade por DIVISOR — nao por mais uma caixa, que era o que fazia o
 * topo da funcao parecer "card de filtro + card de tabela" empilhados.
 */
export function WorklistFilterBar({
  children,
  meta,
  notice,
}: {
  children: ReactNode;
  meta?: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <section aria-label="Filtros da lista">
      <div className="cisne-filter-surface border-y border-gray-200 bg-white px-2 py-1">
        {children}
        <span className="hidden min-w-6 flex-1 sm:block" aria-hidden="true" />
        {meta ? <span className="cisne-type-helper ml-auto tabular-nums">{meta}</span> : null}
      </div>
      {notice ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-amber-200 bg-amber-50 px-2 py-1">
          {notice}
        </div>
      ) : null}
    </section>
  );
}

/** Rotulo + controle dentro da barra compacta (sem bloco vertical de card). */
export function WorklistField({
  label,
  htmlFor,
  children,
  grow = false,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', grow && 'min-w-52 flex-1')}>
      <label
        htmlFor={htmlFor}
        className="shrink-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Controle denso da barra compacta — altura governada pelo token de densidade. */
export const worklistControlClass =
  'min-h-[var(--control-height)] rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-border-control ring-inset outline-none focus:ring-2 focus:ring-focus-ring';

export const worklistSelectClass = cn(worklistControlClass, 'cursor-pointer');

/** Botao secundario da barra compacta ("Limpar filtros"), na mesma altura do controle. */
export const worklistButtonClass =
  'cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Limpar filtros — UM controle para as cinco worklists.
 *
 * So aparece quando existe recorte aplicado: um botao sempre visivel e ruido, e um botao
 * "Limpar" sem nada para limpar mente sobre o estado da tela. Telas que guardam o recorte
 * na URL passam apenas o proprio reset (`people`), sem duplicar comportamento.
 */
export function WorklistClearFilters({
  onClick,
  visible,
  label = 'Limpar filtros',
}: {
  onClick: () => void;
  visible: boolean;
  label?: string;
}) {
  if (!visible) {
    return null;
  }
  return (
    <button type="button" className={worklistButtonClass} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * GRADE DENSA — a FILA e a area de trabalho, nao um card dentro dela.
 *
 * Antes: `rounded-md border border-gray-200 bg-white` envolvendo a tabela. Como o `ModulePage`
 * tambem e branco, a grade aparecia como "tabela dentro de card" — a cardification de segundo
 * nivel. Agora a grade nao tem caixa: ela e delimitada pelo divisor do cabecalho da grade e pela
 * regua estrutural, e a hierarquia vem do cabecalho sticky e do alinhamento numerico.
 */
export const worklistTableCardClass =
  'mb-2 w-full min-w-0 max-w-full overflow-x-auto border-y border-[color:var(--color-divider-strong)] bg-white';

export const worklistTableClass = 'w-full border-separate border-spacing-0';

/**
 * Cabecalho pegajoso: fica ACIMA do link esticado da linha (`z-0`), senao o alvo de clique
 * cobriria o proprio cabecalho e o texto das colunas deixaria de ser selecionavel.
 *
 * A borda inferior e mais forte que a das linhas: e ela que separa ROTULO de DADO. Sem esse peso
 * diferente, cabecalho e corpo leem como a mesma massa.
 *
 * SUPERFICIE TONAL E COR DE TEXTO DA BALIZA: o cabecalho da grade usa o mesmo `surface-header`
 * (#EAF0F6) e o mesmo navy-acinzentado (#31455C) do grid de `/app`. Antes ele era `bg-gray-50` com
 * `text-gray-600` — um cinza que nao pertence a paleta CISNE e que fazia a mesma grade ler
 * diferente em cada modulo.
 */
export const worklistHeadCellClass =
  'sticky top-0 z-10 border-b border-[color:var(--color-divider-strong)] bg-[color:var(--color-surface-header)] px-2 py-1 text-left text-[length:var(--type-micro-size)] font-semibold tracking-wide text-[color:var(--grid-head-ink)] uppercase whitespace-nowrap';

export const worklistNumericHeadCellClass = cn(worklistHeadCellClass, 'text-right');

export const worklistCellClass =
  'relative h-[var(--row-height)] border-b border-[color:var(--color-border-subtle)] px-2.5 py-1 align-middle text-[length:var(--type-body-size)] text-[color:var(--color-text-primary)]';

export const worklistNumericCellClass = cn(
  worklistCellClass,
  'text-right font-medium tabular-nums whitespace-nowrap',
);

/**
 * Celula de conteudo de linha navegavel: sobe acima do link esticado.
 *
 * `position: relative` + `z-index` cria o contexto de empilhamento que mantem o texto
 * selecionavel e os controles internos (badges com `title`, por exemplo) clicaveis, enquanto o
 * vazio da propria celula continua entregando o clique ao link do registro.
 */
export const worklistCellRaisedClass = cn(worklistCellClass, 'z-[1]');

/** Grupo semantico de colunas dentro da grade densa (mesma linguagem em todas as worklists). */
export const worklistGroupClass =
  'text-[length:var(--type-micro-size)] font-semibold tracking-widest text-[color:var(--color-text-muted)]';

/*
 * LINHA — HOVER AZUL CLARO, SELECAO #EAF3FF COM ACCENT AZUL A ESQUERDA.

 * Antes: `hover:bg-brand-50/60` e selecao em teal (identidade). Duas consequencias: a linha sob o
 * cursor ficava TEAL, que e a cor de identidade do CISNE e nao de interacao; e o accent de selecao
 * competia com o teal da sidebar. Azul e a cor de OPERACAO e INTERACAO no sistema — hover e selecao
 * de grade pertencem a ela.
 */
export const worklistRowClass =
  'relative cursor-pointer transition-colors hover:bg-[color:var(--color-grid-row-hover)] data-[selected=true]:bg-[color:var(--color-surface-selected)] data-[selected=true]:shadow-[inset_3px_0_0_var(--color-blue-600)]';

/**
 * Celula de ACOES: nunca herda o clique de navegacao da linha.
 *
 * Sem esta barreira, clicar em "Publicar"/"Editar" dispararia tambem o `onClick` do `<tr>` e a
 * navegacao venceria a acao. Ela tambem mantem `stopPropagation` no teclado, para que ativar um
 * controle por Enter/Espaco nao abra o registro por baixo.
 */
export function RowActionCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(worklistCellClass, 'z-[1] text-right whitespace-nowrap', className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ paginacao */

/**
 * Rodape da lista: faixa de registros + paginacao, no MESMO lugar das cinco telas.
 *
 * Sem `total` publicado pelo contrato, o intervalo e o que a pagina realmente contem — nunca
 * uma contagem estimada. `extra` carrega o recorte local declarado em texto ("3 de 20 nesta
 * pagina") para que paginacao e filtro nao se contradigam na mesma linha.
 */
export function WorklistFooter({
  rangeLabel,
  extra,
  children,
}: {
  rangeLabel?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[color:var(--color-divider)] px-1 pt-2 pb-1">
      <p className="text-[11px] text-[color:var(--color-text-muted)] tabular-nums">
        {rangeLabel}
        {rangeLabel && extra ? ' · ' : null}
        {extra}
      </p>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------- estados vazios / erro / sem permissao */

/**
 * Estados de lista na MESMA moldura — vazio, recorte sem resultado, negado e erro.
 *
 * Antes cada tela resolvia isso do seu jeito: uma frase solta, um cartao com sombra, um
 * paragrafo vermelho. O operador trocava de tela e mudava a gramatica. Aqui a moldura e unica
 * e o conteudo diz a verdade: o que aconteceu e qual e a proxima acao REAL (cadastrar quando a
 * criacao e permitida; limpar o recorte quando o vazio vem do filtro).
 */
export function WorklistStatePanel({
  tone = 'neutral',
  title,
  description,
  action,
}: {
  tone?: 'neutral' | 'critical';
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const isCritical = tone === 'critical';
  return (
    /*
      ESTADO COMPACTO — a mesma moldura nas cinco worklists, e NUNCA um bloco gigante.

      `px-4 py-4` produzia ~90px de altura para dizer uma frase, e em quatro telas isso empurrava a
      grade. O estado de lista pertence a AREA DE TRABALHO: uma faixa densa, sem caixa elevada, com
      a acao REAL ao lado do texto — nao um hero de empty state.
    */
    <section
      role={isCritical ? 'alert' : 'status'}
      aria-live={isCritical ? undefined : 'polite'}
      className={cn(
        'mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y px-3 py-2.5',
        isCritical
          ? 'border-[color:var(--color-red-100)] bg-[color:var(--color-surface-critical)]'
          : 'border-[color:var(--erp-border)] bg-[color:var(--erp-surface-support)]',
      )}
    >
      <p
        className={cn(
          'm-0 text-[13px] font-semibold',
          isCritical ? 'text-[color:var(--color-red-700)]' : 'text-[color:var(--erp-text)]',
        )}
      >
        {title}
      </p>
      {description ? (
        <p
          className={cn(
            'm-0 text-xs',
            isCritical ? 'text-[color:var(--color-critical-fg)]' : 'text-[color:var(--erp-text-muted)]',
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div> : null}
    </section>
  );
}
