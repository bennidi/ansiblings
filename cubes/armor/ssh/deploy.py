from pyinfra.operations import files, server
from pyinfra import host
from pyinfra import config
import logging

DISABLE_PASSWORD=host.data.DISABLE_PASSWORD
DISABLE_PAM=host.data.DISABLE_PAM

logger = logging.getLogger(__name__)
config.SUDO = True

files.line(
    name='Disable challenge-response authentication in SSH',
    path='/etc/ssh/sshd_config',
    line='ChallengeResponseAuthentication yes',
    replace='ChallengeResponseAuthentication no',
)

if DISABLE_PASSWORD:
    files.line(
        name='Disable password authentication in SSH',
        path='/etc/ssh/sshd_config',
        line='PasswordAuthentication yes',
        replace='PasswordAuthentication no',
)
else:
    logger.info('Password authentication allowed')

if DISABLE_PAM:
    files.line(
        name='Disable PAM in SSH',
        path='/etc/ssh/sshd_config',
        line='UsePAM yes',
        replace='UsePAM no',
    )

# Restart SSH service
server.service(
    'ssh', 
    running=True, 
    restarted=True, 
    reloaded=True
)