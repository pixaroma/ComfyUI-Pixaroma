---
name: comfy-registry-compliance
description: >-
  Audits, diagnoses, and remediates security flags and scanner violations in ComfyUI custom node packages
  for Comfy Registry compliance (api.comfy.org).
---

# Comfy Registry Security & Compliance Remediation

Guide for auditing, diagnosing, and fixing security scanner violations (such as `NodeVersionStatusFlagged` or `NodeVersionStatusBanned`) on the ComfyUI Registry (`api.comfy.org`).

---

## 1. Diagnostic API Queries

The registry runs automated AST, GPT, and YARA security scanners on uploaded packages. Always query the specific version with `include_status_reason=true` to extract the exact scanner findings.

### Fetch All Versions & Status Reasons
```bash
curl -s "https://api.comfy.org/nodes/<node_id>/versions?include_status_reason=true"
```

### Inspect the Latest / Specific Version
```bash
python -c "import urllib.request, json; data = json.loads(urllib.request.urlopen('https://api.comfy.org/nodes/<node_id>/versions?include_status_reason=true').read()); [print(json.dumps(v, indent=2)) for v in data if v.get('version') == '<target_version>']"
```

### Status Types
- `NodeVersionStatusActive`: Approved and clean.
- `NodeVersionStatusFlagged`: Triggered security rules; review `status_reason`.
- `NodeVersionStatusBanned`: Rejected by admin or critical RCE policy violation.

---

## 2. Common Scanner Triggers & Required Fixes

### A. YARA False Positives on JavaScript (`python_network_operations`)
- **Root Cause**: The Comfy Registry YARA rules for Python sockets are run indiscriminately across all files, including `.js` / `.mjs`.
  - Pattern `$socket4 = ".bind("` triggers on any JavaScript `Function.prototype.bind(...)` (e.g., `button.draw.bind(button)`).
  - Pattern `$socket` or `.connect(` triggers on Web Audio or canvas connections.
- **Remediation**:
  - Replace `.bind(thisArg)` in JS with `.call(thisArg, ...)` or arrow function wrappers:
    ```javascript
    // Flagged by YARA $socket4:
    const buttonDraw = noteButton.draw.bind(noteButton);

    // Clean replacement:
    const origButtonDraw = noteButton.draw;
    noteButton.draw = () => {};
    drawNoteButton = (ctx) => {
      if (noteButton.isVisible) origButtonDraw.call(noteButton, ctx);
    };
    ```

### B. Path Traversal & Arbitrary File Access (`SensitiveFileAccess` / `CodeInjection`)
- **Root Cause**: Reading, writing, or serving files where path elements originate from client routes or node inputs without traversal containment.
- **Remediation**:
  - Always validate paths using `os.path.basename` and `os.path.commonpath`:
    ```python
    import os

    def get_safe_path(base_dir: str, file_name: str) -> str:
        safe_name = os.path.basename(file_name.strip())
        target_path = os.path.abspath(os.path.join(base_dir, safe_name))
        base_dir_abs = os.path.abspath(base_dir)
        if os.path.commonpath([base_dir_abs, target_path]) != base_dir_abs:
            raise ValueError("Path traversal attempt detected")
        return target_path
    ```
  - Whitelist allowed file extensions when handling uploads or style templates.

### C. Runtime Package Installation & Executables
- **Root Cause**: Using `pip install` / `subprocess` inside node logic, or downloading runtime binaries (`.exe`, `.dll`, `.bin`).
- **Remediation**:
  - Remove all dynamic `subprocess.run([sys.executable, "-m", "pip", ...])` calls.
  - Declare dependencies in `pyproject.toml`:
    ```toml
    [project]
    dependencies = [
        "Pillow",
        "numpy",
        "torch",
        "pyyaml"
    ]

    [project.optional-dependencies]
    rembg = ["rembg[gpu]"]
    ```
  - If an optional package is missing at runtime, raise an `ImportError` directing the user to install dependencies.

### D. RCE & Subprocess Execution (`python_command_injection_risk`)
- **Root Cause**: Use of `os.system`, `eval()`, `exec()`, or uncontained `subprocess.Popen` / `subprocess.run`.
- **Remediation**:
  - Eliminate `eval()` and `exec()` completely.
  - Avoid `shell=True` on any subprocess call.
  - If CLI utilities (e.g., `ffmpeg`) must run, pass fixed argument lists without dynamic string interpolation.

---

## 3. Step-by-Step Remediation Workflow

1. **Query Status**: Run the curl command with `?include_status_reason=true` to obtain JSON findings.
2. **Locate Violations**: Match `file_path`, `line_number`, and `line_snippet` from the JSON payload against the local source files.
3. **Apply Targeted Patch**:
   - For JS `.bind(` matches, refactor to `.call()` or arrow functions.
   - For file operations, route through `get_safe_path`.
   - For pip installs / binaries, shift dependencies to `pyproject.toml`.
4. **Bump Version**: Update `version` in `pyproject.toml`.
5. **Verify Clean Tree**: Ensure no other occurrences of `.bind(`, `eval(`, or unsanitized `open(` exist in the codebase.
