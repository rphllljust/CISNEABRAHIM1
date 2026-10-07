import { VERSION_CONFLICT_MESSAGE } from '../api/asset-error-messages';

type AssetVersionConflictNoticeProps = {
  onReload: () => void;
};

export function AssetVersionConflictNotice({ onReload }: AssetVersionConflictNoticeProps) {
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      role="alert"
    >
      <p className="mt-0 mb-2">{VERSION_CONFLICT_MESSAGE}</p>
      <button type="button" className="button-secondary" onClick={onReload}>
        Recarregar dados atuais
      </button>
    </div>
  );
}
