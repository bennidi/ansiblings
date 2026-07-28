from pyinfra.operations import  apt, server, files
from pyinfra import host
from io import StringIO

# 🔹 Variables
TLS = host.data.TLS

server.shell(
    commands=[
        f"sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl",
        f"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg",
        f"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list"
    ] 
)

apt.packages(
    name='Install caddy',
    packages=['caddy'],
    update=True,
    _sudo=True
)


TLS_BLOCK = f"""
(tls_cert) {{
    tls {TLS}
}}
"""

files.put(
    src = StringIO(TLS_BLOCK), # local filename to upload,
    dest = '/etc/caddy/Caddyfile', # the remote filename to upload to
    _sudo=True
)