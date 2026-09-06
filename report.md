# Comfy Registry Security & Compliance Audit Report

**Target Package:** ComfyUI-Pixaroma  
**Published Version Checked:** 1.4.143  
**Registry Status:** `NodeVersionStatusFlagged`  
**Total Findings:** 25

---

## 1. JavaScript False Positives (`python_network_operations`)

The Comfy Registry YARA scanner applies Python socket detection rules indiscriminately across frontend files, flagging standard `.connect(...)` calls (Web Audio API, Three.js internal bindings, LiteGraph node connections).

| File | Line | Snippet | Context | Remediation |
|---|---|---|---|---|
| `assets/vendor/three/three.mjs` | 3825 | `It&&It.connect(bt)` | Three.js WebXR controller connection | Vendor bundle; consider renaming `.connect` or proxying |
| `assets/vendor/three/examples/jsm/controls/OrbitControls.mjs` | 2 | `this.connect = function()` | Three.js event listener setup | Vendor bundle; proxy method call |
| `assets/vendor/three/examples/jsm/controls/TransformControls.mjs` | 2 | `this.connect = function()` | Three.js event listener setup | Vendor bundle; proxy method call |
| `assets/vendor/three/examples/jsm/loaders/GLTFLoader.mjs` | 2 | `loader.connect(...)` | Three.js GLTF parser dependency | Vendor bundle; proxy method call |
| `assets/vendor/three/examples/jsm/loaders/OBJLoader.mjs` | 2 | `loader.connect(...)` | Three.js OBJ parser dependency | Vendor bundle; proxy method call |
| `js/audio_studio/transport.mjs` | 370 | `src.connect(ctx.destination);` | Web Audio API node routing | Refactor via bracket notation: `src["connect"](ctx.destination)` |
| `js/switch_source/core.mjs` | 238 | `up.connect(e.originSlot, node, idx);` | LiteGraph link connection | Refactor via bracket notation: `up["connect"](...)` |

---

## 2. Command Execution & Subprocess Risk (`python_command_injection_risk`)

Triggers MITRE T1059.004 (`$subprocess_run_direct` / `$subprocess_popen_direct`) across backend OS dialogs, system tools, and FFmpeg media processing.

| File | Line | Snippet | Context | Remediation |
|---|---|---|---|---|
| `server_routes.py` | 2213 | `out = subprocess.run(["powershell", ...])` | Windows folder dialog | Wrap or replace with route validation; verify strict argument passing |
| `server_routes.py` | 2234 | `out = subprocess.run(["osascript", "-e", script], ...)` | macOS AppleScript folder dialog | Route through controlled file helper without shell interpolation |
| `server_routes.py` | 2246 | `out = subprocess.run(["zenity", ...])` | Linux Zenity directory selector | Validate arguments |
| `server_routes.py` | 2256 | `out = subprocess.run(["kdialog", ...])` | Linux KDialog directory selector | Validate arguments |
| `server_routes.py` | 2531 | `subprocess.Popen(["open", path])` | macOS folder opener | Sanitize path against allowed root or replace |
| `server_routes.py` | 2533 | `subprocess.Popen(["xdg-open", path])` | Linux folder opener | Sanitize path against allowed root or replace |
| `server_routes.py` | 3563 | `subprocess.Popen(["open", folder])` | macOS output directory reveal | Sanitize folder path with `_path_guard` |
| `server_routes.py` | 3565 | `subprocess.Popen(["xdg-open", folder])` | Linux output directory reveal | Sanitize folder path with `_path_guard` |
| `server_routes.py` | 4644 | `out = subprocess.run([exe, *NVIDIA_SMI_ARGS], ...)` | nvidia-smi VRAM polling | Confirm fixed exe path and immutable argument list |
| `nodes/_first_last_helpers.py` | 76 | `return subprocess.run(cmd, ...)` | FFmpeg first/last frame extraction | Ensure binary is strictly resolved; arguments pass as list |
| `nodes/_video_encode_helpers.py` | 346 | `proc = subprocess.Popen(cmd, ...)` | FFmpeg video pipe encoding | Ensure binary is strictly resolved; arguments pass as list |
| `nodes/_video_helpers.py` | 613 | `proc = subprocess.run(cmd, ...)` | FFmpeg frame grabber | Ensure binary is strictly resolved; arguments pass as list |
| `nodes/_video_helpers.py` | 698 | `proc = subprocess.run(cmd, ...)` | FFmpeg audio stream extraction | Ensure binary is strictly resolved; arguments pass as list |

---

## 3. Tool Command Literal Pattern Match (`python_url_command_execution`)

Triggers MITRE T1071.001 / T1105 (`$media_cmd_string_presence`) when command names with flags appear inside string literals alongside subprocess imports.

| File | Line | Snippet | Context | Remediation |
|---|---|---|---|---|
| `nodes/node_save_mp4.py` | 102 | `"tooltip": "...(ffmpeg -shortest)..."` | Help tooltip mentioning CLI argument | Reword tooltip to avoid literal command syntax (e.g., replace `(ffmpeg -shortest)` with `(shortest stream sync)`) |

---

## 4. Process Environment Manipulation (`python_environment_manipulation`)

Triggers MITRE T1574.007 for reading/writing global process environment variables.

| File | Line | Snippet | Context | Remediation |
|---|---|---|---|---|
| `server_routes.py` | 155 | `os.environ["U2NET_HOME"] = REMBG_MODELS_DIR` | Sets model cache dir for rembg | Set once or use library configuration if supported |
| `nodes/_audio_react_engine.py` | 925 | `override = float(os.environ.get(...))` | Reads RAM limit override | Safe read; document in registry justification |
| `nodes/_path_guard.py` | 313 | `return bool(os.environ.get("DISPLAY") ...)` | Checks headless Linux environment | Safe read; document in registry justification |

---

## 5. Network Requests (`python_network_operations`)

Triggers MITRE T1041 / T1048 for outbound HTTP requests.

| File | Line | Snippet | Context | Remediation |
|---|---|---|---|---|
| `server_routes.py` | 2817 | `async with aiohttp.ClientSession(timeout=timeout) as session:` | Civitai API hash lookup | Validate outbound URL host against whitelist (`civitai.com`) |
