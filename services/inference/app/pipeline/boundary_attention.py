"""Stub: DeepFloorplan room-boundary-guided attention (Zeng et al., arXiv 1908.11025).

Not trained. Geometry extract currently flood-fills interiors inside each unit clip.

If you train this later, train on **unit crops** (one apartment per image), not full
multi-unit sheets — that matches the paper’s single-dwelling domain.

Paper Fig. 4 (spatial contextual module at each decoder level):

- Shared encoder, two heads (room-boundary: wall/door/window; room-type).
- Boundary features → 2D attention map a_{m,n} (sigmoid).
- Gate room features: f' = a · f
- Four direction-aware 1D kernels (horizontal, vertical, diagonal, anti-diagonal),
  then gate again: f'' = a · (h + v + d + d')
- Post-process: connected components bounded by predicted walls, majority-vote type.
"""

from __future__ import annotations


def room_boundary_attention_ready() -> bool:
    return False
