from pyinfra import host
from pyinfra.operations import server, apt

apt.packages(
    packages=[ "sscg cockpit"],
    present=True,
    _sudo=True
)

server.service(
    'cockpit', 
    running=True, 
)