"""Pathfinder 2E pieces for a pack's builders (tools/advimport/buildlib.py: system(pack)).

GM Core's weak and elite adjustments as rule keys on a creature in adventure.json: +2 (elite) or -2 (weak) to every
check and DC and to Strike damage, and the HP change for its level (the book usually states the new HP).
"""


def adjustment(value, hp):
    """Rule keys for an elite (value 2) or weak (value -2) creature; hp is the HP change."""
    label = "Elite" if value > 0 else "Weak"
    return [{"key": "modifier", "selector": "all", "value": value, "label": label},
            {"key": "modifier", "selector": "strike-damage", "value": value, "label": label},
            {"key": "modifier", "selector": "hp", "value": hp, "label": label}]


def elite(hp):
    return adjustment(2, hp)


def weak(hp):
    return adjustment(-2, hp)
