/**
 * Interactive prompts for nopy CLI
 * @module nopy.prompts
 */
import { z } from 'zod';
import type { Cube } from './cubes/index.js';
import type { Variables } from './nopy.common.js';
/**
 * Prompts the user to select cubes to execute with filtering support
 */
export declare function CubeSelection(cubes: Record<string, Cube>): Promise<{
    selectedCubes: string[];
}>;
export declare function AuthSelection(useAuthKey?: boolean): Promise<{
    authMethod: string;
    username?: string;
    password?: string;
}>;
export declare function PasswordSelection(username: string): Promise<string>;
export declare function HostSelection(hosts: string[]): Promise<string>;
export declare function VariableAssignment<S extends z.AnyZodObject>(cube: Cube<S>, variables: Variables): Promise<void>;
