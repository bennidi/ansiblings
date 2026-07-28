from pyinfra import host
from pyinfra.operations import server, apt


DISTRO = host.data.DISTRO

server.shell(
    commands=[
        "install -m 0755 -d /etc/apt/keyrings",
        f"curl -fsSL https://download.docker.com/linux/{DISTRO}/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg",
        "sudo chmod a+r /etc/apt/keyrings/docker.gpg",
        f""" echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/{DISTRO} "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" |   sudo tee /etc/apt/sources.list.d/docker.list > /dev/null """,
        "apt update"
    ],
    _sudo=True
)

apt.packages(
    packages=[
        "docker-ce",
        "docker-ce-cli",
        "containerd.io",
        "docker-buildx-plugin",
        "docker-compose-plugin",
    ],
    present=True,
    _sudo=True
)


server.shell(
    name="Install Lazydocker system-wide",
    commands=[
        'export DIR=/usr/local/bin && curl -fsSL https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash -s --'
    ],
    _sudo=True
)

# Install required packages
apt.packages(
    name="Install required dependencies",
    packages=["ca-certificates", "curl", "gnupg", "lsb-release"],
    update=True,
    _sudo=True
)

# Download and store the GPG key
server.shell(
    name="Download and store Azlux repo GPG key",
    commands=[
        "curl -fsSL https://azlux.fr/repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/azlux-archive-keyring.gpg"
    ],
    _sudo=True
)

# Add the repository to sources.list
server.shell(
    name="Add Azlux repository to APT sources",
    commands=[
        """ echo "deb [arch="$(dpkg --print-architecture)" signed-by=/usr/share/keyrings/azlux-archive-keyring.gpg] http://packages.azlux.fr/debian bookworm main" | sudo tee /etc/apt/sources.list.d/azlux.list > /dev/null """,
    ],
    _sudo=True
)

# Update APT and install docker-ctop
apt.update(
    name="Update package lists",
    _sudo=True
)

apt.packages(
    name="Install docker-ctop",
    packages=["docker-ctop"],
    _sudo=True
)