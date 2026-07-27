export class Variables {
    global;
    /** @summary env as configured in cube or session script */
    defaults = {};
    /** @summary env as configured via prompts */
    prompts = {};
    /** @summary env as handed via params (on hook calls) */
    params = {};
    constructor(global = {}) {
        this.global = global;
    }
    assign(artefactId, scope, values = {}) {
        console.log('Assigning', artefactId, scope, values);
        if (!this[scope][artefactId]) {
            this[scope][artefactId] = values;
        }
        else {
            Object.assign(this[scope][artefactId], values);
        }
    }
    get(artefactId, scope) {
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
