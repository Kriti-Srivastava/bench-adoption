import fastJson from 'fast-json-stringify';
import type { FastifySerializerCompiler } from 'fastify/types/schema.js';
import { z } from 'zod';

/**
 * Serialises responses with fast-json-stringify, compiled once per route from
 * the route's zod response schema.
 *
 * Like validating with zod, it writes only the fields the schema declares, so
 * nothing outside the API contract (an adopter's email on a public endpoint,
 * say) can leak into a response. It is several times faster than parsing
 * every response through zod, which matters for large lists such as the map.
 * Requests are still validated with zod.
 */
export const fastSerializerCompiler: FastifySerializerCompiler<z.ZodType> = ({ schema }) =>
  fastJson(
    outputSchema(
      z.toJSONSchema(schema, {
        target: 'draft-7',
        io: 'output',
        // e.g. transforms have no JSON Schema form; accept any value there.
        unrepresentable: 'any',
      }),
    ) as Parameters<typeof fastJson>[0],
  );

/**
 * Zod marks objects `additionalProperties: false`, a *validation* rule. For
 * serialising it's counter-productive: inside `anyOf` (e.g. an object or
 * null) it makes an object carrying an extra field match no branch, so the
 * response fails instead of the field being dropped. Undeclared fields are
 * never written either way, so the rule is removed.
 */
function outputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(outputSchema);
  if (node === null || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties' && value === false) continue;
    copy[key] = outputSchema(value);
  }
  return copy;
}
