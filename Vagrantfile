# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
    config.vm.provider "vmware_desktop" do |vmware|
        vmware.gui = false
        vmware.allowlist_verified = true
      end
    config.vm.box = "bento/ubuntu-24.04"  # Use Ubuntu 24.04 box
    config.ssh.insert_key = false
    config.vm.box_check_update = false
    config.vm.hostname = "ansiblingsvm" 
    config.vm.network "forwarded_port", guest: 3567, host: 3567, auto_correct: true 
    config.vm.network "forwarded_port", guest: 80, host: 80, auto_correct: false
    config.vm.network "forwarded_port", guest: 443, host: 443, auto_correct: false
    # Configure SSH with public key authentication
    #config.vm.provision "shell", inline: <<-SHELL
    #  mkdir -p ~/.ssh
    #  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICpnZ6IxwQKL1rBE4dy7w5Sd3s2tLFZUDfjH87C1QIlc bdiedrichsen@Benjamins-MBP.lan" >> ~/.ssh/authorized_keys
    #  chmod 600 ~/.ssh/authorized_keys
    #SHELL
  end