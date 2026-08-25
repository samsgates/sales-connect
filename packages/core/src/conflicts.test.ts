import { describe, expect, it } from 'vitest';
import { detectThreeWayConflicts } from './conflicts.js';

const config = {
  entity: 'contact', direction: 'bidirectional', conflictStrategy: 'field_owner',
  mappings: [{ local: 'email', remote: 'Email', owner: 'remote' }, { local: 'usage', remote: 'Usage__c', owner: 'local' }]
} as const;

const rec = (email: string, usage: number) => ({ id: '1', entity: 'contact', fields: { email, usage } });

describe('three-way conflict detection', () => {
  it('detects only fields changed on both sides', () => {
    const previous = rec('a@x.com', 1);
    const local = rec('b@x.com', 2);
    const remote = rec('c@x.com', 1);
    const result = detectThreeWayConflicts(local, remote, previous, config as any);
    expect(result).toHaveLength(1);
    expect(result[0]?.field).toBe('email');
    expect(result[0]?.resolution).toBe('remote');
  });
});
