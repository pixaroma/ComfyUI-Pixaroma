"""Save Text Pixaroma - collect text across runs, keep it on the node, mirror it
to a .txt file.

Deliberately a THIN node. It passes the text straight through and reports it to
the browser; the browser owns the collected buffer and does the file writing
through /pixaroma/api/save_text/write.

WHY the buffer is not handled here (this is the load-bearing design decision):

  The buffer would have to reach Python through a hidden state input (Vue Compat
  #9), which means it changes on EVERY run. A node whose inputs change is dirty,
  and ComfyUI invalidates everything downstream of a dirty node - so a Save Text
  dropped mid-chain in front of a sampler would re-run that sampler on every
  queue. The whole point of the `text` passthrough is that you CAN put it
  mid-chain, so that had to stay free.

  Keeping Python stateless also means this node caches normally.

  ⚠️ Caching does NOT stop a duplicate on its own, and an earlier version of
  this comment claimed it did. MEASURED against the installed ComfyUI: a cached
  node does not re-execute, but execution.py's `_send_cached_ui` still replays
  an IDENTICAL `executed` event to the browser (the same mechanism that makes
  Preview Image re-show its picture on an unchanged re-queue). Two queues of an
  unchanged graph produced two events, and with Skip repeats set to "Keep all"
  the same prompt was collected twice.

  What actually prevents it lives in the browser: `execution_cached` names the
  cached node ids before the replay, so js/save_text/index.js skips those, and
  `shouldCollect` is a second belt for the case ComfyUI cannot help with (a
  workflow reload clears the cache, so the first run afterwards would otherwise
  re-add the prompt that is already last).

  Consequence, stated honestly: collecting happens while the workflow is open in
  a browser. A headless API run passes text through and writes no file.

So: do NOT add an IS_CHANGED here. `float("nan")` (Save Image's fix, for a node
that must always write a file) would make this node re-run every queue and drag
its downstream with it, which is the bug described above.
"""


class PixaromaSaveText:
    """Collect text from every run into one list you can edit, copy and save."""

    DESCRIPTION = (
        "Collects text across workflow runs. Each run adds what comes in to the "
        "list on the node, separated by a blank line, and the node mirrors that "
        "list to a .txt file so nothing gets lost. Edit the list, copy it, or "
        "clear it to start a new file. Clear never erases the file it already "
        "wrote: it moves on to the next name, so old collections are kept. The "
        "text also passes straight through the output, so the node can sit in "
        "the middle of a chain without changing anything. Useful for keeping the "
        "prompts an LLM generates, or any prompt you tried and want back later. "
        "With One file per entry on in the settings, every entry is also saved "
        "as its own .txt named by the name input, for example one caption file "
        "per picture."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "The text to collect. Wire a prompt node, a Show "
                            "Text, or an LLM prompt generator here. Each run "
                            "adds one entry. Running again without changing "
                            "anything adds nothing, so re-running does not fill "
                            "the list with copies."
                        ),
                    },
                ),
                # Appended LAST and optional (backend rules: a new input never
                # shifts old prompts). Only the One file per entry setting reads
                # it; the browser writes <name>.txt through the same route.
                "name": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": (
                            "Optional. The file name for this entry, used only "
                            "when One file per entry is on in the settings. Wire "
                            "a picture's filename from Load Images from Folder "
                            "and each picture gets its own .txt with the same "
                            "name, for example training captions."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = (
        "The same text that came in, unchanged, so this node can sit in the "
        "middle of a chain. Collecting does not alter it.",
    )
    FUNCTION = "collect"
    CATEGORY = "👑 Pixaroma/💬 Prompt & Text"
    # Needed or the node never runs when nothing is wired to its output - which
    # is the normal way to use it, parked off to the side collecting.
    OUTPUT_NODE = True

    def collect(self, text=None, name=None):
        # Any-type upstreams and list inputs can hand over something that is not
        # a string (see reference_optional_input_is_not_type_guaranteed): coerce
        # rather than raise, so one odd wire cannot fail a whole run.
        if text is None:
            out = ""
        elif isinstance(text, str):
            out = text
        elif isinstance(text, (list, tuple)):
            out = "\n".join(str(t) for t in text if t is not None)
        else:
            out = str(text)

        # The name is only a LABEL for the browser (which sanitises it through
        # the write route's containment, server_routes save_text/write); nothing
        # here touches the filesystem. Coerced like the text, never raises.
        if name is None:
            nm = ""
        elif isinstance(name, str):
            nm = name.strip()
        elif isinstance(name, (list, tuple)):
            nm = str(name[0]).strip() if name and name[0] is not None else ""
        else:
            nm = str(name).strip()

        # The browser reads this and does the collecting. An empty run still
        # reports, so the node can show that it ran and found nothing.
        return {
            "ui": {"pixaroma_save_text": [{"text": out, "name": nm}]},
            "result": (out,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaSaveText": PixaromaSaveText}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSaveText": "Save Text Pixaroma"}
