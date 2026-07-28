from pyinfra.operations import  apt, server, files
from pyinfra import host
from io import StringIO

# 🔹 Variables (Modify as Needed)
DOMAIN = host.data.DOMAIN
PORT = host.data.PORT


site_block = f"""# BEGIN DOMAIN {DOMAIN}
{DOMAIN} {{
    import tls_cert
    reverse_proxy localhost:{PORT}
}}
# END {DOMAIN}
"""

files.block(
    path = '/etc/caddy/Caddyfile', 
    content = site_block, 
    present = True, 
    before = False,
    after = False, 
    _sudo = True
)

server.service(
    service='caddy',
    running=True, 
    restarted=True,
    _sudo=True
)