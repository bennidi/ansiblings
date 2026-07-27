/**
 * Environment variable configuration
 */
export type TVariables = Record<string, string | number | boolean>;
export declare namespace Variables {
    type ArtefactId = string;
    type Scope = 'defaults' | 'prompts' | 'params';
}
export declare class Variables {
    readonly global: TVariables;
    /** @summary env as configured in cube or session script */
    defaults: Record<Variables.ArtefactId, TVariables>;
    /** @summary env as configured via prompts */
    prompts: Record<Variables.ArtefactId, TVariables>;
    /** @summary env as handed via params (on hook calls) */
    params: Record<Variables.ArtefactId, TVariables>;
    constructor(global?: TVariables);
    assign(artefactId: Variables.ArtefactId, scope: Variables.Scope, values?: TVariables): void;
    get(artefactId: Variables.ArtefactId, scope?: Variables.Scope): TVariables;
}
