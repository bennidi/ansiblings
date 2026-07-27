# apt

**Install packages with apt**

## Purpose

This is a generic cube for installing custom packages via the apt package manager. It's useful when you need to install specific packages that aren't covered by other specialized cubes.

## What This Cube Does

1. Optionally updates the apt package cache
2. Installs the specified space-separated list of packages

## Configuration

### Parameters

- **UPDATE** (boolean, default: `true`)
  - Update package cache before installing
  - Set to `false` to skip updating and only install packages

- **PACKAGES** (string, default: `''`)
  - Space-separated list of packages to install
  - Example: `"vim git htop curl wget"`

## Dependencies

None - this cube can run standalone.

## Use Cases

Install development tools:
```
PACKAGES="vim git htop tmux"
```

Install database clients:
```
PACKAGES="postgresql-client mysql-client redis-tools"
```

Install system utilities:
```
PACKAGES="curl wget jq unzip zip"
```

## Example

When deploying this cube, you would typically configure it like:
```javascript
exec('apt', {
  PACKAGES: 'nginx certbot python3-certbot-nginx',
  UPDATE: true
})
```

## Notes

- Package names must match exact apt package names
- Invalid package names will cause the installation to fail
- Use `apt search <package>` to find package names
- Some packages may require additional configuration after installation
