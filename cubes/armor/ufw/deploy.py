from pyinfra.operations import server
from pyinfra import host

ALLOW_HTTP=host.data.ALLOW_HTTP

server.shell(
    commands=[
        f"ufw allow ssh",
        f"ufw allow http" if ALLOW_HTTP else "",
        f"ufw enable",
    ],
    _sudo=True
)