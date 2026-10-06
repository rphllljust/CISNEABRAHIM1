/**
 * COMMAND BAR — A BARRA DE ACOES DA PLATAFORMA
 *
 * Substitui os botoes escritos a mao em cada pagina. A tela entrega o contexto; a barra resolve
 * disponibilidade, pede entrada obrigatoria, confirma transicao sensivel e mostra o motivo real
 * de indisponibilidade.
 *
 * ---------------------------------------------------------------------------------------------
 * O QUE ESTA BARRA DELIBERADAMENTE FAZ
 * ---------------------------------------------------------------------------------------------
 *
 * 1. NAO RENDERIZA COMANDO `hidden`. Nem rotulo, nem contagem, nem "oculto". Sem capability, a
 *    acao nao existe para o operador.
 *
 * 2. NAO ESCONDE O MOTIVO. Comando desabilitado aparece com `title` e com `aria-describedby`
 *    apontando para o texto do motivo — quem usa leitor de tela recebe o mesmo que quem ve o
 *    tooltip. Botao cinza sem causa e o defeito original.
 *
 * 3. PEDE A ENTRADA ANTES, NAO DEPOIS. `inputs` obrigatorios abrem um painel de coleta. O
 *    operador descobre o que falta aqui, e nao por 400 do servidor depois do clique.
 *
 * 4. CONFIRMA O QUE E IRREVERSIVEL. `confirmation.consequence` e exibida antes de executar.
 *    Estorno nao tem desfazer: a frase de consequencia e parte do controle, nao decoracao.
 *
 * 5. NAO INVENTA ESTADO DE CARREGAMENTO FALSO. A barra nao sabe se o comando escreveu com
 *    sucesso — o handler e quem atualiza o dado. Ela apenas nao reexecuta enquanto a promessa
 *    esta pendente.
 */

import { useCallback, useState } from 'react';
import type { CommandContext, CommandInput, ResolvedCommand } from './types';
import { useCommands } from './use-commands';

export type CommandBarProps = {
  context: CommandContext;
  /** Limita a barra a estes ids, na ordem declarada. Ausente = todos do escopo. */
  only?: string[];
  className?: string;
  /** Rotulo do grupo quando a barra renderiza um subconjunto. */
  'aria-label'?: string;
};

export function CommandBar({ context, only, className, ...rest }: CommandBarProps) {
  const { commands, execute } = useCommands(context);
  const [pending, setPending] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<ResolvedCommand | null>(null);
  const [confirming, setConfirming] = useState<ResolvedCommand | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const visible = only
    ? only
        .map((id) => commands.find((command) => command.definition.id === id))
        .filter((entry): entry is ResolvedCommand => Boolean(entry))
    : commands;

  const run = useCallback(
    async (resolved: ResolvedCommand, values: Record<string, string>) => {
      setPending(resolved.definition.id);
      setFailure(null);
      try {
        const accepted = await execute(resolved.definition.id, { inputs: values });
        /**
         * `false` significa que a avaliacao negou a execucao entre o render e o clique — estado
         * do objeto mudou, capability caiu. Nao e erro de rede e nao se disfarca de sucesso.
         */
        if (!accepted) {
          setFailure(
            'A ação deixou de estar disponível para o estado atual do objeto. A tela será atualizada.',
          );
        }
      } catch (error) {
        setFailure(
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível concluir a ação.',
        );
      } finally {
        setPending(null);
      }
    },
    [execute],
  );

  const onSelect = useCallback(
    (resolved: ResolvedCommand) => {
      const inputs = resolved.definition.inputs ?? [];
      const needsCollection = inputs.length > 0;
      if (needsCollection) {
        const seeded: Record<string, string> = {};
        for (const input of inputs) {
          seeded[input.name] = context.inputs?.[input.name] ?? input.defaultValue ?? '';
        }
        setInputValues(seeded);
        setCollecting(resolved);
        return;
      }
      if (resolved.definition.confirmation) {
        setConfirming(resolved);
        return;
      }
      void run(resolved, {});
    },
    [context.inputs, run],
  );

  if (visible.length === 0) {
    // Sem comandos autorizados NADA e renderizado — nem uma barra vazia, que sugeriria ausencia
    // de acao onde ha ausencia de permissao.
    return null;
  }

  return (
    <div className={className} role="group" aria-label={rest['aria-label'] ?? 'Ações disponíveis'}>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((resolved) => (
          <CommandButton
            key={resolved.definition.id}
            resolved={resolved}
            pending={pending === resolved.definition.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {failure ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {failure}
        </p>
      ) : null}

      {collecting ? (
        <CommandInputPanel
          resolved={collecting}
          values={inputValues}
          onChange={(name, value) =>
            setInputValues((current) => ({ ...current, [name]: value }))
          }
          onCancel={() => setCollecting(null)}
          onConfirm={() => {
            const target = collecting;
            setCollecting(null);
            if (target.definition.confirmation) {
              setConfirming(target);
              return;
            }
            void run(target, inputValues);
          }}
        />
      ) : null}

      {confirming ? (
        <CommandConfirmPanel
          resolved={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            setConfirming(null);
            void run(target, inputValues);
          }}
        />
      ) : null}
    </div>
  );
}

function CommandButton({
  resolved,
  pending,
  onSelect,
}: {
  resolved: ResolvedCommand;
  pending: boolean;
  onSelect: (resolved: ResolvedCommand) => void;
}) {
  const { definition, availability } = resolved;
  const disabled = availability.status !== 'available';
  const reasonId = `${definition.id}-reason`;

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(resolved)}
        disabled={disabled || pending}
        aria-busy={pending}
        aria-describedby={disabled ? reasonId : undefined}
        title={disabled ? availability.reason : definition.description}
        className={[
          'rounded-md px-3 py-1.5 text-sm font-medium transition',
          disabled
            ? 'cursor-not-allowed bg-slate-100 text-slate-400'
            : 'bg-slate-900 text-white hover:bg-slate-700',
        ].join(' ')}
      >
        {pending ? `${definition.label}…` : definition.label}
      </button>
      {/*
        O motivo fica no DOM (nao so no `title`) porque tooltip nao alcanca leitor de tela nem
        teclado. Visualmente oculto, semanticamente presente.
      */}
      {disabled ? (
        <span id={reasonId} className="sr-only">
          {availability.reason}
        </span>
      ) : null}
    </>
  );
}

function CommandInputPanel({
  resolved,
  values,
  onChange,
  onCancel,
  onConfirm,
}: {
  resolved: ResolvedCommand;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const inputs = resolved.definition.inputs ?? [];
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">{resolved.definition.label}</h4>
      {resolved.definition.description ? (
        <p className="mt-1 text-sm text-slate-600">{resolved.definition.description}</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {inputs.map((input) => (
          <CommandInputField
            key={input.name}
            input={input}
            value={values[input.name] ?? ''}
            onChange={(value) => onChange(input.name, value)}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function CommandInputField({
  input,
  value,
  onChange,
}: {
  input: CommandInput;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `command-input-${input.name}`;
  const hintId = `${id}-hint`;
  const short = typeof input.minLength === 'number' && value.trim().length > 0
    && value.trim().length < input.minLength;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {input.label}
        {input.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {input.options ? (
        <select
          id={id}
          value={value}
          aria-describedby={input.hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">Selecione…</option>
          {input.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          id={id}
          value={value}
          rows={2}
          aria-describedby={input.hint ? hintId : undefined}
          aria-invalid={short || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      )}
      {input.hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {input.hint}
        </p>
      ) : null}
      {short ? (
        <p className="mt-1 text-xs text-amber-700">
          Mínimo de {input.minLength} caracteres.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Confirmacao de transicao sensivel.
 *
 * A CONSEQUENCIA e obrigatoria no contrato e vem do dominio. Um dialogo que so pergunta "tem
 * certeza?" nao informa nada: a decisao do operador e sobre o efeito, nao sobre a duvida.
 */
function CommandConfirmPanel({
  resolved,
  onCancel,
  onConfirm,
}: {
  resolved: ResolvedCommand;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmation = resolved.definition.confirmation;
  if (!confirmation) {
    return null;
  }
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={confirmation.title}
      className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <h4 className="text-sm font-semibold text-amber-900">{confirmation.title}</h4>
      <p className="mt-1 text-sm text-amber-800">{confirmation.consequence}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
        >
          {confirmation.confirmLabel}
        </button>
      </div>
    </div>
  );
}
