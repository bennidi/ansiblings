from pyinfra import host
from pyinfra.operations import server, files

LAYOUT = host.data.LAYOUT
MODEL = host.data.MODEL
VARIANT = host.data.VARIANT
OPTIONS = host.data.OPTIONS

# Update /etc/default/keyboard
files.line(
    name="Update XKBMODEL in /etc/default/keyboard",
    path="/etc/default/keyboard",
    line=r'^XKBMODEL=.*',
    replace=f'XKBMODEL="{MODEL}"',
    _sudo=True,
)

files.line(
    name="Update XKBLAYOUT in /etc/default/keyboard",
    path="/etc/default/keyboard",
    line=r'^XKBLAYOUT=.*',
    replace=f'XKBLAYOUT="{LAYOUT}"',
    _sudo=True,
)

files.line(
    name="Update XKBVARIANT in /etc/default/keyboard",
    path="/etc/default/keyboard",
    line=r'^XKBVARIANT=.*',
    replace=f'XKBVARIANT="{VARIANT}"',
    _sudo=True,
)

files.line(
    name="Update XKBOPTIONS in /etc/default/keyboard",
    path="/etc/default/keyboard",
    line=r'^XKBOPTIONS=.*',
    replace=f'XKBOPTIONS="{OPTIONS}"',
    _sudo=True,
)

# Apply keyboard configuration
server.shell(
    name="Apply keyboard setup",
    commands=["setupcon", "service keyboard-setup restart"],
    _sudo=True,
)

# Set X11 keyboard layout using localectl if available
server.shell(
    name="Set X11 keyboard layout using localectl",
    commands=[f"localectl set-x11-keymap {LAYOUT} {MODEL} '{VARIANT}' '{OPTIONS}'"],
    _sudo=True,
    _ignore_errors=True,
)
