# ComfyUI Nodes 2.0 (V3 API) — Pixaroma Dev Guide

## Overview

ComfyUI supports two node registration systems:
- **V1** — `NODE_CLASS_MAPPINGS` + `INPUT_TYPES` / `FUNCTION` (old way, still works)
- **V3** — `io.ComfyNode` + `define_schema()` + `execute()` (Nodes 2.0)

**Critical rule:** ComfyUI uses `elif` when loading modules — if `NODE_CLASS_MAPPINGS` is present, `comfy_entrypoint` is **never called**. So while migrating, register V3 nodes directly in `NODE_CLASS_MAPPINGS` alongside V1 nodes.

---

## 1. Creating a V3 Node

```python
from comfy_api.latest import io

class MyNode(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Pixaroma_MyNode",       # unique ID, use a prefix
            display_name="My Node",
            category="Pixaroma",
            description="What this node does",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("count", default=1, min=0, max=100),
                io.String.Input("prompt", multiline=True),
                io.Combo.Input("mode", options=["option1", "option2"]),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output(display_name="result"),
            ],
        )

    @classmethod
    def execute(cls, image, count, prompt, mode, mask=None) -> io.NodeOutput:
        result = 1.0 - image  # example: invert image
        return io.NodeOutput(result)
```

---

## 2. Registering a V3 Node (Hybrid V1+V3 package)

In `nodes/node_ref.py` add the node to `NODE_CLASS_MAPPINGS`:

```python
NODE_CLASS_MAPPINGS = {
    "PixaromaReferenceNode": PixaromaReferenceNode,   # V1 node
    "Pixaroma_MyNode": MyNode,                         # V3 node — same dict
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaReferenceNode": "Reference Node",
    "Pixaroma_MyNode": "My Node",
}
```

In `__init__.py` make sure the mappings are merged as usual — no special handling needed.

> **When fully migrated to V3** (no V1 nodes left), you can switch to `comfy_entrypoint`:
> ```python
> from comfy_api.latest import ComfyExtension, io
> class MyExtension(ComfyExtension):
>     async def get_node_list(self): return [MyNode]
> async def comfy_entrypoint(): return MyExtension()
> ```
> And remove `NODE_CLASS_MAPPINGS` entirely from `__init__.py`.

---

## 3. All Built-in `io` Types

### Value types (become widgets in the UI)

| Type | Input example | Notes |
|------|--------------|-------|
| `io.Boolean` | `io.Boolean.Input("flag", default=True)` | checkbox |
| `io.Int` | `io.Int.Input("n", default=0, min=0, max=4096)` | number / slider |
| `io.Float` | `io.Float.Input("v", default=1.0, min=0.0, max=1.0)` | number / slider |
| `io.String` | `io.String.Input("text", multiline=False)` | text field |
| `io.Combo` | `io.Combo.Input("mode", options=["a","b","c"])` | dropdown |
| `io.MultiCombo` | `io.MultiCombo.Input("tags", options=["a","b"])` | multi-select |

### Socket types (become connectors in the UI)

| Type | Input example |
|------|--------------|
| `io.Image` | `io.Image.Input("image")` |
| `io.Mask` | `io.Mask.Input("mask")` |
| `io.Latent` | `io.Latent.Input("latent")` |
| `io.Conditioning` | `io.Conditioning.Input("positive")` |
| `io.Model` | `io.Model.Input("model")` |
| `io.Clip` | `io.Clip.Input("clip")` |
| `io.Vae` | `io.Vae.Input("vae")` |
| `io.ControlNet` | `io.ControlNet.Input("controlnet")` |
| `io.Audio` | `io.Audio.Input("audio")` |
| `io.Video` | `io.Video.Input("video")` |
| `io.Sampler` | `io.Sampler.Input("sampler")` |
| `io.Sigmas` | `io.Sigmas.Input("sigmas")` |
| `io.Guider` | `io.Guider.Input("guider")` |
| `io.Noise` | `io.Noise.Input("noise")` |
| `io.ClipVision` | `io.ClipVision.Input("clip_vision")` |
| `io.UpscaleModel` | `io.UpscaleModel.Input("upscale_model")` |

### Special types

| Type | Usage |
|------|-------|
| `io.AnyType` | Accepts any socket type |
| `io.Custom("MY_TYPE")` | Custom socket type string (see section 4) |

All inputs support these common optional parameters:
```python
io.Image.Input("image", optional=True, tooltip="The input image", advanced=False)
```

---

## 4. Custom Socket Types

Use `io.Custom("TYPE_STRING")` to bridge with V1 nodes that use custom types,
or to pass structured data between your own nodes.

```python
from comfy_api.latest import io
from comfy_api.latest._io import comfytype, ComfyTypeIO
from dataclasses import dataclass

# 1. Define the Python data structure
@dataclass
class PixaromaDataPayload:
    layers: list
    width: int
    height: int

# 2. Create the ComfyUI type
@comfytype(io_type="PIXAROMA_DATA")
class PixaromaData(ComfyTypeIO):
    Type = PixaromaDataPayload  # type hint for IDE — not enforced at runtime

# 3. Producer node
class ProducerNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Pixaroma_Producer",
            display_name="Pixaroma Producer",
            category="Pixaroma",
            inputs=[io.Image.Input("image")],
            outputs=[PixaromaData.Output(display_name="pixaroma_data")],
        )
    @classmethod
    def execute(cls, image) -> io.NodeOutput:
        return io.NodeOutput(PixaromaDataPayload(layers=[image], width=512, height=512))

# 4. Consumer node
class ConsumerNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Pixaroma_Consumer",
            display_name="Pixaroma Consumer",
            category="Pixaroma",
            inputs=[PixaromaData.Input("pixaroma_data")],
            outputs=[io.Image.Output(display_name="result")],
        )
    @classmethod
    def execute(cls, pixaroma_data: PixaromaDataPayload) -> io.NodeOutput:
        return io.NodeOutput(pixaroma_data.layers[0])
```

---

## 5. Frontend JS Registration

### What changed in Nodes 2.0

Nodes 2.0 migrated the ComfyUI frontend from LiteGraph canvas rendering to **Vue 3**. This affects custom nodes in a few ways:

| | Status |
|---|---|
| `app.registerExtension()` | ✅ Still works |
| `beforeRegisterNodeDef` | ✅ Still the primary hook (not deprecated) |
| `addDOMWidget` | ✅ Still works — now renders inside `DomWidgets.vue` |
| `getCustomWidgets` | ✅ Still works |
| Monkey-patching `app` / LiteGraph prototypes | ❌ Deprecated |
| `/scripts/ui.js` and legacy imports | ❌ Being removed — audit and replace |

**V3 Python `define_schema` handles standard inputs (Int, Float, String, Combo…) with zero JS.** Custom DOM widgets still need JS — no declarative Vue widget API exists yet for third-party nodes.

---

### Standard pattern — `beforeRegisterNodeDef`

```js
import { app } from "/scripts/app.js";

app.registerExtension({
  name: "Pixaroma.myNode",  // format: "Author.NodeName"

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaReferenceNode") return;

    // runs once per node type — patch the prototype
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments);

      this.size = [200, 230];

      let widget = this.addDOMWidget("CounterWidget", "custom", myElement, {
        getValue: () => ({ count: 0 }),
        setValue: (v) => { /* restore state */ },
        getMinHeight: () => 200,
        getMaxHeight: () => 400,
      });

      // always chain onRemoved — never overwrite directly
      const origOnRemoved = this.onRemoved?.bind(this);
      this.onRemoved = () => {
        origOnRemoved?.();
        widget = null;
      };
    };
  },
});
```

---

### Using Vue inside a widget (advanced)

ComfyUI **no longer exposes its own Vue instance** to extensions (removed in frontend v1.33.9). If you want Vue components inside a widget you must **bundle your own Vue** with Vite.

```js
// your-widget.mjs — built by Vite into a self-contained bundle
import { createApp } from "vue";  // bundled Vue, not ComfyUI's
import MyWidget from "./MyWidget.vue";

export function mountVueWidget(container) {
  const app = createApp(MyWidget);
  app.mount(container);
  return app;
}
```

Then in your `index.js`:
```js
import { mountVueWidget } from "./dist/your-widget-bundle.mjs";

// inside onNodeCreated:
const container = document.createElement("div");
const vueApp = mountVueWidget(container);
let widget = this.addDOMWidget("MyWidget", "custom", container, { ... });

const origOnRemoved = this.onRemoved?.bind(this);
this.onRemoved = () => {
  origOnRemoved?.();
  vueApp.unmount();
  widget = null;
};
```

> This requires a Vite build step and is only needed if you want Vue reactivity/components. Plain DOM widgets need none of this.

---

### Built-in `addWidget` types

All follow the shape: `node.addWidget(type, name, value, callback, options)`

**Native LiteGraph widgets:**

| Type | Example | Renders as |
|------|---------|------------|
| `"button"` | `addWidget("button", "Run", null, () => {})` | Clickable button |
| `"toggle"` | `addWidget("toggle", "enabled", true, (v) => {})` | On/off toggle |
| `"slider"` | `addWidget("slider", "strength", 1.0, (v) => {}, { min:0, max:2, step:0.1 })` | Range slider |
| `"number"` | `addWidget("number", "steps", 20, (v) => {}, { min:1, max:150, step:1, precision:0 })` | Number field |
| `"text"` | `addWidget("text", "name", "default", (v) => {})` | Single-line text |
| `"combo"` | `addWidget("combo", "mode", "a", (v) => {}, { values:["a","b","c"] })` | Dropdown |

**ComfyUI additions:**

| Type | Example | Renders as |
|------|---------|------------|
| `"customtext"` | `addWidget("customtext", "prompt", "", (v) => {})` | Multiline textarea |
| `addDOMWidget` | `addDOMWidget("name", "custom", element, { getValue, setValue })` | Any HTML element |

```js
// inside onNodeCreated — full examples:

// button — value is always null, callback fires on click
this.addWidget("button", "Open Editor", null, () => { /* open something */ });

// toggle
this.addWidget("toggle", "enabled", true, (v) => console.log(v));

// slider
this.addWidget("slider", "strength", 1.0, (v) => {}, { min: 0, max: 2, step: 0.1 });

// number
this.addWidget("number", "steps", 20, (v) => {}, { min: 1, max: 150, step: 1, precision: 0 });

// combo (dropdown)
this.addWidget("combo", "mode", "fast", (v) => {}, { values: ["fast", "quality", "balanced"] });

// multiline textarea (ComfyUI extension on top of LiteGraph)
this.addWidget("customtext", "prompt", "", (v) => {});

// DOM widget — for anything complex (canvas, color picker, custom UI)
const el = document.createElement("div");
let widget = this.addDOMWidget("MyWidget", "custom", el, {
  getValue: () => myState,
  setValue: (v) => { myState = v; },
  getMinHeight: () => 200,
  getMaxHeight: () => 400,
  margin: 5,
});
```

---

### Key rules

- Use `beforeRegisterNodeDef` + prototype patch, not `nodeCreated` with an early return
- Always chain `onRemoved` — never assign directly
- Extension name format: `"Author.NodeName"`
- Only `index.js` files use `.js` — all other modules use `.mjs`
- Do **not** import from `/scripts/ui.js` or other legacy script paths — they are being removed
- Do **not** monkey-patch `app` or LiteGraph prototypes directly
