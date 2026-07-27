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
    console.log('Assigning', artefactId, scope, values);
    if (!this[scope][artefactId]) {
      this[scope][artefactId] = values;
    } else {
      Object.assign(this[scope][artefactId], values);
    }
  }

  get(artefactId: Variables.ArtefactId, scope?: Variables.Scope): TVariables {
    if (scope) {
      return this[scope][artefactId] || {};
    }
    return {
      ...this.global,
      ...this.defaults[artefactId],
      ...this.prompts[artefactId],
      ...this.params[artefactId],
    };
  }
}
