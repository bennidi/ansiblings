from pyinfra.operations import apt, files, server

# Install Fail2ban
apt.packages(
    name='Install Fail2ban',
    packages=['fail2ban'],
    update=True,
    _sudo=True
)

# Configure Fail2ban
files.put(
    name='Configure Fail2ban',
    src='jail.local',
    dest='/etc/fail2ban/jail.local',
    mode='0644',
    _sudo=True
)