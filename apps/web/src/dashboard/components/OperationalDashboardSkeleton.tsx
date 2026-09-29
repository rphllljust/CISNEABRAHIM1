export function OperationalDashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-busy="true" aria-live="polite">
      <div className="dashboard-skeleton__fold">
        <div className="dashboard-skeleton__decision" />
        <div className="dashboard-skeleton__kpi-row">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`kpi-${index}`} className="dashboard-skeleton__kpi" />
          ))}
        </div>
      </div>
      <div className="dashboard-skeleton__strip" />
      <div className="dashboard-skeleton__chart" />
    </div>
  );
}
