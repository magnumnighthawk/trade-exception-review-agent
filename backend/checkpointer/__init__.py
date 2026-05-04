"""
Checkpointer package.

LEARNING: Phase 3 introduces explicit checkpointing as a first-class concern.
The graph should not construct storage primitives inline — it should ask this
package for a checkpointer implementation so we can swap MemorySaver for a
persistent backend later without rewriting graph wiring.
"""

from backend.checkpointer.factory import build_checkpointer, checkpointer_backend

__all__ = ["build_checkpointer", "checkpointer_backend"]
