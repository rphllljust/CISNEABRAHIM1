import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './utils/cn';

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
    <header className="mb-3 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {metrics ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/70 px-4 py-2">
          {metrics}
        </div>
      ) : null}
    </header>
  );
}

export type MetricTone = 'neutral' | 'warning' | 'critical' | 'info';

const METRIC_TONE: Record<MetricTone, string> = {
  neutral: 'border-gray-200 bg-white text-gray-700',
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-200 bg-red-50 text-red-800',
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
        'inline-flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-xs',
        METRIC_TONE[tone],
      )}
    >
      <strong className="text-sm font-semibold tabular-nums">{value}</strong>
      <span className="font-medium">{label}</span>
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
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-2 border-b border-gray-200 bg-gray-50/70 px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
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

/** Controle de toolbar: mesma semantica dos filtros atuais, densidade maior. */
export const enterpriseControlClass =
  'w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';

/* ---------------------------------------------------------------------- tabela */

export const enterpriseTableCardClass =
  'mb-4 overflow-x-auto rounded-lg border border-gray-200 bg-white';

export const enterpriseTableClass = 'w-full border-separate border-spacing-0';

export const enterpriseHeadCellClass =
  'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-gray-500 uppercase';

export const enterpriseNumericHeadCellClass = cn(enterpriseHeadCellClass, 'text-right');

export const enterpriseCellClass =
  'border-b border-gray-100 px-3 py-2.5 align-top text-[13px] text-gray-700';

export const enterpriseCellMutedClass = cn(enterpriseCellClass, 'text-gray-500');

export const enterpriseNumericCellClass = cn(
  enterpriseCellClass,
  'text-right tabular-nums whitespace-nowrap',
);

export const enterpriseRowClass = 'group transition-colors hover:bg-brand-50/40';

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
      {meta ? (
        <p className="mt-0.5 font-mono text-[11px] text-gray-400">{meta}</p>
      ) : null}
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
    accent === 'critical'
      ? 'before:bg-red-400'
      : accent === 'warning'
        ? 'before:bg-amber-400'
        : '';
  return (
    <div
      className={cn(
        'relative flex flex-col items-start gap-1',
        accent !== 'none' &&
          cn('pl-2.5 before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5 before:rounded-full before:content-[""]', accentClass),
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
          <div className="absolute right-0 z-20 mt-1 flex min-w-56 flex-col gap-1 rounded-md border border-gray-200 bg-white p-2 text-left shadow-lg">
            {secondary}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Botao de acao primaria compacto, para uso dentro da linha. */
export const rowPrimaryActionClass =
  'inline-flex items-center rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white no-underline transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

/** Acao secundaria dentro do menu "•••". */
export const rowSecondaryActionClass =
  'w-full rounded px-2 py-1 text-left text-xs font-medium text-gray-600 no-underline hover:bg-gray-50 hover:text-gray-900';

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
  count,
  context,
  action,
  metrics,
}: {
  title: string;
  count?: number | null;
  context?: ReactNode;
  action?: ReactNode;
  metrics?: ReactNode;
}) {
  return (
    <header className="mb-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
            {typeof count === 'number' ? (
              <span
                className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums"
                aria-label={`${count} registros na página`}
              >
                {count}
              </span>
            ) : null}
          </div>
          {context ? <p className="mt-0.5 text-xs text-gray-500">{context}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {metrics ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{metrics}</div> : null}
    </header>
  );
}

/** Barra compacta de filtros: uma linha, densa, alinhada a esquerda. */
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
    <section className="mb-2" aria-label="Filtros da lista">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5">
        {children}
        <span className="hidden min-w-6 flex-1 sm:block" aria-hidden="true" />
        {meta ? (
          <span className="ml-auto text-[11px] font-medium text-gray-500 tabular-nums">{meta}</span>
        ) : null}
      </div>
      {notice ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
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

/** Controle denso da barra compacta. */
export const worklistControlClass =
  'rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';

export const worklistSelectClass = cn(worklistControlClass, 'cursor-pointer');

/** Botao secundario da barra compacta ("Limpar filtros"), na mesma altura do controle. */
export const worklistButtonClass =
  'rounded border border-gray-300 bg-white px-2 py-1 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60';

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

/** Grade densa: cabecalho pegajoso e altura de linha reduzida. */
export const worklistTableCardClass =
  'mb-3 overflow-x-auto rounded-md border border-gray-200 bg-white';

export const worklistTableClass = 'w-full border-separate border-spacing-0';

/**
 * Cabecalho pegajoso: fica ACIMA do link esticado da linha (`z-0`), senao o alvo de clique
 * cobriria o proprio cabecalho e o texto das colunas deixaria de ser selecionavel.
 */
export const worklistHeadCellClass =
  'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-[11px] font-semibold tracking-wider text-gray-500 uppercase whitespace-nowrap';

export const worklistNumericHeadCellClass = cn(worklistHeadCellClass, 'text-right');

export const worklistCellClass =
  'relative border-b border-gray-100 px-2.5 py-1.5 align-middle text-[13px] text-gray-700';

export const worklistNumericCellClass = cn(
  worklistCellClass,
  'text-right tabular-nums whitespace-nowrap',
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
export const worklistGroupClass = 'text-[10px] font-semibold tracking-widest text-gray-400';

export const worklistRowClass = 'relative cursor-pointer transition-colors hover:bg-brand-50/40';

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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 px-1 pt-2 pb-1">
      <p className="text-[11px] text-gray-500 tabular-nums">
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
    <section
      role={isCritical ? 'alert' : 'status'}
      aria-live={isCritical ? undefined : 'polite'}
      className={cn(
        'mb-3 rounded-md border px-4 py-4',
        isCritical ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white',
      )}
    >
      <p className={cn('text-[13px] font-semibold', isCritical ? 'text-red-800' : 'text-gray-900')}>
        {title}
      </p>
      {description ? (
        <p className={cn('mt-1 text-xs', isCritical ? 'text-red-700' : 'text-gray-500')}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
    </section>
  );
}
