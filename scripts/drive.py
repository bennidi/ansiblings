#!/usr/bin/env python3
"""Drive an interactive CLI through a pty on a fixed schedule.

    scripts/drive.py <script.json> -- <cmd> [args...]

`script.json` is a list of `[seconds_since_start, "text to send"]` pairs.
Everything the child prints is echoed to this process's stdout.

Timing-based, so it is the blunt one — good for a quick manual poke at the TUI,
bad for anything that has to be reliable. Prefer `expect.py`, which waits for the
prompt instead of guessing when it will appear.

Environment: `PTY_ROWS` / `PTY_COLS` (default 50x200), `DRIVE_TIMEOUT` seconds.
"""

import json
import os
import select
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ptysize import size_from_env, spawn  # noqa: E402

sep = sys.argv.index("--")
steps = json.loads(open(sys.argv[1]).read())
cmd = sys.argv[sep + 1 :]

rows, cols = size_from_env()
pid, fd = spawn(cmd, rows, cols)

start = time.time()
pending = list(steps)
deadline = start + float(os.environ.get("DRIVE_TIMEOUT", "3600"))

while True:
    if pending and time.time() - start >= pending[0][0]:
        _, text = pending.pop(0)
        os.write(fd, text.encode())
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    if time.time() > deadline:
        os.kill(pid, signal.SIGKILL)
        break

_, status = os.waitpid(pid, 0)
sys.stderr.write("\n[drive.py] exit status: %d\n" % (status >> 8))
sys.exit(status >> 8)
