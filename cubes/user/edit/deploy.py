from pyinfra import host
from pyinfra.operations import server

# [agnt://cogen/cogen/user-edit-2]{cartridge: "ansiblings/cubes", action: "generated", status: "generated"}

"""
Deployment script for user:edit.
Updates password and group membership for an existing user.
"""

USER = host.data.USER
PASSWORD = host.data.get('PASSWORD')
GROUPS = [g.strip() for g in str(host.data.get('GROUPS', '')).split(',') if g.strip()]
GROUPS_ABSENT = [g.strip() for g in str(host.data.get('GROUPS_ABSENT', '')).split(',') if g.strip()]

# Update user details
server.user(
    name=f"Update user {USER}",
    user=USER,
    password=PASSWORD,
    groups=GROUPS,
    groups_absent=GROUPS_ABSENT,
    _sudo=True,
)
