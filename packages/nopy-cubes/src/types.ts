/**
 * Type definitions for Nopy cubes
 * @module types
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
  /**
   * Schema keys holding secrets. Their values are never written to a session
   * file, and are masked wherever a command or a variable would be printed.
   *
   * A plain array rather than schema-level metadata on purpose: `.meta()` and
   * `.describe()` both store into zod's global registry, which is per-copy — a
   * manifest that builds its schema with its own zod writes the marker into a
   * registry this process cannot read. A missed `.describe()` costs an ugly
   * prompt label; a missed secret marker writes a password to disk, so this one
   * cannot be allowed to fail open. See {@link zodKind} for the same hazard.
   */
  secrets?: string[];
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
    secrets: opts.secrets ?? [],
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
 * zod's runtime discriminant for a schema node, as a plain string.
 *
 * `instanceof z.ZodDefault` compares against the *running* copy of zod. A cube
 * manifest is free to build its schema with a different copy — its own
 * dependency, or one shipped inside a bundle — and then every `instanceof`
 * quietly returns false and the caller falls through to a wrong answer instead
 * of failing. `def.type` holds across instances, so nothing here may go back to
 * `instanceof`.
 */
export function zodKind(zodType: unknown): string {
  return (zodType as { def: { type: string } }).def.type;
}

/**
 * The type a wrapper wraps — `.default()`, `.optional()`, `.nullable()`.
 * Only call this for a node whose {@link zodKind} is one of those.
 */
export function zodInner(zodType: unknown): z.ZodType {
  return (zodType as { def: { innerType: z.ZodType } }).def.innerType;
}

/**
 * Reads the `.default()` off a schema field, unwrapping the wrappers that may
 * sit above it (`.default().optional()`, `.default().nullable()`).
 *
 * Returns `undefined` for a field that declares no default — which is also how
 * `requiredKeys()` recognises a field the user has to supply.
 */
function defaultValueOf(zodType: z.ZodType): unknown {
  const kind = zodKind(zodType);
  if (kind === 'default') {
    // zod 4 exposes `defaultValue` as a getter that already invokes a lazily
    // declared default; the function branch is insurance against that changing.
    const { defaultValue } = (zodType as unknown as { def: { defaultValue: unknown } }).def;
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
  }
  if (kind === 'optional' || kind === 'nullable') {
    return defaultValueOf(zodInner(zodType));
  }
  return undefined;
}

/**
 * Where a cube was discovered.
 *
 * Worth carrying because a cube's own directory does not say how it got into
 * the run: `/…/node_modules/@acme/cubes-net/cubes/x` could equally have come
 * from a `cubeDirs` entry pointing straight at it.
 */
export type CubeSource =
  /** Found under a `cubeDirs` entry or a `.npcubes` marker, at `dir`. */
  | { type: 'dir'; dir: string }
  /** Contributed by a package named in `cubePackages`. */
  | { type: 'package'; packageName: string; dir: string };

/**
 * A fully loaded cube with its filesystem location and runtime state
 */
export class Cube<Schema extends AnyObjectSchema = AnyObjectSchema> {
  constructor(
    public readonly manifest: Manifest<Schema>,
    public readonly dir: string,
    public readonly deployScript: string,
    /** Defaults to the cube's own directory, for cubes built by hand. */
    public readonly source: CubeSource = { type: 'dir', dir }
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
   * Every key the schema declares, required or not.
   *
   * The question this answers is "does this cube claim to know about KEY", which
   * is not the same as "does it have a value for it" — a cube can read a key off
   * `host.data` that only the config `env` supplies. That distinction is what
   * decides whether a secret is allowed to travel to it.
   */
  schemaKeys(): string[] {
    return Object.keys(this.manifest.schema.shape);
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

  /** Schema keys the manifest declared as secrets. */
  get secrets(): string[] {
    return this.manifest.secrets ?? [];
  }

  isSecret(key: string): boolean {
    return this.secrets.includes(key);
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
