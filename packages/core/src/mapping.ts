import type { CanonicalRecord, EntitySyncConfig, FieldMapping, SyncDirection } from '@sales-connect/types';

export function directionAllows(direction: SyncDirection | undefined, flow: 'local_to_remote' | 'remote_to_local'): boolean {
  const d = direction ?? 'bidirectional';
  return d === 'bidirectional' || d === flow;
}

export function flattenCanonical(record: CanonicalRecord): Record<string, unknown> {
  return { ...record.fields, ...(record.customFields ?? {}) };
}

export function pickRemoteFields(config: EntitySyncConfig): string[] {
  return [...new Set(config.mappings.map(m => m.remote))];
}

export function toRemoteData(record: CanonicalRecord, config: EntitySyncConfig): Record<string, unknown> {
  const source = flattenCanonical(record);
  const out: Record<string, unknown> = {};
  for (const mapping of config.mappings) {
    if (!directionAllows(mapping.direction ?? config.direction, 'local_to_remote')) continue;
    if (Object.prototype.hasOwnProperty.call(source, mapping.local)) out[mapping.remote] = source[mapping.local];
  }
  return out;
}

export function toCanonicalFields(remoteFields: Record<string, unknown>, mappings: FieldMapping[], defaultDirection: SyncDirection = 'bidirectional') {
  const fields: Record<string, unknown> = {};
  const mappedRemote = new Set<string>();
  for (const mapping of mappings) {
    if (!directionAllows(mapping.direction ?? defaultDirection, 'remote_to_local')) continue;
    mappedRemote.add(mapping.remote);
    if (Object.prototype.hasOwnProperty.call(remoteFields, mapping.remote)) fields[mapping.local] = remoteFields[mapping.remote];
  }
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(remoteFields)) {
    if (!mappedRemote.has(key)) customFields[key] = value;
  }
  return { fields, customFields };
}
