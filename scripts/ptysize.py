"""Spawn a child on a pty whose window size is what you asked for.

`pty.fork()` leaves the new terminal at **0 rows by 0 columns**, and nothing
fixes that afterwards: `COLUMNS`/`LINES` in the environment are a shell
convention that `ioctl(TIOCGWINSZ)` has never heard of, so `process.stdout.rows`
in the child stays 0 however they are set.

That is not a detail. A driver that forgets the ioctl is testing a terminal no
user has, and it lied to us once already — the enquirer `Form` under it returned
`{}` for reasons that had nothing to do with the code under test. See the
`terminalSize` comment in `packages/nopy/src/nopy.prompts.ts`.

So the size is always set explicitly here, including when it is set to 0: the
degenerate terminal is worth testing, but only on purpose.
"""

import fcntl
import os
import pty
import struct
import termios


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def spawn(cmd, rows, cols, env=None):
    """Fork `cmd` onto a pty sized `rows` x `cols`. Returns (pid, fd)."""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        # Kept in step with the ioctl so that a program reading either one gets
        # the same answer. The ioctl is what actually matters.
        os.environ["COLUMNS"] = str(cols)
        os.environ["LINES"] = str(rows)
        for key, value in (env or {}).items():
            os.environ[key] = value
        os.execvp(cmd[0], cmd)

    set_winsize(fd, rows, cols)
    return pid, fd


def size_from_env(default_rows=50, default_cols=200):
    """`PTY_ROWS` / `PTY_COLS`, so a caller can ask for the 0x0 case."""
    return (
        int(os.environ.get("PTY_ROWS", default_rows)),
        int(os.environ.get("PTY_COLS", default_cols)),
    )
