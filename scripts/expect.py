#!/usr/bin/env python3
"""Expect-style pty driver — waits for each prompt before answering it.

    scripts/expect.py <script.json> -- <cmd> [args...]

`script.json` is a list of steps:

    {"expect": "<regex>", "send": "<text>", "settle": 0.4}
    {"send": "<text>"}                       -- send immediately

Each regex is matched against the ANSI-stripped output accumulated *since the
previous step completed*, not against everything seen so far, so the same prompt
text can be awaited twice in one run — which the nopy variable form does, once
per cube.

Environment: `PTY_ROWS` / `PTY_COLS` (default 50x200), `EXPECT_TIMEOUT` seconds,
`EXPECT_LOG` for the transcript path (default `expect.log`).
"""

import json
import os
import re
import select
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ptysize import size_from_env, spawn  # noqa: E402

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\r")

sep = sys.argv.index("--")
steps = json.loads(open(sys.argv[1]).read())
cmd = sys.argv[sep + 1 :]
TIMEOUT = float(os.environ.get("EXPECT_TIMEOUT", "900"))

rows, cols = size_from_env()
pid, fd = spawn(cmd, rows, cols)

log = open(os.environ.get("EXPECT_LOG", "expect.log"), "wb")
start = time.time()
window = b""  # output since the last completed step
alive = True


def pump(seconds):
    """Read child output for `seconds`, appending to `window`."""
    global window, alive
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], min(0.2, max(0.01, end - time.time())))
        if not r:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            alive = False
            return
        if not data:
            alive = False
            return
        window += data
        log.write(data)
        log.flush()


failed = False

for i, step in enumerate(steps):
    pattern = step.get("expect")
    if pattern:
        rx = re.compile(pattern.encode())
        found = False
        while time.time() - start < TIMEOUT:
            if rx.search(ANSI.sub(b"", window)):
                found = True
                break
            if not alive:
                break
            pump(0.3)
        if not found:
            sys.stderr.write(
                "\n[expect] step %d timed out waiting for %r\n" % (i, pattern)
            )
            failed = True
            os.kill(pid, signal.SIGKILL)
            break
        sys.stderr.write("[expect] step %d matched %r\n" % (i, pattern))
    pump(step.get("settle", 0.5))
    window = b""
    text = step.get("send")
    if text:
        os.write(fd, text.encode())

# drain until the child exits
while alive and time.time() - start < TIMEOUT:
    pump(1.0)
if alive:
    sys.stderr.write("\n[expect] overall timeout, killing child\n")
    failed = True
    os.kill(pid, signal.SIGKILL)

_, status = os.waitpid(pid, 0)
log.close()
code = status >> 8
sys.stderr.write("\n[expect] exit status: %d\n" % code)
# A driver that gave up must not report the child's exit code as its own — a
# SIGKILLed child can still look like a clean 0 to a caller reading $?.
sys.exit(1 if failed else code)
