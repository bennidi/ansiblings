# Testing Nopy with Docker

This guide explains how to set up a local Docker container to test `nopy` deployments using the provided `Ubuntu-24LTS.Dockerfile` and `example.nopysession.json`.

## Prerequisites

- Docker installed and running on your machine.
- `nopy` installed and linked (see [README.md](../README.md)).

## 1. Setup SSH Key (Important)

The provided `Ubuntu-24LTS.Dockerfile` contains a hardcoded public SSH key. Before building, you **must** replace it with your own public key to allow SSH access (if needed) or ensure `pyinfra` can connect if it uses SSH transport.

1. Open `Ubuntu-24LTS.Dockerfile`.
2. Locate the line starting with `echo "ssh-ed25519 ...`.
3. Replace the key string with the content of your own public key (usually `~/.ssh/id_ed25519.pub` or `~/.ssh/id_rsa.pub`).

```dockerfile
# Example replacement
RUN mkdir -p /home/testuser/.ssh && \
    echo "YOUR_PUBLIC_KEY_HERE" >> /home/testuser/.ssh/authorized_keys && \
    ...
```

## 2. Build the Docker Image

Run the following command from the `packages/nopy` directory:

```bash
docker build -f Ubuntu-24LTS.Dockerfile -t nopy-test-ubuntu .
```

## 3. Run the Container

Start the container in the background. We explicitly name it `nopy-test-container` because the `example.nopysession.json` is configured to target this specific container name.

```bash
docker run -d \
  --name nopy-test-container \
  --privileged \
  -p 2222:22 \
  nopy-test-ubuntu
```

- `--name nopy-test-container`: Matches the host defined in `example.nopysession.json`.
- `--privileged`: Required for some system-level operations (like `criu` or service management) if tested.
- `-p 2222:22`: Maps the container's SSH port to local port 2222 (optional, allows manual SSH connection).

## 4. Deploy using Nopy

Now you can run the example session. Nopy uses `pyinfra`'s `@docker` connector to communicate directly with the container, so SSH keys are not strictly required for the *deployment* itself, but the session is configured to simulate a realistic environment.

```bash
nopy install -l example.nopysession.json
```

If successful, `nopy` will execute the `apt:essentials` cube against the container.

## 5. Manual Verification

You can connect to the container manually to verify changes:

**Via Docker Exec:**

```bash
docker exec -it nopy-test-container bash
```

**Via SSH (if configured):**

```bash
ssh -p 2222 testuser@localhost
# Password: password
```

## 6. Cleanup

To stop and remove the container:

```bash
docker rm -f nopy-test-container
```

## Building an image instead of targeting a container

The `@docker` connector reads its identifier two ways, and the difference is
the whole feature:

| Host                  | What pyinfra does                                                                     |
| --------------------- | ------------------------------------------------------------------------------------- |
| `@docker/<container>` | runs against that container and leaves it running — the flow above                     |
| `@docker/<image>`     | starts a throwaway container, deploys into it, `docker commit`s it, prints the new image ID, removes the container |

It looks for a matching container first, so nothing distinguishes the two at the
prompt: pick `docker` at host selection and enter either an existing container
or an image reference such as `ubuntu:24.04`.

```
$ nopy install
? Select host from inventory  docker
? Specify docker container name/id, or an image to build from:  ubuntu:24.04
...
--> docker build complete, image ID: 39b782da6859
$ docker tag 39b782da6859 myapp:1.0
```

Two things the connector cannot do, both worth knowing before treating this as a
Dockerfile replacement. The commit is untagged, so the image exists only as an
ID until you tag it; and it carries the base image's metadata unchanged —
`CMD`, `ENTRYPOINT`, `ENV`, `EXPOSE` have no equivalent in a cube. When either
matters, own the container yourself and commit deliberately:

```bash
cid=$(docker run -d ubuntu:24.04 sleep infinity)
nopy install            # host: docker → paste $cid at the prompt
docker commit --change 'CMD ["/usr/sbin/sshd","-D"]' "$cid" myapp:1.0
docker rm -f "$cid"
```

There is no `--host` flag; for an unattended build put the identifier in a
session file's `hosts` array (as `example.nopysession.json` does) and replay it
with `nopy install -l <file>`.

Note also that an image target starts from a fresh container every run, so every
cube reports changes every time — idempotence only shows up when you re-run
against a container id. And there is no init system in a plain container, so
service-level cubes still need the `--privileged` systemd setup above.
