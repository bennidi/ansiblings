# Nopy Refactoring Plan

This document tracks the major refactoring of the `nopy` package.

## Refactoring Items

### 1. Remove parallel execution
- **Status**: ✅ Completed
- **Goal**: Remove all logic supporting parallel execution of cubes to simplify the execution flow and improve reliability.
- **Rationale**: The feature never shipped. Concurrent pyinfra processes interleave their output, which made deployment logs unreadable — a cost that outweighed the wall-clock saving. Do not reintroduce it without first solving per-cube output buffering.
- **Context**:
    - Parallelism removed from `NopyConfig`, `NopyOptions`, and `executeDeployCalls`.
    - `buildExecutionStages` deleted.
    - CLI flags `--parallel` and `--concurrency` removed.
    - Documentation caught up later: `README.md`, `docs/API.md`, and `docs/HOOKS.md` had all continued to describe the feature as if it existed.
- **Proposed Solution**: (Done)

### 2. Rework cube building process & Dependency Resolution
- **Status**: ✅ Completed
- **Goal**: Allow dependencies to be defined as a function of the collected variables.
- **New Signature**: `dependencies?: (variables: CubeVariables) => DependencySpec[]`
- **Architectural Change**: Implement a clean, step-based resolution mechanism using a `BuildContext`.
- **Context**:
    - Introduced `BuildContext` in `cubes/dependencies.ts` which handles recursive resolution, variable collection, and hook execution.
    - Resolution is now dynamic: variables are collected for a cube before its dependencies are resolved.
- **Proposed Solution**: (Done)

### 3. Remove `env` property from cube Manifest
- **Status**: ✅ Completed
- **Goal**: Remove the `env` property from the cube manifest.
- **Context**:
    - `env` removed from `Manifest` and `Env` types.
    - Responsibility for defaults shifted entirely to Zod schema defaults and `getDefaults()`.
- **Proposed Solution**: (Done)

### 4. Redesign Manifest and Cube types
- **Status**: ✅ Completed
- **Goal**: Transition from `Env -> Manifest -> Cube` inheritance to a cleaner `Manifest` (specification) and `Cube` (runtime) separation.
- **Context**:
    - `Manifest` is now a clean interface with a factory namespace.
    - `Cube` is a class encapsulating a `Manifest` and runtime info (`dir`, `deployScript`).
- **Proposed Solution**: (Done)

