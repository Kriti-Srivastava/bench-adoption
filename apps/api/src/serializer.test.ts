import { describe, expect, it } from 'vitest';
import { benchList } from '@bench/shared';
import { fastSerializerCompiler } from './serializer.ts';

const serialize = fastSerializerCompiler({ schema: benchList, method: 'GET', url: '/', httpStatus: '200' });

describe('fastSerializerCompiler', () => {
  it('writes only fields in the contract, even when extra data is passed in', () => {
    const leaky = {
      items: [
        {
          id: '0b3e8a9e-8a1f-4a8e-9a0a-3c9f0c2b1d11',
          code: 'VC-001',
          name: 'Bench',
          zone: 'Lake',
          lat: 40.9,
          lng: -73.89,
          status: 'active',
          availability: 'adopted',
          trails: ['john-muir'],
          currentAdoption: {
            displayName: 'The Smiths',
            dedication: null,
            startDate: '2026-09-21',
            endDate: '2036-09-21',
            adopterEmail: 'private@example.org',
          },
          internalNotes: 'staff only',
        },
      ],
      nextCursor: null,
    };
    const json = serialize(leaky);
    expect(json).not.toContain('private@example.org');
    expect(json).not.toContain('staff only');
    expect(JSON.parse(json).items[0]).toMatchObject({ code: 'VC-001', currentAdoption: { displayName: 'The Smiths' } });
  });

  it('keeps nulls and nested arrays intact', () => {
    const json = serialize({ items: [], nextCursor: null });
    expect(JSON.parse(json)).toEqual({ items: [], nextCursor: null });
  });
});
