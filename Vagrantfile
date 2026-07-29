# -*- mode: ruby -*-
# vi: set ft=ruby :

require 'fileutils'

# A destroyed-and-recreated box generates fresh SSH host keys, so the entry in
# ~/.ssh/known_hosts for [127.0.0.1]:2222 goes stale and pyinfra aborts with
# "Host key ... does not match" — it reads the real known_hosts, because its
# @vagrant connector copies only HostName/Port/User/IdentityFile out of
# `vagrant ssh-config` and drops the StrictHostKeyChecking/UserKnownHostsFile
# lines vagrant emits. Nor would relaxing that help: paramiko rejects a
# *mismatched* key before any policy is consulted.
#
# So: keep one keypair on the host, install it into every incarnation of the
# VM, and pin the known_hosts entry to it after boot.
HOSTKEY_DIR  = File.join(__dir__, '.vagrant-hostkeys')
HOSTKEY_PATH = File.join(HOSTKEY_DIR, 'ssh_host_ed25519_key')

unless File.exist?(HOSTKEY_PATH)
  FileUtils.mkdir_p(HOSTKEY_DIR)
  system('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'ansiblingsvm', '-f', HOSTKEY_PATH) \
    or raise "Vagrantfile: ssh-keygen failed to create #{HOSTKEY_PATH}"
end

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

    # Land the private key as the vagrant user first; the shell provisioner
    # below is what moves it into /etc/ssh with root ownership and 0600.
    config.vm.provision "hostkey-upload",
      type: "file",
      run: "always",
      source: HOSTKEY_PATH,
      destination: "/tmp/ssh_host_ed25519_key"
    config.vm.provision "hostkey-upload-pub",
      type: "file",
      run: "always",
      source: "#{HOSTKEY_PATH}.pub",
      destination: "/tmp/ssh_host_ed25519_key.pub"

    # Idempotent: only restarts sshd when the key actually changed, so a
    # `vagrant up` on an untouched VM does not bounce the connection.
    config.vm.provision "hostkey-install",
      type: "shell",
      run: "always",
      inline: <<-SHELL
        set -eu
        if cmp -s /tmp/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key \\
           && [ -f /etc/ssh/sshd_config.d/99-pinned-hostkey.conf ]; then
          rm -f /tmp/ssh_host_ed25519_key /tmp/ssh_host_ed25519_key.pub
          echo "host key already pinned"
          exit 0
        fi

        install -o root -g root -m 600 /tmp/ssh_host_ed25519_key     /etc/ssh/ssh_host_ed25519_key
        install -o root -g root -m 644 /tmp/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
        rm -f /tmp/ssh_host_ed25519_key /tmp/ssh_host_ed25519_key.pub

        # Offer *only* this key. Ubuntu's sshd_config Includes sshd_config.d/*
        # before its own (commented-out) HostKey lines, and naming any HostKey
        # replaces the built-in default set — so a regenerated RSA or ECDSA key
        # can never become the identity a client pins.
        mkdir -p /etc/ssh/sshd_config.d
        echo "HostKey /etc/ssh/ssh_host_ed25519_key" > /etc/ssh/sshd_config.d/99-pinned-hostkey.conf
        chmod 644 /etc/ssh/sshd_config.d/99-pinned-hostkey.conf

        sshd -t
        systemctl restart ssh 2>/dev/null || service ssh restart
        echo "host key pinned"
      SHELL

    # Established sessions survive the sshd restart above, but the *next*
    # connection sees the new key — so refresh known_hosts on the host from the
    # public key we already hold, rather than blind-trusting a keyscan.
    config.trigger.after [:up, :provision, :reload] do |trigger|
      trigger.name = "pin known_hosts entry"
      trigger.ruby do |_env, machine|
        info = machine.ssh_info
        next if info.nil?

        entry = "[#{info[:host]}]:#{info[:port]} #{File.read("#{HOSTKEY_PATH}.pub").split[0, 2].join(' ')}"
        known_hosts = File.expand_path('~/.ssh/known_hosts')

        FileUtils.mkdir_p(File.dirname(known_hosts), mode: 0o700)
        FileUtils.touch(known_hosts) unless File.exist?(known_hosts)
        system('ssh-keygen', '-q', '-R', "[#{info[:host]}]:#{info[:port]}", '-f', known_hosts,
               out: File::NULL, err: File::NULL)
        FileUtils.rm_f("#{known_hosts}.old")
        File.open(known_hosts, 'a') { |f| f.puts(entry) }

        machine.ui.info("known_hosts pinned to #{entry.split[1, 2].first} for #{info[:host]}:#{info[:port]}")
      end
    end
  end
