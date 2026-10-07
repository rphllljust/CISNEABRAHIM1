import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthzApiError, probeRequest } from '../auth/api/authz-api';
import { useAuth } from '../auth/context/AuthProvider';
import { DefinitionList } from '../financial-ui/DefinitionList';
import { ModulePage, ModulePageHeader } from '../ui/module-layout';

type ProbeState =
  | { status: 'loading' }
  | { status: 'ok'; identityId: string; sessionId: string }
  | { status: 'denied' }
  | { status: 'error' };

export function PlatformDiagnosticsPage() {
  const { expireSession } = useAuth();
  const [probe, setProbe] = useState<ProbeState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void probeRequest(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setProbe({
            status: 'ok',
            identityId: result.identityId,
            sessionId: result.sessionId,
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthzApiError && error.status === 401) {
          expireSession();
        }
        setProbe({
          status: error instanceof AuthzApiError && error.status === 403 ? 'denied' : 'error',
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [expireSession]);

  return (
    <ModulePage>
      <ModulePageHeader
        title="Platform diagnostics"
        description="Technical probe endpoint — no business data."
      />
      {probe.status === 'loading' ? (
        <p aria-busy="true" aria-live="polite">
          Running probe…
        </p>
      ) : null}
      {probe.status === 'ok' ? (
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
          <DefinitionList
            items={[
              { label: 'Probe status', value: 'ok' },
              { label: 'Identity', value: probe.identityId },
              { label: 'Session', value: probe.sessionId },
            ]}
          />
        </section>
      ) : null}
      {probe.status === 'denied' ? (
        <p role="alert">Access denied by the authorization service.</p>
      ) : null}
      {probe.status === 'error' ? <p role="alert">Unable to complete the probe request.</p> : null}
      <p>
        <Link to="/app">Back to home</Link>
      </p>
    </ModulePage>
  );
}
