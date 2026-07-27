from pyinfra.operations import files, server, python
from pyinfra import host, logger
import logging


NAME=host.data.SUFFIX
EMAIL=host.data.EMAIL
ALGORITHM=host.data.ALGORITHM
USER=host.data.USER

# Ensure the .ssh directory exists
files.directory(
    name="Ensure .ssh directory exists",
    path=f"/home/{USER}/.ssh",
    present=True,
    mode=700,
    user=USER,
    group=USER,
)

# Generate the SSH keypair
server.shell(
    name=f"Generate SSH key id_{NAME}",
    commands=[
        f"ssh-keygen -t {ALGORITHM} -f /home/{USER}/.ssh/id_{NAME} -C '{EMAIL}' -N ''"
    ]
)

# Print the public key
result = server.shell(
    name="Print public key",
    commands=[f"cat /home/{USER}/.ssh/id_{NAME}.pub"],
)

def callback():
    # 🔹 Extract and log the key output
    if result.stdout:
        logger.info(f"Public Key for {USER}: {result.stdout.strip()}")
    else:
        logger.warning(f"No public key found for {USER} at /home/{USER}/.ssh/id_{NAME}.pub")

python.call(
    name="Log public key",
    function=callback,
)

