/**
 * Interactive prompts for nopy CLI
 * @module nopy.prompts
 */
// @ts-ignore - no types available
import Enquirer from 'enquirer';
import fuzzy from 'fuzzy';
import inquirer from 'inquirer';
// @ts-ignore - no types available
import CheckboxPlus from 'inquirer-checkbox-plus-prompt';
import { z } from 'zod';
// Register the checkbox-plus prompt type for filterable multi-select
inquirer.registerPrompt('checkbox-plus', CheckboxPlus);
/**
 * Prompts the user to select cubes to execute with filtering support
 */
export async function CubeSelection(cubes) {
    const cubeChoices = Object.values(cubes)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((cube) => ({
        name: `${cube.id} - ${cube.name}`,
        value: cube.id,
        short: cube.id,
    }));
    // Clear terminal and move cursor to top
    process.stdout.write('\x1B[2J\x1B[0f');
    const terminalHeight = process.stdout.rows || 24;
    const pageSize = Math.max(10, terminalHeight - 5);
    console.log('\n  Cube Selection\n');
    console.log('  Type to filter • Space to select • Enter to confirm\n');
    const answers = await inquirer.prompt([
        {
            type: 'checkbox-plus',
            name: 'selectedCubes',
            message: 'Select cubes:',
            pageSize,
            highlight: true,
            searchable: true,
            source: (_answersSoFar, input) => {
                const searchTerm = input || '';
                if (!searchTerm)
                    return Promise.resolve(cubeChoices);
                const results = fuzzy.filter(searchTerm, cubeChoices, {
                    extract: (choice) => choice.name,
                });
                return Promise.resolve(results.map((r) => r.original));
            },
        },
    ]);
    return { selectedCubes: answers.selectedCubes };
}
export async function AuthSelection(useAuthKey) {
    if (useAuthKey)
        return { authMethod: 'ssh-key' };
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'authMethod',
            message: 'Select authentication method:',
            choices: ['ssh-key', 'password'],
        },
        {
            type: 'input',
            name: 'username',
            message: 'Enter username:',
            when: (answers) => answers.authMethod !== 'ssh-key',
        },
        {
            type: 'password',
            name: 'password',
            message: 'Enter password:',
            when: (answers) => answers.authMethod !== 'ssh-key',
        },
    ]);
    return answers;
}
export async function PasswordSelection(username) {
    const { password } = await inquirer.prompt([
        {
            type: 'password',
            name: 'password',
            message: `Enter password for ${username}:`,
        },
    ]);
    return password;
}
export async function HostSelection(hosts) {
    const selectedHost = await inquirer.prompt([
        {
            type: 'list',
            name: 'host',
            message: 'Select host from inventory',
            choices: ['docker', 'vagrant', ...hosts, 'custom'],
        },
        {
            type: 'input',
            name: 'customHost',
            message: 'Specify custom host address:',
            when: (answers) => answers.host === 'custom',
        },
        {
            type: 'input',
            name: 'vagrantVM',
            message: 'Specify vagrant machine:',
            default: 'default',
            when: (answers) => answers.host === 'vagrant',
        },
        {
            type: 'input',
            name: 'dockerContainer',
            message: 'Specify docker container name:',
            when: (answers) => answers.host === 'runtime:docker',
        },
    ]);
    if (selectedHost.host === 'vagrant')
        return `@vagrant/${selectedHost.vagrantVM}`;
    if (selectedHost.host === 'runtime:docker')
        return `@docker/${selectedHost.dockerContainer}`;
    return selectedHost.customHost ?? selectedHost.host;
}
function coerceValue(value, zodType) {
    if (typeof value !== 'string')
        return value;
    if (zodType instanceof z.ZodDefault)
        return coerceValue(value, zodType._def.innerType);
    if (zodType instanceof z.ZodOptional)
        return coerceValue(value, zodType._def.innerType);
    if (zodType instanceof z.ZodNullable) {
        if (value === 'null' || value === '')
            return null;
        return coerceValue(value, zodType._def.innerType);
    }
    if (zodType instanceof z.ZodBoolean)
        return value === 'true' || value === 'yes' || value === '1';
    if (zodType instanceof z.ZodNumber) {
        const num = Number(value);
        return Number.isNaN(num) ? value : num;
    }
    return value;
}
export async function VariableAssignment(cube, variables) {
    const schema = cube.manifest.schema.shape;
    const defaults = cube.getDefaults();
    const variablesToConfigure = {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
        if (variables.get(cube.id, 'params')[key] === undefined) {
            variablesToConfigure[key] = defaultValue;
        }
    }
    if (Object.keys(variablesToConfigure).length === 0)
        return;
    const choices = Object.entries(variablesToConfigure).map(([key, value]) => {
        const zodType = schema[key];
        const description = zodType?.description || key;
        return { name: key, message: description, initial: String(value ?? '') };
    });
    const form = new Enquirer.Form({
        name: 'variables',
        message: `[${cube.id}] ${cube.name}\n  (↑↓ navigate, Enter to submit)`,
        choices,
    });
    try {
        const result = await form.run();
        const coercedResult = {};
        for (const [key, value] of Object.entries(result)) {
            const zodType = schema[key];
            coercedResult[key] = zodType ? coerceValue(value, zodType) : value;
        }
        variables.assign(cube.id, 'prompts', coercedResult);
    }
    catch {
        // User cancelled
    }
}
