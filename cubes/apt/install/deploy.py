from pyinfra.operations import apt
from pyinfra import host

UPDATE = host.data.UPDATE
PACKAGES = str(host.data.PACKAGES).split(' ')

apt.packages(
    name='Install essential packages',
    packages=[
        'htop', 
        'age',
        'git', 
        'curl', 
        'nano', 
        'wget', 
        'ca-certificates', 
        'ufw', 
        "gnupg", 
        "lsb-release"
    ],
    update=UPDATE,
    _sudo=True
)

apt.packages(
    name='Install custom packages',
    packages=[p.strip() for p in PACKAGES if p],
    update=UPDATE,
    _sudo=True
)

