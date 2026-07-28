/**
 * A schema that behaves like zod's but does not share zod's prototypes.
 *
 * Once cubes arrive from `node_modules`, the schema a manifest builds may come
 * from a *second* copy of zod — its own dependency, or one shipped inside a
 * bundle. Such a schema is structurally identical and `instanceof` blind to it.
 * Rebuilding the nodes as plain objects reproduces that from inside a single
 * process, so anything that reads zod's internals stays pinned to `def.type`.
 */

import type { z } from 'zod';

/** Strips the prototype off a schema node and everything it wraps. */
function strip(node: unknown): unknown {
  const def = { ...(node as { def: Record<string, unknown> }).def };
  if (def.innerType) def.innerType = strip(def.innerType);
  return { def };
}

export function foreignZodSchema<S extends z.ZodObject<any>>(schema: S): S {
  return {
    // Parsing is not what is under test — delegate it and keep the real
    // behaviour, so only the introspection path sees the foreign nodes.
    safeParse: (value: unknown) => schema.safeParse(value),
    shape: Object.fromEntries(
      Object.entries(schema.shape).map(([key, node]) => [key, strip(node)])
    ),
  } as unknown as S;
}
