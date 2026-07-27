from pyinfra.operations import apt
from pyinfra import host

UPDATE = host.data.UPDATE

apt.packages(
    name='Install essentials',
    packages=[
        'build-essential',
        'pkg-config',
        'age'
    ],
    update=UPDATE,
    _sudo=True
)

