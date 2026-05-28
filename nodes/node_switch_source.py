"""Switch Source Pixaroma - flip a whole set of wires between two banks (A/B).

Each row has an A input and a B input and produces one output. A single A/B
toggle (in the JS frontend) selects which bank feeds every output at once.
Built for swapping a whole pipeline (e.g. local <-> api) in one click.

INPUT_TYPES pre-declares MAX_ROWS A inputs (a_1..a_16) followed by MAX_ROWS B
inputs (b_1..b_16) - the "two stacked banks" order - plus MAX_ROWS ANY outputs.
The JS frontend shows only the rows the user asked for (the Rows field). The
active bank, visible row count, missing-side mode, and per-side wiring are
carried via the hidden SwitchSourceState input (Pattern #9 - injected by the JS
app.graphToPrompt hook, which also prunes each row to the side that is actually
used so only that branch executes).
"""
import json

from ._type_helpers import ANY

MAX_ROWS = 16
_DEFAULT_STATE = '{"version":1,"active":"A","rows":1,"missing":"connected"}'


class PixaromaSwitchSource:
    DESCRIPTION = (
        "Switch Source Pixaroma - flip a whole set of wires between two "
        "sources (A and B) with one toggle. Each row has an A input and a B "
        "input and sends ONE of them to that row's output; the A/B toggle "
        "picks the side for every row at once. Wire your 'local' nodes into "
        "the A inputs and your 'api' nodes into the B inputs (or any two "
        "setups), then flip between them in a single click instead of toggling "
        "several separate switches.\n\n"
        "Set how many rows you need with the Rows field. Works for any wire "
        "type (MODEL, CLIP, VAE, IMAGE, LATENT, STRING, ...). The active side "
        "is the only one that runs - the other side's upstream nodes are "
        "skipped. The toggle below the A/B switch decides what happens when "
        "the active side has no wire on a row: 'Allow empty' silently leaves "
        "that output empty (handy when banks have asymmetric wiring, e.g. "
        "3 wired on B and only 1 on A); 'Show error' raises a clear error "
        "when the OTHER side was wired (catches the case where you dropped a "
        "wire on the wrong bank by mistake)."
    )

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for i in range(1, MAX_ROWS + 1):
            optional[f"a_{i}"] = (
                ANY,
                {"forceInput": True,
                 "tooltip": f"Source A for row {i}. Flows to output_{i} when the toggle is on A."},
            )
        for i in range(1, MAX_ROWS + 1):
            optional[f"b_{i}"] = (
                ANY,
                {"forceInput": True,
                 "tooltip": f"Source B for row {i}. Flows to output_{i} when the toggle is on B."},
            )
        return {
            "required": {},
            "optional": optional,
            "hidden": {
                "SwitchSourceState": ("STRING", {"default": _DEFAULT_STATE}),
            },
        }

    RETURN_TYPES = tuple(ANY for _ in range(MAX_ROWS))
    RETURN_NAMES = tuple(f"output_{i}" for i in range(1, MAX_ROWS + 1))
    OUTPUT_TOOLTIPS = tuple(
        f"Row {i}: carries the A or B input for this row, depending on the toggle."
        for i in range(1, MAX_ROWS + 1)
    )
    FUNCTION = "pick"
    CATEGORY = "👑 Pixaroma"

    def pick(self, SwitchSourceState=_DEFAULT_STATE, **kwargs):
        active = "A"
        rows = 0
        missing = "connected"
        a_wired = []
        b_wired = []
        try:
            state = json.loads(SwitchSourceState)
            if isinstance(state, dict):
                if state.get("active") in ("A", "B"):
                    active = state["active"]
                r = state.get("rows")
                # Accept a JSON float (1.0) too; reject bool (subclass of int).
                if isinstance(r, (int, float)) and not isinstance(r, bool) and r > 0:
                    rows = min(int(r), MAX_ROWS)
                if state.get("missing") in ("connected", "strict"):
                    missing = state["missing"]
                aw = state.get("aWired")
                if isinstance(aw, list):
                    a_wired = [int(x) for x in aw if isinstance(x, int) and not isinstance(x, bool)]
                bw = state.get("bWired")
                if isinstance(bw, list):
                    b_wired = [int(x) for x in bw if isinstance(x, int) and not isinstance(x, bool)]
        except (TypeError, ValueError):
            if SwitchSourceState in ("A", "B"):
                active = SwitchSourceState

        # Row count: trust the injected state, but NEVER fall below the highest
        # wired index. The JS hook normally injects the exact rows; if it did not
        # run (an API / scripted submission, or the default state whose rows is
        # 1) a stale rows would silently drop wired rows. Extending to cover the
        # highest wired index defends both ways and is always safe (you can only
        # wire a slot the node actually exposes, so highest <= real row count).
        highest = 0
        for i in range(MAX_ROWS, 0, -1):
            if kwargs.get(f"a_{i}") is not None or kwargs.get(f"b_{i}") is not None:
                highest = i
                break
        rows = max(rows, highest, 1)

        out = []
        for i in range(1, MAX_ROWS + 1):
            if i > rows:
                out.append(None)
                continue
            # ACTIVE SIDE ONLY. The JS hook prunes the inactive side regardless
            # of mode, so its upstream branch never runs. We never fall back.
            val = kwargs.get(f"a_{i}") if active == "A" else kwargs.get(f"b_{i}")
            if val is None and missing == "strict":
                # Active is empty AND the user wired the OTHER side - almost
                # certainly a wiring mistake. 'Use connected' mode just leaves
                # the row empty silently instead.
                other_wired = (i in b_wired) if active == "A" else (i in a_wired)
                if other_wired:
                    this_side = active
                    other_side = "B" if active == "A" else "A"
                    raise ValueError(
                        f"Switch Source Pixaroma: row {i} is set to {this_side}, but "
                        f"{this_side.lower()}_{i} is not connected ({other_side} is). "
                        f"Wire {this_side.lower()}_{i}, switch to {other_side}, or pick "
                        f"'Allow empty' mode to leave this row empty."
                    )
            out.append(val)
        return tuple(out)


NODE_CLASS_MAPPINGS = {"PixaromaSwitchSource": PixaromaSwitchSource}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSwitchSource": "Switch Source Pixaroma"}
