from pyinfra import host
from pyinfra.operations import server

USER = host.data.USER
PUBKEY = host.data.PUBKEY

server.user(
    name=f"Authorize public key for {USER}",
    user=USER,
    public_keys=[PUBKEY],
    present=True,
    _sudo=True
)
