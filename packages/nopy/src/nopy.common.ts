/**
 * Environment variable configuration
 */
export type TVariables = Record<string, string | number | boolean>;

export namespace Variables {
  export type ArtefactId = string;
  export type Scope = 'defaults' | 'prompts' | 'params';
}

export class Variables {
  /** @summary env as configured in cube or session script */
  defaults: Record<Variables.ArtefactId, TVariables> = {};
  /** @summary env as configured via prompts */
  prompts: Record<Variables.ArtefactId, TVariables> = {};
  /** @summary env as handed via params (on hook calls) */
  params: Record<Variables.ArtefactId, TVariables> = {};

  constructor(readonly global: TVariables = {}) {}

  assign(artefactId: Variables.ArtefactId, scope: Variables.Scope, values: TVariables = {}) {
    if (!this[scope][artefactId]) {
      this[scope][artefactId] = values;
    } else {
      Object.assign(this[scope][artefactId], values);
    }
  }

  /**
   * Merges the scopes for one cube, lowest precedence first:
   * schema defaults → global `env` → prompts (or replayed session values) →
   * params handed over by a dependency or a hook.
   *
   * Defaults sit at the bottom so `env` in `.nopyrc.json` can steer a run that
   * never prompts (`--use-defaults`); a key that a dependency supplies is never
   * prompted for, so prompts and params do not compete in practice.
   */
  get(artefactId: Variables.ArtefactId, scope?: Variables.Scope): TVariables {
    if (scope) {
      return this[scope][artefactId] || {};
    }
    return {
      ...this.defaults[artefactId],
      ...this.global,
      ...this.prompts[artefactId],
      ...this.params[artefactId],
    };
  }
}
