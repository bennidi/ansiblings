/**
 * Type definitions for Nopy cubes
 * @module cubes/types
 */

import { z } from 'zod';

/**
 * Any object schema, whatever its shape.
 *
 * Stands in for zod 3's `z.AnyZodObject`, which zod 4 removed.
 */
export type AnyObjectSchema = z.ZodObject<Record<string, z.ZodType<any>>>;

/**
 * Variables that can be passed to a cube
 */
export type CubeVariables = Record<string, string | number | boolean>;

/**
 * A dependency specification
 */
export type DependencySpec = string | [id: string, variables?: CubeVariables];

/**
 * Context passed to cube hooks for executing other cubes
 */
export interface HookContext {
  exec: (key: string, variables: CubeVariables) => Promise<void> | void;
}

/**
 * Hook function type for before/after cube execution
 */
export type Hook<Schema extends AnyObjectSchema = AnyObjectSchema> = (
  ctx: HookContext,
  variables: z.infer<Schema>
) => void | Promise<void>;

/**
 * User-defined specification for a cube
 */
export interface Manifest<Schema extends AnyObjectSchema = AnyObjectSchema> {
  /** Unique identifier for the cube (used for dependency references) */
  id: string;
  /** Human-readable name of the cube */
  name: string;
  /** Zod schema for validating cube variables */
  schema: Schema;
  /** Dynamic dependency resolver based on collected variables */
  dependencies?: (variables: z.infer<Schema>) => DependencySpec[];
  /** Hooks to run before cube execution */
  before?: Hook<Schema>[];
  /** Hooks to run after cube execution */
  after?: Hook<Schema>[];
}

/**
 * Factory function and namespace for Manifest
 */
export function Manifest<Schema extends AnyObjectSchema>(
  opts: Pick<Manifest<Schema>, 'name'> & Partial<Omit<Manifest<Schema>, 'name'>>
): Manifest<Schema> {
  return {
    id: opts.id ?? '',
    name: opts.name,
    schema: opts.schema ?? (z.object({}) as unknown as Schema),
    dependencies: opts.dependencies,
    before: opts.before ?? [],
    after: opts.after ?? [],
  };
}

export namespace Manifest {
  /**
   * Internal create helper
   */
  export function create<Schema extends AnyObjectSchema>(
    opts: Pick<Manifest<Schema>, 'name'> & Partial<Omit<Manifest<Schema>, 'name'>>
  ): Manifest<Schema> {
    return Manifest(opts);
  }
}

/**
 * Reads the `.default()` off a schema field, unwrapping the wrappers that may
 * sit above it (`.default().optional()`, `.default().nullable()`).
 *
 * Returns `undefined` for a field that declares no default — which is also how
 * `requiredKeys()` recognises a field the user has to supply.
 */
function defaultValueOf(zodType: z.ZodType): unknown {
  if (zodType instanceof z.ZodDefault) {
    const { defaultValue } = zodType._def as { defaultValue: unknown };
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
  }
  if (zodType instanceof z.ZodOptional || zodType instanceof z.ZodNullable) {
    return defaultValueOf(zodType._def.innerType as z.ZodType);
  }
  return undefined;
}

/**
 * A fully loaded cube with its filesystem location and runtime state
 */
export class Cube<Schema extends AnyObjectSchema = AnyObjectSchema> {
  constructor(
    public readonly manifest: Manifest<Schema>,
    public readonly dir: string,
    public readonly deployScript: string
  ) {}

  get id(): string {
    return this.manifest.id;
  }

  get name(): string {
    return this.manifest.name;
  }

  /**
   * Returns default values for the cube's schema.
   *
   * Parsing an empty object resolves every default in one go, but it fails
   * outright as soon as one field has no `.default()`. Falling back to a
   * per-field read keeps the defaults that *are* declared instead of dropping
   * the whole set — a single required field used to leave the cube with no
   * variables at all.
   */
  getDefaults(): z.infer<Schema> {
    const parsed = this.manifest.schema.safeParse({});
    if (parsed.success) return parsed.data as z.infer<Schema>;

    const defaults: Record<string, unknown> = {};
    for (const [key, zodType] of Object.entries(this.manifest.schema.shape)) {
      const value = defaultValueOf(zodType);
      if (value !== undefined) defaults[key] = value;
    }
    return defaults as z.infer<Schema>;
  }

  /**
   * Schema keys that have to be supplied from somewhere: no `.default()`, and
   * not optional. Nothing else can fill them in, so a run that cannot prompt
   * has to fail rather than deploy a cube with the value missing.
   */
  requiredKeys(): string[] {
    return Object.entries(this.manifest.schema.shape)
      .filter(([, zodType]) => !zodType.safeParse(undefined).success)
      .map(([key]) => key);
  }
}

/**
 * Result of loading cubes from the filesystem
 */
export interface LoadResult {
  /** Map of cube key to Cube object */
  cubes: Record<string, Cube>;
  /** List of errors encountered during loading */
  errors: string[];
}
