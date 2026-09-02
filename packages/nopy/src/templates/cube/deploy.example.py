# __CUBE_ID__ — __CUBE_NAME__
#
# Runs with the cube directory as its working directory. Every key in the
# manifest's schema arrives on host.data, already parsed by pyinfra — a
# boolean is a bool and a numeric string an int, not a string.
from pyinfra import host
from pyinfra.operations import server

GREETING = host.data.GREETING

server.shell(
    name="Print the greeting",
    commands=[f"echo '{GREETING}'"],
)
