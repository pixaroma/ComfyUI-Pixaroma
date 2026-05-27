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
        "input and sends one of them to that row's output; the A/B toggle "
        "picks the side for every row at once. Wire your 'local' nodes into "
        "the A inputs and your 'api' nodes into the B inputs (or any two "
        "setups), then flip between them in a single click instead of toggling "
        "several separate switches.\n\n"
        "Set how many rows you need with the Rows field. Works for any wire "
        "type (MODEL, CLIP, VAE, IMAGE, LATENT, STRING, ...). 'Use connected' "
        "mode lets a row that has only one side wired use that side on both A "
        "and B (handy for a shared input); 'Strict' mode instead errors if the "
        "chosen side is missing. Only the side actually used runs - the other "
        "side's upstream nodes are skipped."
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
                if isinstance(r, int) and r > 0:
                    rows = min(r, MAX_ROWS)
                if state.get("missing") in ("connected", "strict"):
                    missing = state["missing"]
                aw = state.get("aWired")
                if isinstance(aw, list):
                    a_wired = [int(x) for x in aw if isinstance(x, int)]
                bw = state.get("bWired")
                if isinstance(bw, list):
                    b_wired = [int(x) for x in bw if isinstance(x, int)]
        except (TypeError, ValueError):
            if SwitchSourceState in ("A", "B"):
                active = SwitchSourceState

        # Fallback: infer the visible row count from the highest wired index.
        if rows <= 0:
            for i in range(MAX_ROWS, 0, -1):
                if kwargs.get(f"a_{i}") is not None or kwargs.get(f"b_{i}") is not None:
                    rows = i
                    break
            rows = max(rows, 1)

        out = []
        for i in range(1, MAX_ROWS + 1):
            if i > rows:
                out.append(None)
                continue
            a = kwargs.get(f"a_{i}")
            b = kwargs.get(f"b_{i}")
            # The JS hook has already pruned each row to its used side, so at
            # most one of a/b is present per row.
            if active == "A":
                val = a if a is not None else b
                if val is None and missing == "strict" and i in b_wired:
                    raise ValueError(
                        f"Switch Source Pixaroma: row {i} is set to A, but the A "
                        f"input for that row is not connected (B is). Wire a_{i}, "
                        f"switch to B, or use 'Use connected' mode."
                    )
            else:
                val = b if b is not None else a
                if val is None and missing == "strict" and i in a_wired:
                    raise ValueError(
                        f"Switch Source Pixaroma: row {i} is set to B, but the B "
                        f"input for that row is not connected (A is). Wire b_{i}, "
                        f"switch to A, or use 'Use connected' mode."
                    )
            out.append(val)
        return tuple(out)


NODE_CLASS_MAPPINGS = {"PixaromaSwitchSource": PixaromaSwitchSource}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSwitchSource": "Switch Source Pixaroma"}
