from pyinfra.operations import server, apt, npm, python
from pyinfra import host
from pyinfra.facts.files import Directory
from pyinfra.facts.server import Which

hasNode = host.get_fact(Which, 'node')
VERSION = host.data.VERSION
ALIAS = host.data.ALIAS
GLOBAL_PACKAGES = host.data.GLOBAL_PACKAGES
USER = host.data.USER

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
        _sudo = True,
    )

server.shell(
    commands=[
        "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash",
        "omf install nvm",
        f"nvm install {VERSION}",
        f"nvm alias {ALIAS} {VERSION}",
        "set -gx NVM_DIR $HOME/.nvm",
    ],
    _sudo=True,
    _su_user=USER,
    _use_su_login=True,
    _shell_executable='/usr/bin/fish'
)


server.shell(
    commands=[
        "npm install -g pm2 yarn local-web-server node-gyp inquirer execa @dotenvx/dotenvx"
    ],
    _sudo=True,
    _su_user=USER,
    _use_su_login=True,
    _shell_executable='/usr/bin/fish'
    
)


