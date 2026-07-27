import { ItemCatalog, loadItemCatalog } from './item-metadata';
import type { TrackedObject } from './models';
import { PortalCandidate, looksLikePortal } from './portal-automation';

/**
 * Resolves visible objects into named portal candidates. Dungeon portals carry
 * no NAME stat, so their display name comes from the object XML — the same
 * source the Flash client reads (`LineBuilder.getLocalizedObjectName`, see
 * Portal.makeNameBitmapData).
 */

let catalogCache: ItemCatalog | undefined;

/** Lazily loaded object metadata, shared by every consumer in this process. */
export function portalNameCatalog(): ItemCatalog {
  catalogCache ??= loadItemCatalog();
  return catalogCache;
}

/** Overrides the catalog (tests, or a pre-loaded catalog from the host). */
export function setPortalNameCatalog(catalog: ItemCatalog): void {
  catalogCache = catalog;
}

/** Best display name for an object: NAME stat first, then the XML name. */
export function resolveObjectName(object: TrackedObject, catalog: ItemCatalog): string | undefined {
  if (object.name) {
    return object.name;
  }
  const ref = catalog.ref(object.type);
  return ref.displayName ?? ref.name;
}

/** Every visible object that is a portal, with its name resolved. */
export function portalCandidates(
  objects: readonly TrackedObject[],
  catalog: ItemCatalog = portalNameCatalog(),
): PortalCandidate[] {
  const candidates: PortalCandidate[] = [];
  for (const object of objects) {
    const info = catalog.info(object.type);
    const name = resolveObjectName(object, catalog);
    if (!looksLikePortal(object.type, name, info?.className)) {
      continue;
    }
    candidates.push({ objectId: object.objectId, type: object.type, x: object.x, y: object.y, name });
  }
  return candidates;
}
