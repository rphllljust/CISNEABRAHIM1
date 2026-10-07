import { Link } from 'react-router-dom';
import { ErrorState } from '../ui/ErrorState';
import { ModulePage } from '../ui/module-layout';

export function ShellNotFoundPage() {
  return (
    <ModulePage>
      <ErrorState
        kind="not_found"
        title="Página não encontrada"
        message="O endereço solicitado não existe ou não está disponível nesta versão do sistema."
        action={
          <Link to="/app" className="shell-nav__link">
            Voltar ao painel
          </Link>
        }
      />
    </ModulePage>
  );
}
