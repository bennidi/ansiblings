# apt:essentials

**Install essential packages**

## Purpose

This cube installs a curated collection of essential development tools and utilities that are commonly needed for server environments and development workflows.

## What This Cube Does

Installs the following packages via apt:

- **fish** - User-friendly command-line shell with autosuggestions and syntax highlighting
- **ranger** - Terminal-based file manager with vi key bindings
- **golang-go** - Go programming language compiler and tools
- **build-essential** - Essential compilation tools (gcc, g++, make, etc.)
- **python3** - Python 3 interpreter and standard library
- **pkg-config** - Helper tool for compiling applications and libraries
- **age** - Modern file encryption tool with small explicit keys

## Configuration

### Parameters

- **UPDATE** (boolean, default: `true`)
  - If already installed, should packages be updated?
  - Set to `false` to skip package cache updates and only install missing packages

## Dependencies

None - this cube can run standalone.

## Use Cases

This cube is ideal as a base dependency for other cubes that require:
- Basic development tools
- Modern shell environments
- File encryption capabilities
- Python or Go runtimes
