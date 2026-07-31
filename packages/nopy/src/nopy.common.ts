/**
 * Variable assignment and provenance
 * @module nopy.common
 */

/** What a cube variable can hold — the value types `--data KEY=VALUE` can carry. */
export type Value = string | number | boolean;

/** A flat bag of variable values, keyed by name. */
export type TVariables = Record<string, Value>;

/**
 * Where a value came from, in ascending precedence.
 *
 * The order is the point. It used to be implied by the field order of an object
 * literal inside `Variables.get()` — load-bearing, invisible, and one careless
 * reformat away from silently changing which value wins. Here it is stated once,
 * in {@link RANK}, and everything else derives from it.
 *
 * - `default` — a `.default()` on the cube's schema
 * - `env` — the `env` block of `.nopyrc.json`
 * - `session` — read back from a recorded session on replay
 * - `prompt` — what the user typed
 * - `param` — handed over by a dependency spec or a hook's `exec()`
 */
export type Origin = 'default' | 'env' | 'session' | 'prompt' | 'param';

const RANK: Record<Origin, number> = {
  default: 0,
  env: 1,
  session: 2,
  prompt: 3,
  param: 4,
};

/** One value handed to a variable, and where it came from. */
export interface Assignment {
  value: Value;
  origin: Origin;
}

/** What a secret shows as wherever a value would otherwise be printed. */
export const MASK = '********';

/**
 * One variable of one cube, and every value it has ever been given.
 *
 * Two orderings are kept, deliberately: {@link assignments} is the raw trace in
 * the order things happened, and {@link ordered} re-ranks it by origin. The
 * first answers "how did we get here", the second answers "what wins".
 */
export class Variable {
  /** Every assignment received, newest first. Never reordered. */
  readonly assignments: Assignment[] = [];

  /**
   * Declared a secret by the cube's manifest: kept out of saved sessions and
   * masked wherever the value would otherwise be printed.
   */
  redacted = false;

  constructor(
    readonly cube: string,
    readonly name: string,
    first: Assignment
  ) {
    this.assign(first);
  }

  assign(assignment: Assignment): void {
    this.assignments.unshift(assignment);
  }

  /**
   * The trace re-ranked by origin, winner first.
   *
   * Stability is load-bearing here. The trace is newest-first and
   * `Array.prototype.sort` is stable per spec, so two assignments sharing an
   * origin keep their relative order and the newer one stays in front: the
   * second dependency to pass a param wins, and the one it displaced is still
   * visible underneath instead of being overwritten out of existence.
   */
  get ordered(): Assignment[] {
    return [...this.assignments].sort((a, b) => RANK[b.origin] - RANK[a.origin]);
  }

  /** The assignment that wins. Never undefined — a Variable is born with one. */
  get effective(): Assignment {
    return this.ordered[0];
  }

  get value(): Value {
    return this.effective.value;
  }

  get origin(): Origin {
    return this.effective.origin;
  }

  /** Safe to log: a redacted variable never yields its value. */
  toJSON(): { cube: string; name: string; value: Value; origin: Origin } {
    return {
      cube: this.cube,
      name: this.name,
      value: this.redacted ? MASK : this.value,
      origin: this.origin,
    };
  }
}

/**
 * Every variable of every cube in one run, with its provenance.
 */
export class Variables {
  private readonly store: Record<string, Record<string, Variable>> = {};
  private readonly secrets: Record<string, Set<string>> = {};
  private readonly schemas: Record<string, Set<string>> = {};
  private readonly globalSecrets: Set<string>;

  /**
   * @param env - the `env` block of the merged config, seeded onto every cube
   * @param globalSecrets - every key *any* manifest declares secret, plus the
   *   config's own `secrets` list. Known up front, before the first cube
   *   resolves, so it does not depend on resolution order.
   */
  constructor(
    readonly env: TVariables = {},
    globalSecrets: Iterable<string> = []
  ) {
    this.globalSecrets = new Set(globalSecrets);
  }

  /**
   * Marks keys of one cube as holding secrets.
   *
   * Retroactive as well as prospective, so it does not matter whether the
   * caller declares before or after the values arrive.
   */
  declareSecrets(cube: string, keys: readonly string[]): void {
    this.secrets[cube] ??= new Set<string>();
    const declared = this.secrets[cube];
    for (const key of keys) declared.add(key);
    for (const variable of this.all(cube)) {
      if (declared.has(variable.name)) variable.redacted = true;
    }
  }

  /**
   * Records which keys a cube's schema declares.
   *
   * Only {@link bucket} reads this, and only to decide whether a globally
   * declared secret may be seeded from `env`. Call it before anything assigns to
   * the cube — it deliberately does not create the bucket itself, because
   * creating it is what seeds `env`.
   */
  declareSchema(cube: string, keys: readonly string[]): void {
    this.schemas[cube] ??= new Set<string>();
    const declared = this.schemas[cube];
    for (const key of keys) declared.add(key);
  }

  /**
   * Whether a key is sensitive for a cube.
   *
   * True for a key the cube's own manifest declared, and also for one *another*
   * manifest declared: a value that is a secret anywhere is a secret everywhere
   * it lands. That covers the manifest that lists `PASSWORD` in `schema` and
   * forgets it in `secrets`.
   */
  isSecret(cube: string, name: string): boolean {
    return (this.secrets[cube]?.has(name) ?? false) || this.globalSecrets.has(name);
  }

  /** Records values for one cube, all at the same origin. */
  assign(cube: string, origin: Origin, values: TVariables = {}): void {
    const bucket = this.bucket(cube);
    for (const [name, value] of Object.entries(values)) {
      const existing = bucket[name];
      if (existing) existing.assign({ value, origin });
      else bucket[name] = this.create(cube, name, { value, origin });
    }
  }

  /** Every variable known for one cube. */
  all(cube: string): Variable[] {
    return Object.values(this.store[cube] ?? {});
  }

  /** One variable, or `undefined` if nothing has ever assigned to it. */
  of(cube: string, name: string): Variable | undefined {
    return this.store[cube]?.[name];
  }

  /** The effective values for one cube — what goes on the pyinfra command line. */
  get(cube: string): TVariables {
    const values: TVariables = {};
    for (const variable of this.all(cube)) values[variable.name] = variable.value;
    return values;
  }

  /**
   * The effective values minus anything declared secret — what a session
   * records. A secret is left out entirely rather than masked, so a replay sees
   * it as absent and asks for it again.
   */
  persistable(cube: string): TVariables {
    const values: TVariables = {};
    for (const variable of this.all(cube)) {
      if (!variable.redacted) values[variable.name] = variable.value;
    }
    return values;
  }

  /**
   * The config's `env` block minus anything declared secret — what a session's
   * own `env` records.
   *
   * A session copies `env` verbatim for reference, which quietly undid
   * {@link persistable}: a credential declared in `.nopyrc.json` was kept out of
   * every cube's `variables` and then written to the same file one key higher up,
   * in plaintext, along with a copy in `.nopy.history.json`. Same rule as
   * `persistable`, applied to the same file.
   */
  persistableEnv(): TVariables {
    const values: TVariables = {};
    for (const [name, value] of Object.entries(this.env)) {
      if (!this.globalSecrets.has(name)) values[name] = value;
    }
    return values;
  }

  private create(cube: string, name: string, first: Assignment): Variable {
    const variable = new Variable(cube, name, first);
    variable.redacted = this.isSecret(cube, name);
    return variable;
  }

  /**
   * A cube's bucket, seeded on creation with the config `env`.
   *
   * `env` applies to every cube, so it becomes a real assignment on each of them
   * rather than a parallel bag merged in at read time. That is what lets it
   * carry an origin, show up in the trace, and lose to a prompt by the same rule
   * as everything else.
   *
   * One key is held back: a **secret**, on a cube whose schema does not mention
   * it. Broadcasting is otherwise load-bearing — a cube may legitimately read a
   * key off `host.data` that it never declared — but a credential does not
   * belong on the command line of every unrelated cube in the run, where nothing
   * masks it because that cube never declared it sensitive.
   */
  private bucket(cube: string): Record<string, Variable> {
    const existing = this.store[cube];
    if (existing) return existing;

    const bucket: Record<string, Variable> = {};
    this.store[cube] = bucket;
    for (const [name, value] of Object.entries(this.env)) {
      if (this.globalSecrets.has(name) && !this.schemas[cube]?.has(name)) continue;
      bucket[name] = this.create(cube, name, { value, origin: 'env' });
    }
    return bucket;
  }
}
