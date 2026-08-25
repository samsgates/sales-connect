import type { CanonicalRecord, EntitySyncConfig, FieldMapping } from '@sales-connect/types';
import { flattenCanonical } from './mapping.js';

export interface FieldConflictResult {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  previousValue: unknown;
  resolution: 'local' | 'remote' | 'manual';
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function resolveByMapping(mapping: FieldMapping | undefined, strategy: EntitySyncConfig['conflictStrategy'], local: CanonicalRecord, remote: CanonicalRecord): 'local' | 'remote' | 'manual' {
  if (strategy === 'local_wins') return 'local';
  if (strategy === 'remote_wins') return 'remote';
  if (strategy === 'latest_wins') {
    const lt = Date.parse(local.updatedAt ?? '') || 0;
    const rt = Date.parse(remote.updatedAt ?? '') || 0;
    return lt >= rt ? 'local' : 'remote';
  }
  if (strategy === 'manual' || strategy === 'custom') return 'manual';
  const owner = mapping?.owner ?? 'shared';
  if (owner === 'local') return 'local';
  if (owner === 'remote') return 'remote';
  return 'manual';
}

export function detectThreeWayConflicts(local: CanonicalRecord, remote: CanonicalRecord, previous: CanonicalRecord | null, config: EntitySyncConfig): FieldConflictResult[] {
  if (!previous) return [];
  const l = flattenCanonical(local);
  const r = flattenCanonical(remote);
  const p = flattenCanonical(previous);
  const results: FieldConflictResult[] = [];
  for (const mapping of config.mappings) {
    const field = mapping.local;
    const localChanged = !equal(l[field], p[field]);
    const remoteChanged = !equal(r[field], p[field]);
    if (localChanged && remoteChanged && !equal(l[field], r[field])) {
      results.push({
        field,
        localValue: l[field],
        remoteValue: r[field],
        previousValue: p[field],
        resolution: resolveByMapping(mapping, config.conflictStrategy ?? 'field_owner', local, remote)
      });
    }
  }
  return results;
}

export function applyResolvedValues(local: CanonicalRecord, remote: CanonicalRecord, resolutions: FieldConflictResult[]): CanonicalRecord {
  const merged: CanonicalRecord = { ...remote, fields: { ...remote.fields }, customFields: { ...(remote.customFields ?? {}) } };
  const localFlat = flattenCanonical(local);
  for (const resolution of resolutions) {
    if (resolution.resolution === 'local') merged.fields[resolution.field] = localFlat[resolution.field];
  }
  return merged;
}
