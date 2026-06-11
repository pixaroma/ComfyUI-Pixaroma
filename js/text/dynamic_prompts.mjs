// Text Pixaroma - dynamic-prompt resolver.
//
// Only runs when the node's "Dynamic prompts" switch is ON (default OFF). When
// OFF, the typed text is passed through verbatim - every { } stays literal, no
// comment is stripped - so JSON prompts and braces survive untouched. This is
// the opt-in replacement for ComfyUI's native `dynamicPrompts: True` flag, which
// processed EVERY Text Pixaroma unconditionally and ate JSON braces (the brace
// eating is by design for the {a|b} feature, just no longer forced on everyone).
//
// Implements the documented contract from node_text.py:
//   - {a|b|c}  -> one option picked at random each queue (nest freely: {a|{b|c}})
//   - \{ \}    -> a literal brace (escaped, never treated as a group)
//   - // ...   -> line comment, stripped to end of line
//   - /* ... */-> block comment, stripped
// A pipe-less group {x} resolves to x (braces removed) and {} resolves to empty,
// matching ComfyUI's native behavior so turning the switch ON reproduces exactly
// what the node did before this toggle existed.

// Private-use-area placeholders for escaped braces - astronomically unlikely to
// appear in real prompt text, so they round-trip without colliding with content.
// Built with fromCharCode so the source stays pure ASCII (no invisible chars).
const ESC_OPEN = String.fromCharCode(0xe000);
const ESC_CLOSE = String.fromCharCode(0xe001);

export function resolveDynamicPrompt(input) {
  if (typeof input !== "string") return input;
  // Fast path: nothing a resolver would touch - no brace, no comment marker, and
  // no backslash (a lone escaped brace like \} with no { still needs unescaping
  // to a literal }, so any backslash takes the full path; a non-escape backslash
  // is left untouched by the full path, so this is safe, just slightly slower).
  if (input.indexOf("{") === -1 && input.indexOf("\\") === -1 &&
      input.indexOf("//") === -1 && input.indexOf("/*") === -1) {
    return input;
  }
  // 1) Strip block comments, then line comments (matches the documented order).
  let s = input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "");
  // 2) Protect escaped braces so they survive resolution as literals.
  s = s.split("\\{").join(ESC_OPEN).split("\\}").join(ESC_CLOSE);
  // 3) Resolve the innermost {a|b|c} groups repeatedly until none remain. The
  //    [^{}] body can't span a nested group, so each pass collapses the deepest
  //    level; looping handles nesting. The guard caps pathological inputs.
  let prev;
  let guard = 0;
  do {
    prev = s;
    s = s.replace(/\{([^{}]*)\}/g, (_m, body) => {
      const opts = body.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
  } while (s !== prev && ++guard < 1000);
  // 4) Restore the escaped braces as literal characters.
  s = s.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
  return s;
}
