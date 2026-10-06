import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, ConfirmAction, Field, Input, Textarea, VersionConflictBanner } from '../ui';
import { FormSection } from '../ui';
import { BackofficeApiError } from './enterprise-api';
import { createIdempotencyKey } from './idempotency';
import { ProcessingBanner } from './ProcessingBanner';

export function VersionedActionForm({
  title,
  description,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  reasonLabel,
  extraFields,
  disabled,
  variant = 'primary',
  onSubmit,
  onReload,
  mapError,
}: {
  title: string;
  description: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  reasonLabel?: string;
  extraFields?: Array<{ id: string; label: string; name: string; required?: boolean }>;
  disabled?: boolean;
  variant?: 'primary' | 'danger';
  onSubmit: (input: {
    reason?: string;
    extras: Record<string, string>;
    idempotencyKey: string;
  }) => Promise<void>;
  onReload?: () => void;
  mapError: (code: string | undefined, status: number) => string;
}) {
  const [reason, setReason] = useState('');
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const inflight = useRef(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  function handleOpen(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setConflict(false);
    setOpen(true);
  }

  function releaseInflight(): void {
    inflight.current = false;
  }

  async function handleConfirm() {
    if (inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setError(null);
    try {
      await onSubmit({
        reason: reason.trim() || undefined,
        extras,
        idempotencyKey: idempotencyKey.current,
      });
      setOpen(false);
      idempotencyKey.current = createIdempotencyKey();
      setReason('');
      setExtras({});
      releaseInflight();
    } catch (caught) {
      if (caught instanceof BackofficeApiError && caught.kind === 'version_conflict') {
        setConflict(true);
        setError(mapError(caught.code, caught.status));
      } else if (caught instanceof BackofficeApiError) {
        setError(mapError(caught.code, caught.status));
        releaseInflight();
      } else {
        setError(mapError(undefined, 0));
        releaseInflight();
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <FormSection title={title} description={description}>
      <form onSubmit={handleOpen} className="space-y-4">
        {(extraFields ?? []).map((field) => (
          <Field key={field.id} label={field.label} htmlFor={field.id} required={field.required}>
            <Input
              id={field.id}
              name={field.name}
              value={extras[field.name] ?? ''}
              onChange={(event) =>
                setExtras((current) => ({ ...current, [field.name]: event.target.value }))
              }
              required={field.required}
              disabled={disabled || processing}
            />
          </Field>
        ))}
        {reasonLabel ? (
          <Field label={reasonLabel} htmlFor={`${title}-reason`} required>
            <Textarea
              id={`${title}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              disabled={disabled || processing}
            />
          </Field>
        ) : null}
        {processing ? <ProcessingBanner /> : null}
        {conflict && error ? (
          <VersionConflictBanner message={error} onReload={() => (onReload ? onReload() : undefined)} />
        ) : null}
        {error && !conflict ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant={variant} disabled={disabled || processing} loading={processing}>
          {confirmLabel}
        </Button>
      </form>
      <ConfirmAction
        open={open}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        loading={processing}
        confirmDisabled={conflict}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          setOpen(false);
          releaseInflight();
        }}
      />
    </FormSection>
  );
}

export function CreateRecordForm({
  title,
  description,
  submitLabel,
  disabled,
  children,
  onSubmit,
  mapError,
  onSuccess,
  onConflictReload,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  submitLabel: string;
  disabled?: boolean;
  children: ReactNode;
  onSubmit: (idempotencyKey: string) => Promise<void>;
  mapError: (code: string | undefined, status: number) => string;
  /**
   * Chamado após um cadastro bem-sucedido. Páginas usam para limpar os campos
   * controlados e recarregar o registro atual (evita duplicar ao reenviar).
   */
  onSuccess?: () => void;
  /**
   * Ação de recarregamento para conflitos de versão / período fechado. Quando
   * ausente, o botão "Recarregar" do banner chama onSuccess (se houver) ou
   * apenas reconhece o aviso, mantendo os campos intactos.
   */
  onConflictReload?: () => void;
  /**
   * PROGRESSIVE DISCLOSURE — o cadastro começa FECHADO ou não.
   *
   * Numa tela cujo objeto é a LISTA, o formulário de criação aberto empurra a grade para fora
   * da primeira dobra: em 1440x900 o operador via "Abrir conta financeira" e os campos, e a
   * lista de contas — o motivo de ele ter aberto a tela — só aparecia depois de rolar. Fechado
   * por padrão, a superfície abre na fila; o cadastro aparece quando alguém decide cadastrar.
   *
   * Em telas cujo objeto É o cadastro (detalhe de objeto, abertura a partir de contexto), o
   * formulário continua aberto: lá ele é o conteúdo, não uma ação lateral.
   */
  defaultOpen?: boolean;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const inflight = useRef(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  function acknowledgeConflict(): void {
    setConflict(false);
    setError(null);
  }

  function handleConflictReload(): void {
    if (onConflictReload) {
      onConflictReload();
      return;
    }
    if (onSuccess) {
      onSuccess();
      return;
    }
    acknowledgeConflict();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inflight.current || disabled) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setError(null);
    setConflict(false);
    let completed = false;
    try {
      await onSubmit(idempotencyKey.current);
      idempotencyKey.current = createIdempotencyKey();
      completed = true;
    } catch (caught) {
      if (caught instanceof BackofficeApiError) {
        // 409 de versão/período fechado (inclui PAYROLL_PERIOD_CLOSED e os
        // códigos contábeis/fiscais de período fechado) nunca deve ser tratado
        // como sucesso silencioso: mostramos um banner com ação de recarregar.
        if (caught.kind === 'version_conflict' || caught.kind === 'closed_period') {
          setConflict(true);
        }
        setError(mapError(caught.code, caught.status));
      } else {
        setError(mapError(undefined, 0));
      }
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
    if (completed) {
      onSuccess?.();
    }
  }

  return (
    <FormSection
      title={title}
      description={open ? description : undefined}
      className="mb-6"
      /* Embutido numa lista, o botão JÁ anuncia a ação — o título repetido seria ruído. */
      hideTitle={!defaultOpen}
    >
      {/*
        FECHADO: o cabeçalho e a ação primária ficam visíveis; os campos só aparecem quando o
        operador decide cadastrar. `aria-expanded` declara o estado ao leitor de tela, e o
        conteúdo não é montado quando fechado — nenhum campo inativo no DOM.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs text-gray-500">
          {open ? 'Preencha os campos e confirme.' : 'O cadastro abre no mesmo lugar, sem sair da lista.'}
        </p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {open ? `Fechar ${title.toLowerCase()}` : title}
        </button>
      </div>
      {open ? (
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        {children}
        {processing ? (
          <div className="md:col-span-2">
            <ProcessingBanner />
          </div>
        ) : null}
        {conflict && error ? (
          <div className="md:col-span-2">
            <VersionConflictBanner message={error} onReload={handleConflictReload} reloadLabel="Recarregar" />
          </div>
        ) : null}
        {error && !conflict ? (
          <p className="text-sm text-red-700 md:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
        <div className="md:col-span-2">
          <Button type="submit" disabled={disabled || processing} loading={processing}>
            {submitLabel}
          </Button>
        </div>
      </form>
      ) : null}
    </FormSection>
  );
}
