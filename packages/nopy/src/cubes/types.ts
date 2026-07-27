/**
 * Type definitions for Nopy cubes
 * @module cubes/types
 */

import { z } from 'zod';

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
export type Hook<Schema extends z.AnyZodObject = z.AnyZodObject> = (
  ctx: HookContext,
  variables: z.infer<Schema>
) => void | Promise<void>;

/**
 * User-defined specification for a cube
 */
export interface Manifest<Schema extends z.AnyZodObject = z.AnyZodObject> {
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
export function Manifest<Schema extends z.AnyZodObject>(
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
  export function create<Schema extends z.AnyZodObject>(
    opts: Pick<Manifest<Schema>, 'name'> & Partial<Omit<Manifest<Schema>, 'name'>>
  ): Manifest<Schema> {
    return Manifest(opts);
  }
}

/**
 * A fully loaded cube with its filesystem location and runtime state
 */
export class Cube<Schema extends z.AnyZodObject = z.AnyZodObject> {
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
   * Returns default values for the cube's schema
   */
  getDefaults(): z.infer<Schema> {
    try {
      return this.manifest.schema.parse({});
    } catch {
      return {} as z.infer<Schema>;
    }
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
