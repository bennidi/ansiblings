# Start SSH agent if not already running
if not set -q SSH_AUTH_SOCK
    eval (ssh-agent -c)
end

# Add all private SSH keys in ~/.ssh to the agent
for key in ~/.ssh/id_*; 
    if test -f $key; and not string match -q "*pub" $key
        ssh-add $key 2>/dev/null
    end
end
# Export user and group ID for Docker
set -x UID (id -u)
set -x GID (id -g)