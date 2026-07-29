from pyinfra import host
from pyinfra.operations import server, files, apt
from io import StringIO

# Define the username, password, and public key for the new admin user
USER = host.data.USER
HOME_DIR = f"/home/{USER}"
TMP_DIR = f"{HOME_DIR}/tmp"
PASSWORD = host.data.PASSWORD
# An empty submission at the prompt must not become an empty authorized_keys
# line, so an absent key means no key rather than a blank one.
PUBKEY = host.data.PUBKEY
PUBKEYS = [PUBKEY] if PUBKEY and str(PUBKEY).strip() else []
GROUPS = list(filter(None, map(str.strip, str(host.data.GROUPS).split())))
FISH_PATH = "/usr/bin/fish"
FISH_CONFIG_DIR = f"{HOME_DIR}/.config/fish"
FISH_CONFIG_FILE = f"{FISH_CONFIG_DIR}/config.fish"
FISH_RC_DIR = f"{FISH_CONFIG_DIR}/rc"
SSH_AGENT_SCRIPT = f"{FISH_RC_DIR}/ssh-agent.fish"

apt.packages(
    name='Ensure fish shell is installed',
    packages=[ 'fish'],
    _sudo=True
)


# Ensure the user exists with a login shell
server.user(
    name=f"Create user {USER} [{GROUPS}]",
    present=True,
    user=USER,
    password=PASSWORD,
    create_home=True,
    groups=GROUPS,
    shell=FISH_PATH,
    public_keys=PUBKEYS,
    _sudo=True
)

for dir in [f"{HOME_DIR}/.ssh", FISH_RC_DIR, TMP_DIR]:
    files.directory(
        name=f"Ensure {dir} directory exists",
        path=dir,
        present=True,
        mode=700,
        user=USER,
        group=USER,
        _sudo=True,
        _sudo_user=USER,
        _use_sudo_login=True
    )

files.file(
    name="Ensure .ssh/config exists",
    path=f"{HOME_DIR}/.ssh/config",
    present=True,
    user=USER,
    group=USER,
    _sudo=True
)

server.shell(
    name=f"Install OMF(Oh My Fish) for {USER}",
    commands=[
        f"curl https://raw.githubusercontent.com/oh-my-fish/oh-my-fish/master/bin/install > install-omf",
        f"fish install-omf --yes --noninteractive",
    ],
    _sudo=True,
    _sudo_user=USER,
    _use_sudo_login=True
)

files.put(
    name="Add SSH agent auto-load script to Fish rc directory",
    src="ssh-agent.fish",
    dest=SSH_AGENT_SCRIPT,
    user=USER,
    group=USER,
    mode="755",  # Make it executable
    _sudo=True,

)

files.put(
    name="Add custom config.fish",
    src="config.fish",
    dest=FISH_CONFIG_FILE,
    user=USER,
    group=USER,
    mode="755",  # Make it executable
    _sudo=True,
)