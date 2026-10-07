import { ModulePage, ModulePageHeader } from '../ui/module-layout';

export function AppHomePage() {
  return (
    <ModulePage>
      <ModulePageHeader
        title="Technical home"
        description="Authenticated application shell. No business modules, dashboards, or simulated metrics are available in this phase."
      />
      <section
        className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]"
        aria-labelledby="shell-capabilities-heading"
      >
        <h2 id="shell-capabilities-heading" className="mt-0 mb-2 text-base font-semibold text-gray-900">
          Navigation
        </h2>
        <p className="m-0 text-sm text-gray-600">
          Structural menu items may reflect candidate capabilities. The backend remains the
          authority for access decisions.
        </p>
      </section>
    </ModulePage>
  );
}
