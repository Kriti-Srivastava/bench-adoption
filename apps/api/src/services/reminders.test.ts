import { describe, expect, it } from 'vitest';
import { dueThreshold } from './reminders.ts';

describe('dueThreshold', () => {
  const thresholds = [60, 30, 7];

  it('is nothing while the end is far off', () => {
    expect(dueThreshold(61, thresholds)).toBeUndefined();
  });

  it('is the tightest threshold reached', () => {
    expect(dueThreshold(60, thresholds)).toBe(60);
    expect(dueThreshold(31, thresholds)).toBe(60);
    expect(dueThreshold(20, thresholds)).toBe(30);
    expect(dueThreshold(1, thresholds)).toBe(7);
  });
});
