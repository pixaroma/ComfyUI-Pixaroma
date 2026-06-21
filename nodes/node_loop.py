"""Loop Pixaroma - Loop Start / Loop End: repeat a section of a workflow.

Put your nodes BETWEEN Loop Start and Loop End. The section runs `total`
times. Whatever you feed from Loop End's value slots back toward Loop Start
becomes the input for the next round (the "carried" values), so you can build
something up step by step - a long video in chunks, a growing batch of images,
a running count, and so on. After the last round, Loop End outputs the final
carried values.

How it works under the hood: this uses ComfyUI's graph-expansion feature. Each
round, Loop End clones the section between the two brackets and re-runs it with
the next index and the updated carried values (tail recursion via GraphBuilder).
A hidden engine node (Loop Engine) drives that recursion - users never place it
by hand; Loop End spawns it automatically.

Slots (ordered so the value wires line up straight and loop/index stay out of
the way):
- Loop Start: `total` (rounds), optional `value1..5` (the starting carried
  values); outputs `value1..5` (this round's carried values) first, then `loop`
  and `index` (0-based round counter) at the bottom.
- Loop End: optional `value1..5` (feed the updated carried values back here)
  first, then `loop` at the bottom (wire it from Loop Start's loop); outputs
  `value1..5` (the final values after the last round).

The `loop` wire simply tells the two brackets they belong together.
"""

# ComfyUI's graph-expansion / recursion primitives. Guarded so the plugin still
# imports on an older ComfyUI that lacks them (the loop just errors clearly when
# actually run).
try:
    from comfy_execution.graph_utils import GraphBuilder, is_link
    from comfy_execution.graph import ExecutionBlocker  # noqa: F401 (kept for parity / future while-loop)

    _LOOP_OK = True
except Exception:
    GraphBuilder = None
    is_link = None
    ExecutionBlocker = None
    _LOOP_OK = False

from ._type_helpers import ANY


# How many carried value slots Loop Start / Loop End expose (value1..valueNUM).
NUM = 5

# class_type strings (must match NODE_CLASS_MAPPINGS keys below; the engine looks
# itself up by these names during recursion).
_LOOP_START = "PixaromaLoopStart"
_LOOP_END = "PixaromaLoopEnd"
_LOOP_ENGINE = "PixaromaLoopEngine"

# hidden input on Loop Start that carries the current round number through the
# recursion (set by the engine each round; absent on the very first round -> 0).
_INDEX_KEY = "start_index"

_NEED_UPDATE = (
    "Loop Start / Loop End need ComfyUI's graph-expansion feature "
    "(comfy_execution.graph). Please update ComfyUI to a current version."
)


class PixaromaLoopStart:
    DESCRIPTION = (
        "Opening bracket of a loop. Put your nodes between Loop Start and Loop "
        "End and the whole section repeats. Set 'total' to the number of "
        "rounds. 'index' counts the rounds starting at 0. The value slots are "
        "things you want to carry from one round into the next (for example "
        "the frames built so far, or a running counter) - wire the matching "
        "Loop End value slots back so each round picks up where the last "
        "left off. Leave the value slots empty if your loop does not need to "
        "carry anything."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "total": ("INT", {"default": 2, "min": 1, "max": 100000, "step": 1, "tooltip": "How many times the section between Loop Start and Loop End runs."}),
            },
            "optional": {
                ("value%d" % i): (ANY, {"tooltip": "Starting value carried into round 0. After that, the matching slot from Loop End takes over each round. Optional."})
                for i in range(1, NUM + 1)
            },
            "hidden": {
                _INDEX_KEY: (ANY,),
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    # Outputs: the carried values first, then loop, then index at the bottom -
    # so the value wires run straight across and loop/index tuck out of the way.
    RETURN_TYPES = tuple([ANY] * NUM + ["FLOW_CONTROL", "INT"])
    RETURN_NAMES = tuple(["value%d" % i for i in range(1, NUM + 1)] + ["loop", "index"])
    OUTPUT_TOOLTIPS = tuple(
        ["Carried value %d for this round." % i for i in range(1, NUM + 1)]
        + ["Wire this into Loop End's loop input to pair the two brackets.",
           "Which round we are on, starting at 0 (0, 1, 2 ...)."]
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def run(self, total, prompt=None, unique_id=None, **kwargs):
        if not _LOOP_OK:
            raise RuntimeError(_NEED_UPDATE)
        i = kwargs.get(_INDEX_KEY, 0) or 0
        outputs = [kwargs.get("value%d" % n, None) for n in range(1, NUM + 1)]
        # loop is consumed by Loop End via a raw link (it only needs the
        # topology, not this value), so a simple stub is fine. Match the
        # output order: carried values, then loop (stub), then index.
        return tuple(outputs + ["stub", i])


class PixaromaLoopEnd:
    DESCRIPTION = (
        "Closing bracket of a loop. Wire 'loop' from Loop Start. Feed the "
        "values you want to carry to the next round into the value slots "
        "(for example a Combine node that piles up each round's frames). When "
        "all rounds are done, the value slots output the final carried values. "
        "Everything between Loop Start and Loop End is what repeats."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # value slots first, then loop at the bottom (so it lines up with Loop
        # Start's loop output and the value wires stay straight). loop is
        # declared optional only so it can sit after the values - it MUST be
        # connected; run() raises a clear error if it is missing.
        optional = {
            ("value%d" % i): (ANY, {"rawLink": True, "tooltip": "The updated carried value to hand to the next round. Wire the matching Loop Start value slot's downstream result here. Optional."})
            for i in range(1, NUM + 1)
        }
        optional["loop"] = ("FLOW_CONTROL", {"rawLink": True, "tooltip": "Wire this from Loop Start's loop output. Required for the loop to run."})
        return {
            "required": {},
            "optional": optional,
            "hidden": {
                "dynprompt": "DYNPROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = tuple([ANY] * NUM)
    RETURN_NAMES = tuple(["value%d" % i for i in range(1, NUM + 1)])
    OUTPUT_TOOLTIPS = tuple(
        ["Final carried value %d, after the last round." % i for i in range(1, NUM + 1)]
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def run(self, loop=None, dynprompt=None, unique_id=None, **kwargs):
        if not _LOOP_OK:
            raise RuntimeError(_NEED_UPDATE)
        if not loop or not isinstance(loop, (list, tuple)):
            raise RuntimeError(
                "Loop End Pixaroma: connect the 'loop' input to Loop Start's "
                "'loop' output."
            )
        graph = GraphBuilder()
        start_id = loop[0]

        total = None
        start_node = dynprompt.get_node(start_id)
        if start_node["class_type"] == _LOOP_START:
            total = start_node["inputs"].get("total")

        carried = {("value%d" % i): kwargs.get("value%d" % i, None) for i in range(1, NUM + 1)}
        engine = graph.node(
            _LOOP_ENGINE,
            loop=loop,
            index_in=[start_id, NUM + 1],  # Loop Start's index output (now the last slot)
            total=total,
            **carried,
        )
        return {
            "result": tuple(engine.out(i) for i in range(NUM)),
            "expand": graph.finalize(),
        }


class PixaromaLoopEngine:
    """Internal recursion driver for Loop Start / Loop End.

    Users never place this by hand - Loop End spawns it. Each round it checks
    whether another round is due (index + 1 < total); if so it clones the loop
    body + itself and re-runs with the next index and updated carried values,
    otherwise it emits the final carried values.
    """

    @classmethod
    def INPUT_TYPES(cls):
        inputs = {
            "required": {
                "loop": ("FLOW_CONTROL", {"rawLink": True}),
                "index_in": (ANY,),
                "total": (ANY,),
            },
            "optional": {},
            "hidden": {
                "dynprompt": "DYNPROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }
        for i in range(1, NUM + 1):
            inputs["optional"]["value%d" % i] = (ANY,)
        return inputs

    RETURN_TYPES = tuple([ANY] * NUM)
    RETURN_NAMES = tuple(["value%d" % i for i in range(1, NUM + 1)])
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow/⚙️ Internal"

    # --- graph-walk helpers (find every node sitting between the brackets) ---
    def explore_dependencies(self, node_id, dynprompt, upstream, parent_ids):
        node_info = dynprompt.get_node(node_id)
        if "inputs" not in node_info:
            return
        for k, v in node_info["inputs"].items():
            if is_link(v):
                parent_id = v[0]
                display_id = dynprompt.get_display_node_id(parent_id)
                display_node = dynprompt.get_node(display_id)
                class_type = display_node["class_type"]
                if class_type not in (_LOOP_END, _LOOP_ENGINE):
                    parent_ids.append(display_id)
                if parent_id not in upstream:
                    upstream[parent_id] = []
                    self.explore_dependencies(parent_id, dynprompt, upstream, parent_ids)
                upstream[parent_id].append(node_id)

    def explore_output_nodes(self, dynprompt, upstream, output_nodes, parent_ids):
        for parent_id in upstream:
            display_id = dynprompt.get_display_node_id(parent_id)
            for output_id in output_nodes:
                id = output_nodes[output_id][0]
                if id in parent_ids and display_id == id and output_id not in upstream[parent_id]:
                    if "." in parent_id:
                        arr = parent_id.split(".")
                        arr[len(arr) - 1] = output_id
                        upstream[parent_id].append(".".join(arr))
                    else:
                        upstream[parent_id].append(output_id)

    def collect_contained(self, node_id, upstream, contained):
        if node_id not in upstream:
            return
        for child_id in upstream[node_id]:
            if child_id not in contained:
                contained[child_id] = True
                self.collect_contained(child_id, upstream, contained)

    def run(self, loop, index_in, total, dynprompt=None, unique_id=None, **kwargs):
        try:
            next_index = int(index_in) + 1
        except Exception:
            next_index = 1
        try:
            limit = int(total)
        except Exception:
            limit = 1

        # Loop is finished - emit the carried values unchanged.
        if next_index >= limit:
            return tuple(kwargs.get("value%d" % i, None) for i in range(1, NUM + 1))

        # Another round is due: clone the loop body + this engine and re-run with
        # the next index and the current carried values.
        upstream = {}
        parent_ids = []
        self.explore_dependencies(unique_id, dynprompt, upstream, parent_ids)
        parent_ids = list(set(parent_ids))

        # Track any output nodes (PreviewImage, save nodes ...) sitting inside the
        # loop so they execute every round.
        output_nodes = {}
        try:
            import nodes as _comfy_nodes

            all_maps = getattr(_comfy_nodes, "NODE_CLASS_MAPPINGS", {})
            prompts = dynprompt.get_original_prompt()
            for nid in prompts:
                node = prompts[nid]
                if "inputs" not in node:
                    continue
                class_def = all_maps.get(node.get("class_type"))
                if class_def is not None and getattr(class_def, "OUTPUT_NODE", False):
                    for k, v in node["inputs"].items():
                        if is_link(v):
                            output_nodes[nid] = v
        except Exception:
            output_nodes = {}

        graph = GraphBuilder()
        self.explore_output_nodes(dynprompt, upstream, output_nodes, parent_ids)

        contained = {}
        open_node = loop[0]
        self.collect_contained(open_node, upstream, contained)
        contained[unique_id] = True
        contained[open_node] = True

        # Recreate every contained node (the engine clone is named "Recurse").
        for node_id in contained:
            original_node = dynprompt.get_node(node_id)
            node = graph.node(original_node["class_type"], "Recurse" if node_id == unique_id else node_id)
            node.set_override_display_id(node_id)
        # Re-wire their inputs to point at the clones.
        for node_id in contained:
            original_node = dynprompt.get_node(node_id)
            node = graph.lookup_node("Recurse" if node_id == unique_id else node_id)
            for k, v in original_node["inputs"].items():
                if is_link(v) and v[0] in contained:
                    parent = graph.lookup_node(v[0])
                    node.set_input(k, parent.out(v[1]))
                else:
                    node.set_input(k, v)

        # Re-seed the cloned Loop Start: bump the index, hand it this round's
        # carried values.
        new_open = graph.lookup_node(open_node)
        new_open.set_input(_INDEX_KEY, next_index)
        for i in range(1, NUM + 1):
            new_open.set_input("value%d" % i, kwargs.get("value%d" % i, None))

        my_clone = graph.lookup_node("Recurse")
        return {
            "result": tuple(my_clone.out(i) for i in range(NUM)),
            "expand": graph.finalize(),
        }


NODE_CLASS_MAPPINGS = {
    "PixaromaLoopStart": PixaromaLoopStart,
    "PixaromaLoopEnd": PixaromaLoopEnd,
    "PixaromaLoopEngine": PixaromaLoopEngine,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaLoopStart": "Loop Start Pixaroma",
    "PixaromaLoopEnd": "Loop End Pixaroma",
    "PixaromaLoopEngine": "Loop Engine (internal)",
}
