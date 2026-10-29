import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createGovernedUnit,
  listGovernedUnits,
  updateGovernedUnit,
  UnitGovernanceError,
  type UnitGovernanceDirectory,
} from '../api/unit-governance-api';

/**
 * Contextual governance inside Operations, not a parallel CRUD surface.
 * A manager edits the same authoritative organizational identity consumed by
 * Dispatch and Service-to-Cash. All decisions remain on the server.
 */
export function OperationalUnitGovernance({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [directory, setDirectory] = useState<UnitGovernanceDirectory | null>(null);
  const [selection, setSelection] = useState('');
  const [mode, setMode] = useState<'create' | 'edit'>('edit');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const replay = useRef<{ signature: string; key: string } | null>(null);

  async function refresh(signal?: AbortSignal) {
    const data = await listGovernedUnits(signal);
    if (signal?.aborted) return;
    setDirectory(data);
    setPhase('ready');
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setPhase(error instanceof UnitGovernanceError && error.status === 403 ? 'denied' : 'error');
    });
    return () => controller.abort();
  }, []);

  if (phase === 'denied' || phase === 'loading') return null;

  if (phase === 'error') {
    return (
      <div role="alert" className="mt-2 text-xs text-red-800">
        Identidade organizacional indisponível.
        <button type="button" className="ml-2 underline" onClick={() => {
          setPhase('loading');
          void refresh().catch(() => setPhase('error'));
        }}>Tentar novamente</button>
      </div>
    );
  }
  if (!directory) return null;
  const active = directory.items.find(unit => unit.id === selection) ?? directory.items[0] ?? null;
  const canEdit = active?.canManage === true;
  const allowCreate = directory.canCreate;

  function chooseEdit(id: string) {
    const chosen = directory?.items.find(unit => unit.id === id);
    if (!chosen) return;
    setSelection(id);
    setMode('edit');
    setCode(chosen.code);
    setName(chosen.name);
    setMessage(null);
    replay.current = null;
  }

  function chooseCreate() {
    setMode('create');
    setCode('');
    setName('');
    setMessage(null);
    replay.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (mode === 'create' && !allowCreate) || (mode === 'edit' && !canEdit)) return;
    if (mode === 'edit' && !active) return;
    const signature = JSON.stringify({
      mode, id: mode === 'edit' ? active?.id : null, expectedVersion: mode === 'edit' ? active?.version : null,
      code: code.trim(), name: name.trim(),
    });
    const idempotencyKey = replay.current?.signature === signature
      ? replay.current.key : crypto.randomUUID();
    replay.current = { signature, key: idempotencyKey };
    setBusy(true);
    setMessage(null);
    try {
      const saved = mode === 'create'
        ? await createGovernedUnit({ code, name, idempotencyKey })
        : await updateGovernedUnit(active!.id, {
          code, name, expectedVersion: active!.version, idempotencyKey,
        });
      await refresh();
      setSelection(saved.id);
      setMode('edit');
      setCode(saved.code);
      setName(saved.name);
      setMessage('Identidade empresarial registrada e versionada.');
      replay.current = null;
      onChanged();
    } catch (error) {
      setMessage(error instanceof UnitGovernanceError
        ? error.status === 409
          ? 'Conflito de código, versão ou reenvio. Recarregue o contexto antes de alterar.'
          : error.status === 403
            ? 'Comando recusado: falta autorização administrativa.'
            : error.status === 0
              ? 'Falha de rede. Reenvie sem modificar os campos para usar a mesma chave.'
              : 'A operação foi recusada pelo servidor. Verifique código e nome.'
        : 'Não foi possível concluir o comando.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-2 rounded-md border border-gray-200 px-3 py-2 text-xs" data-testid="unit-governance">
      <summary className="cursor-pointer font-semibold">Contexto empresarial · Governança das unidades</summary>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Unidades cadastradas" className="min-w-0">
          <p className="mb-2 text-gray-600">
            Identidade organizacional autorizada. O cadastro não depende de OS ou de permissões de despacho.
          </p>
          <div className="flex flex-wrap gap-2">
            {directory.items.map(unit => (
              <button key={unit.id} type="button" onClick={() => chooseEdit(unit.id)}
                className="max-w-full rounded border border-gray-300 px-2 py-1 text-left"
                aria-pressed={mode === 'edit' && active?.id === unit.id}>
                {unit.name} · {unit.code} <span className="text-gray-500">v{unit.version}</span>
              </button>
            ))}
          </div>
          {!directory.items.length ? <p>Nenhuma identidade empresarial cadastrada neste escopo.</p> : null}
        </section>
        <section aria-label="Comandos de identidade organizacional" className="min-w-0">
          <div className="mb-2 flex gap-2">
            {allowCreate ? (
              <button type="button" className="underline" onClick={chooseCreate}>Cadastrar unidade</button>
            ) : null}
            {canEdit ? (
              <button type="button" className="underline" onClick={() => chooseEdit(active!.id)}>
                Atualizar identidade
              </button>
            ) : null}
          </div>
          {(mode === 'create' && allowCreate) || (mode === 'edit' && canEdit) ? (
            <form onSubmit={event => void submit(event)} className="grid gap-2">
              <label className="grid gap-1">
                Código empresarial
                <input value={code} onChange={event => setCode(event.target.value)} required
                  maxLength={64} disabled={busy} className="min-h-10 w-full rounded border border-gray-300 px-2"/>
              </label>
              <label className="grid gap-1">
                Nome empresarial
                <input value={name} onChange={event => setName(event.target.value)} required
                  maxLength={200} disabled={busy} className="min-h-10 w-full rounded border border-gray-300 px-2"/>
              </label>
              {mode === 'edit' ? <p>Versão corrente: {active?.version}. Divergências exigem recarga.</p> : null}
              <button type="submit" disabled={busy} className="min-h-10 rounded bg-brand-700 px-3 py-1 text-white">
                {busy ? 'Salvando…' : mode === 'create' ? 'Registrar unidade' : 'Atualizar identidade'}
              </button>
            </form>
          ) : <p className="text-gray-600">Consulta permitida. Comandos exigem autoridade administrativa específica.</p>}
          {message ? <p role="status" className="mt-2">{message}</p> : null}
        </section>
      </div>
    </details>
  );
}
