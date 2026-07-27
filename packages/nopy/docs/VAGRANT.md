# Vagrant

`vagrant ssh-config` to find the SSH port of the machine
`vagrant status --machine-readable` will be executed by pyinfra to get information about available VMs

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
