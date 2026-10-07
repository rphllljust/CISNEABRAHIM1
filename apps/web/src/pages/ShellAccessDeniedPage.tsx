import { Link, useLocation } from 'react-router-dom';
import { ErrorState } from '../ui/ErrorState';
import { ModulePage } from '../ui/module-layout';

type ShellAccessState = {
  from?: string;
  capabilityId?: string;
  reason?: 'capability' | 'feature_disabled';
  moduleId?: string;
};

export function ShellAccessDeniedPage() {
  const location = useLocation();
  const state = (location.state as ShellAccessState | null) ?? {};
  const capabilityLabel = state.capabilityId ?? 'permissão necessária';
  const featureDisabled = state.reason === 'feature_disabled';

  return (
    <ModulePage>
      <ErrorState
        kind="denied"
        title="Acesso negado"
        message={
          featureDisabled
            ? `O módulo ${state.moduleId ?? 'solicitado'} não faz parte da Release 1 e está desligado (fail-closed).`
            : `Você não possui a permissão ${capabilityLabel} exigida para esta área. A autorização é aplicada pelo backend.`
        }
        action={<Link to="/app">Voltar ao painel</Link>}
      />
      {state.from ? (
        <p className="cisne-type-caption">
          Caminho solicitado: <code>{state.from}</code>
        </p>
      ) : null}
    </ModulePage>
  );
}
