# Vagrant

A Vagrant box is the cheapest way to run a cube against a real machine you can
throw away afterwards.

## The Vagrantfile

```ruby

Vagrant.configure("2") do |config|
    # DO NOT USE special characters in vm name
    config.vm.define "nopytestvm"
    config.vm.provider "vmware_desktop" do |vmware|
        vmware.gui = false
        vmware.allowlist_verified = true
      end
    config.vm.box = "bento/ubuntu-24.04"  # Use Ubuntu 24.04 box
    config.ssh.insert_key = false
    config.vm.box_check_update = false
    config.vm.hostname = "nopytestvm"
  end

```

## Naming the machine to nopy

The host string is `@vagrant/<name>`, where `<name>` is what `config.vm.define`
declared — `nopytestvm` above. It is pyinfra's connector syntax, not nopy's, and
it is the same shape as `@docker/<container-or-image>`.

Two ways to get there. Either pick `vagrant` in the host prompt and answer the
follow-up with the machine name, which is what builds the string for you, or put
it in `.nopyrc.json` so it appears in the list directly:

```json
{
  "hosts": ["@vagrant/nopytestvm"],
  "cubePackages": ["@bitsquare/nopy-cubes-core"]
}
```

pyinfra runs `vagrant status --machine-readable` to find the available machines
and `vagrant ssh-config` for the SSH port, so `vagrant` has to be on `PATH` and
the box has to be `up` before a deploy.

## Cleaning up

```sh
vagrant halt        # stop it, keep the disk
vagrant destroy -f  # delete it — the next `vagrant up` is a fresh box
```

`destroy` is the one to use between test runs of a cube that is not idempotent:
re-running against a half-configured box tests something other than the cube.
