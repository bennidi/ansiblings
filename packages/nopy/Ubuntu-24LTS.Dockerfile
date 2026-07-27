FROM ubuntu:24.04

# Install software-properties-common
RUN apt-get update && \
    apt-get install -y software-properties-common && \
    rm -rf /var/lib/apt/lists/*

# Add the CRIU repository
RUN add-apt-repository ppa:criu/ppa -y

# Update apt cache and install SSH server, basic utilities, and CRIU fro snapshot management
RUN apt-get update && \
    apt-get install -y openssh-server sudo curl htop criu && \
    rm -rf /var/lib/apt/lists/*

# Create a user (replace 'testuser' with your preferred username)
RUN useradd -m -d /home/testuser -s /bin/bash testuser
RUN echo 'testuser:password' | chpasswd 
RUN adduser testuser sudo

# Add your public key (replace with your actual public key)
RUN mkdir -p /home/testuser/.ssh && \
    echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICpnZ6IxwQKL1rBE4dy7w5Sd3s2tLFZUDfjH87C1QIlc bdiedrichsen@Benjamins-MBP.lan" >> /home/testuser/.ssh/authorized_keys && \
    chmod 600 /home/testuser/.ssh/authorized_keys && \
    chown testuser:testuser /home/testuser/.ssh/authorized_keys

# Create necessary directories
RUN mkdir -p /run/sshd
# Expose SSH port
EXPOSE 22

# Set the default command to keep the container running
CMD ["/usr/sbin/sshd", "-D"]