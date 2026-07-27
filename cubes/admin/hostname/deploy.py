from pyinfra import host
from pyinfra.operations import server, files

"""
Deployment script for the admin:hostname cube.
Uses pyinfra's server.hostname operation to set and persist the system hostname.
"""

HOSTNAME = host.data.HOSTNAME

if HOSTNAME:
    server.hostname(
        name=f"Set system hostname to {HOSTNAME}",
        hostname=HOSTNAME,
        _sudo=True,
    )

    # 2. Update /etc/hosts to prevent "unable to resolve host" errors
    # This looks for the line starting with 127.0.1.1 and replaces it entirely
    files.line(
        name="Update /etc/hosts for local resolution",
        path="/etc/hosts",
        line=r"^127\.0\.1\.1\s+.*",
        replace=f"127.0.1.1    {HOSTNAME}",
        _sudo=True,
    )
    # 3. Restart Avahi (Network Broadcast)
    # This pushes the name change out to the shared network
    server.service(
        name="Restart Avahi to broadcast new mDNS name",
        service="avahi-daemon",
        restarted=True,
        _sudo=True,
    )
