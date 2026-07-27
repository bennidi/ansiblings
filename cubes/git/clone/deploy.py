from pyinfra.operations import server
from pyinfra import host

USER = host.data.USER
REPO = host.data.REPO
APP = host.data.APP

server.shell(
    name="Clone application",
    commands=[
      f"""
      cd $HOME &&
      git clone --recurse-submodules {REPO} {APP}
      """],
    _sudo=True,
    _sudo_user=USER,
    _use_sudo_login=True
)