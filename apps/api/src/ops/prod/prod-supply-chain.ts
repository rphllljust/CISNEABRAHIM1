const REQUIRED_IMAGE_KEYS = [
  'PROD_POSTGRES_IMAGE',
  'PROD_MINIO_IMAGE',
  'PROD_MINIO_MC_IMAGE',
  'PROD_CADDY_IMAGE',
  'CISNE_API_IMAGE',
  'CISNE_WEB_IMAGE',
] as const;

const DIGEST_PINNED_IMAGE = /^.+@sha256:[0-9a-f]{64}$/i;

export type ProductionImageInventory = Record<
  (typeof REQUIRED_IMAGE_KEYS)[number],
  string
>;

export function loadProductionImageInventory(
  env: NodeJS.ProcessEnv = process.env,
): ProductionImageInventory {
  const inventory = {} as ProductionImageInventory;
  for (const key of REQUIRED_IMAGE_KEYS) {
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(`${key} is required and must be pinned by sha256 digest`);
    }
    inventory[key] = value;
  }
  return inventory;
}

export function assertProductionImagesPinned(
  inventory: ProductionImageInventory,
): void {
  const mutable = Object.entries(inventory)
    .filter(([, image]) => !DIGEST_PINNED_IMAGE.test(image))
    .map(([key, image]) => `${key}=${image}`);

  if (mutable.length > 0) {
    throw new Error(
      `Production container images must be immutable @sha256 references: ${mutable.join(', ')}`,
    );
  }
}
