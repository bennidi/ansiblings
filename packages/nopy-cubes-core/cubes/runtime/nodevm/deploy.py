from pyinfra.operations import server, apt
from pyinfra import host
from pyinfra.facts.server import Which
from pyinfra.api.exceptions import DeployError

VERSION = host.data.VERSION
ALIAS = host.data.ALIAS
GLOBAL_PACKAGES = host.data.GLOBAL_PACKAGES
USER = host.data.USER
SHELL = host.data.SHELL

INSTALL_NVM = "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash"

# Under bash, every entry in `commands` is its own shell, so loading nvm and
# using it have to be one entry. Loading cannot be skipped either: nvm's
# installer appends its hook to ~/.bashrc, and Ubuntu's ~/.bashrc returns at
# line 1 for a non-interactive shell, so under `su -c` the hook never runs.
LOAD_NVM = 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"'

# The binary only. Oh My Fish is a set of fish functions with no binary and no
# fixed path, so probing for it would be guesswork — and if fish is there while
# omf is not, `omf install nvm` says so itself. Half a guard that is certain
# beats a whole one that is not.
if SHELL == 'fish' and not host.get_fact(Which, 'fish'):
    raise DeployError(
        f'runtime:nodevm: SHELL is "fish" but fish is not installed for {USER}. '
        'Run user:add first, or set SHELL=bash.'
    )

if SHELL == 'fish':
    shell_executable = '/usr/bin/fish'
    # The omf plugin defines `nvm` as a fish function that every login shell
    # loads, and activates the `default` alias on load — so `nvm` and `npm` are
    # both reachable in any later shell without setup, and NVM_DIR is set for us.
    nvm_commands = [
        INSTALL_NVM,
        'omf install nvm',
        f'nvm install {VERSION}',
        f'nvm alias {ALIAS} {VERSION}',
    ]
    npm_commands = [f'npm install -g {GLOBAL_PACKAGES}']
else:
    shell_executable = '/bin/bash'
    nvm_commands = [
        INSTALL_NVM,
        f'{LOAD_NVM}; nvm install {VERSION}; nvm alias {ALIAS} {VERSION}',
    ]
    npm_commands = [f'{LOAD_NVM}; nvm use {ALIAS}; npm install -g {GLOBAL_PACKAGES}']

apt.packages(
        name=f'Install nodejs tools',
        no_recommends=True,
        packages=[
          'build-essential',
          'libssl-dev',
          'libtool',
          'cmake',
          'libcairo2-dev',
          'libpango1.0-de',
          'libpng-dev',
          'libgif-dev',
          'libjpeg-dev',
          'libvips-dev',
          'librsvg2-dev',
          'libpixman-1-dev',
          ],
        # Every other cube that installs packages refreshes the index first, and
        # this one only got away without it while `user:add` ran ahead of it and
        # dragged in `apt:essentials`. On a box nobody has updated, the index
        # names .deb versions the mirror has already superseded and the fetch
        # 404s — the same "assumes a predecessor cube ran" defect as the shell.
        update=True,
        _sudo = True,
    )

server.shell(
    name=f'Install nvm and node {VERSION} for {USER}',
    commands=nvm_commands,
    _sudo=True,
    _su_user=USER,
    _use_su_login=True,
    _shell_executable=shell_executable,
)


server.shell(
    name=f'Install global packages for {USER}',
    commands=npm_commands,
    _sudo=True,
    _su_user=USER,
    _use_su_login=True,
    _shell_executable=shell_executable,
)
