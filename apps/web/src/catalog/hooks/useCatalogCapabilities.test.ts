import { describe, expect, it } from 'vitest';
import { catalogCapabilitiesFromPermissions } from './useCatalogCapabilities';

describe('catalogCapabilitiesFromPermissions', () => {
  it('projects catalog grants from the authoritative session permission set', () => {
    const permissions = new Set([
      'catalog:service:list',
      'catalog:service:create',
      'catalog:service:read',
      'catalog:service:update',
      'catalog:service:publish',
    ]);

    expect(catalogCapabilitiesFromPermissions((permission) => permissions.has(permission))).toEqual({
      canList: true,
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canPublish: true,
      canDeactivate: false,
      canActivate: false,
    });
  });

  it('fails closed when the permission is absent', () => {
    expect(catalogCapabilitiesFromPermissions(() => false)).toEqual({
      canList: false,
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canPublish: false,
      canDeactivate: false,
      canActivate: false,
    });
  });
});
