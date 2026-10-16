import { useLocation } from 'react-router-dom';
import { Breadcrumb } from '../ui/Breadcrumb';
import { resolveShellBreadcrumbs } from './nav-config';

export function ShellBreadcrumbs() {
  const location = useLocation();
  const items = resolveShellBreadcrumbs(location.pathname);

  if (items.length <= 1) {
    return null;
  }

  return (
    <div className="shell-breadcrumbs">
      <Breadcrumb items={items} className="shell-breadcrumbs__trail" />
    </div>
  );
}
