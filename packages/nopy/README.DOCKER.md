# Testing Nopy with Docker

This guide explains how to set up a local Docker container to test `nopy` deployments using the provided `Ubuntu-24LTS.Dockerfile` and `example.nopysession.json`.

## Prerequisites

- Docker installed and running on your machine.
- `nopy` installed and linked (see [README.md](./README.md)).

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
