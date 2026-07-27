/**
 * Type definitions for Nopy cubes
 * @module cubes/types
 */
import { z } from 'zod';
/**
 * Factory function and namespace for Manifest
 */
export function Manifest(opts) {
    return {
        id: opts.id ?? '',
        name: opts.name,
        schema: opts.schema ?? z.object({}),
        dependencies: opts.dependencies,
        before: opts.before ?? [],
        after: opts.after ?? [],
    };
}
(function (Manifest) {
    /**
     * Internal create helper
     */
    function create(opts) {
        return Manifest(opts);
    }
    Manifest.create = create;
})(Manifest || (Manifest = {}));
/**
 * A fully loaded cube with its filesystem location and runtime state
 */
export class Cube {
    manifest;
    dir;
    deployScript;
    constructor(manifest, dir, deployScript) {
        this.manifest = manifest;
        this.dir = dir;
        this.deployScript = deployScript;
    }
    get id() {
        return this.manifest.id;
    }
    get name() {
        return this.manifest.name;
    }
    /**
     * Returns default values for the cube's schema
     */
    getDefaults() {
        try {
            return this.manifest.schema.parse({});
        }
        catch {
            return {};
        }
    }
}
