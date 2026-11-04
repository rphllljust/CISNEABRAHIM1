import { Link } from 'react-router-dom';
import { ArrowRight, GitBranch } from 'lucide-react';
import { WORK_DOMAIN_LABELS, type WorkDomain } from '../../work-inbox/api/work-inbox-api';
import { DOMAIN_WORKSPACE_PATHS } from '../domain-workspaces';

/**
 * The same functional route across six departments. Orientation only:
 * changing departments does not imply that any business transaction has advanced.
 */
const DOMAIN_FLOW: WorkDomain[] = [
  'COMERCIAL', 'OPERACOES', 'SUPRIMENTOS', 'FINANCEIRO', 'FISCAL', 'CONTABILIDADE',
];

export function EnterpriseJourneyBar({ active }: { active: WorkDomain }) {
  return (
    <nav
      aria-label="Navegação empresarial entre áreas"
      className="mb-3 overflow-hidden rounded border border-[#D6E0EA] bg-white"
      data-layout="enterprise-journey"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5EBF2] bg-[#F7F9FC] px-3 py-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-[#285F98]" aria-hidden />
          <p className="m-0 text-xs font-semibold text-[#284869]">Navegação entre áreas</p>
          <span className="text-[10px] text-[#6F8194]">Fluxo empresarial, não status transacional</span>
        </div>
        <Link
          to="/app/workspaces"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#285F98] no-underline hover:underline"
        >
          Central empresarial <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <ol className="m-0 flex list-none flex-wrap items-stretch gap-0 p-0">
        {DOMAIN_FLOW.map((domain, index) => {
          const activeItem = domain === active;
          return (
            <li key={domain} className="flex min-w-0 flex-1 items-stretch">
              <Link
                to={DOMAIN_WORKSPACE_PATHS[domain]}
                aria-current={activeItem ? 'step' : undefined}
                className={
                  'flex min-h-9 min-w-[7.25rem] flex-1 items-center gap-1.5 px-3 py-2 text-[11px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-[#2862A1] ' +
                  (activeItem
                    ? 'bg-[#E5F0FD] text-[#174B82] shadow-[inset_0_-2px_0_#2862A1]'
                    : 'text-[#58728D] hover:bg-[#F5F9FD]')
                }
              >
                <span className={
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ' +
                  (activeItem ? 'bg-[#2862A1] text-white' : 'bg-[#EDF2F7] text-[#65788E]')
                }>
                  {index + 1}
                </span>
                {WORK_DOMAIN_LABELS[domain]}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
