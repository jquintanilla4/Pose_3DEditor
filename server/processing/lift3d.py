"""3D lifting helpers (VideoPose3D placeholder)."""


class _IdentityLifter:
    """Fallback lifter that pads 2D poses with z=0 until a real model is dropped in."""

    def __init__(self, scale_to_rig=True):
        self.scale_to_rig = scale_to_rig

    def __call__(self, sequence, joint_ids):
        joint_list = list(joint_ids)
        out = []
        for frame in sequence:
            lifted = {}
            for jid in joint_list:
                x, y, c = frame.get(jid, (0.0, 0.0, 0.0))
                lifted[jid] = (x, y, 0.0, c)
            out.append(lifted)
        return out


def get_lifter(model, device, fps):
    # Placeholder: returns identity lifter for now
    return _IdentityLifter()
