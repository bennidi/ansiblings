# autostart

**Enable and start an existing systemd service**

## Purpose

Takes a systemd unit that is already installed on the host and decides whether
it runs: `systemctl enable` plus `systemctl start`, or neither.

It does **not** create the unit. Something else — a package, another cube, a
`files.template` — has to have put `<APP>.service` on the host first. This cube
is the switch, not the wiring.

## What This Cube Does

With `AUTOSTART=True` (the default), two `systemd.service` operations against
`<APP>`: one setting `enabled=True` so the unit comes up on boot, one setting
`running=True` so it comes up now. Both are idempotent — a unit already enabled
and running is left alone.

With `AUTOSTART=False`, nothing is changed. The cube prints the two commands you
would run by hand and exits, which is the point of the flag: install now, decide
later.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `APP` | *(required)* | the systemd unit name, without the `.service` suffix — `flintstone` for `/etc/systemd/system/flintstone.service`. This is what `systemctl` is actually pointed at. |
| `SERVICE_NAME` | `Application` | a display name, used only in the operation labels pyinfra prints and in the `AUTOSTART=False` message. Changing it changes what you read, not what happens. |
| `AUTOSTART` | `true` | whether to enable and start the unit at all. |

`APP` has no default, so `nopy -D` (`--use-defaults`) fails by name rather than
guessing. Supply it under `env` in `.nopyrc.json`, from a dependency, or at the
prompt.

## Dependencies

None declared, and none implied beyond the unit file itself. `systemd.service`
is a pyinfra built-in; there is nothing to install.

## Post-Installation

```bash
systemctl status <APP>        # is it running?
systemctl is-enabled <APP>    # will it come back after a reboot?
journalctl -u <APP> -f        # follow its log
```

If the run fails with *Unit `<APP>.service` could not be found*, the unit was
never installed — see Purpose. `systemctl daemon-reload` is worth trying if the
file was written after systemd last read the directory.

## Notes

- Enabling and starting are separate systemd concepts and this cube always does
  both or neither. If you need one without the other, call `systemd.service`
  from your own deploy script.
- `SERVICE_NAME` is deliberately not passed to systemd. The unit is identified
  by `APP` alone, so a wrong `SERVICE_NAME` is a cosmetic mistake rather than a
  cube that manages the wrong service.
