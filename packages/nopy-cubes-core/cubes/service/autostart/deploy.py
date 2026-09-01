from pyinfra.operations import server, systemd
from pyinfra import host


APP = host.data.APP
SERVICE_NAME = host.data.SERVICE_NAME
AUTOSTART = host.data.AUTOSTART

# Enable and start the service based on AUTOSTART flag
if AUTOSTART:
    systemd.service(
        name=f'Enable {SERVICE_NAME} service',
        service=APP,
        enabled=True,
        _sudo=True
    )

    systemd.service(
        name=f'Start {SERVICE_NAME} service',
        service=APP,
        running=True,
        _sudo=True
    )
else:
    server.shell(
        name=f'Service {SERVICE_NAME} created but not enabled (AUTOSTART=False)',
        commands=[f'echo "Service {SERVICE_NAME} is ready but not started. Enable with: sudo systemctl enable {APP} && sudo systemctl start {APP}"'],
        _sudo=False
    )
