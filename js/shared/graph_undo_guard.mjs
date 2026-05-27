// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Shared Ctrl+Z / graph-undo guard for Pixaroma fullscreen editors.     ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Problem (CLAUDE.md Vue Compat #6): ComfyUI's Ctrl+Z runs through
// changeTracker.undo -> app.loadGraphData -> graph.configure (scheduled via
// requestAnimationFrame), AND via the Vue command store (Comfy.Undo/Redo ->
// graph.undo/redo). A fullscreen editor's keydown handler + preventDefault
// cannot preempt those rAF/command paths, so Ctrl+Z escapes the editor and can
// revert / delete the node out from under the open overlay.
//
// This guard, while ANY registered editor overlay is alive, no-ops every graph
// teardown entry point so Ctrl+Z can only drive the editor's own undo:
//   app.loadGraphData, app.graph.configure, app.graph.undo, app.graph.redo,
//   and the Comfy.Undo / Comfy.Redo command-store dispatch.
//
// Three correctness requirements, all handled here so each editor doesn't
// re-implement (and re-break) brick-sensitive code:
//   1. SELF-HEAL (Vue Compat #2): if every overlay is torn down WITHOUT the
//      editor's cleanup running (tab closed mid-edit), the next call restores
//      the real functions and passes through — so the patch can never stay
//      installed forever and brick "open/create any workflow".
//   2. REFCOUNT: multiple editors can be open at once (two nodes). The patch
//      installs once, blocks while ANY is alive, and restores only when the
//      LAST one closes — so closing one never strips protection from another.
//   3. SINGLE SYSTEM: all editors share THIS guard (one wrapper on each app
//      function) instead of each editor wrapping independently (independent
//      wrappers fight each other on restore and can brick on cross-close).
//
// Usage (per editor):
//   import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";
//   // in open(): isAlive returns whether THIS editor's overlay is still in DOM
//   this._undoGuardOff = installGraphUndoGuard(() => !!this.overlay?.isConnected);
//   // in close()/cleanup AND onRemoved: this._undoGuardOff?.();  this._undoGuardOff = null;

const _tokens = new Set(); // { isAlive: () => boolean }
let _installed = false;
let _orig = {}; // { load, configure, undo, redo, exec }

function _anyAlive() {
  for (const t of _tokens) {
    try {
      if (t.isAlive()) return true;
    } catch {
      /* a throwing isAlive counts as dead */
    }
  }
  return false;
}

function _restore() {
  const app = window.app;
  if (app) {
    if (_orig.load) app.loadGraphData = _orig.load;
    if (app.graph && _orig.configure) app.graph.configure = _orig.configure;
    if (app.graph && _orig.undo) app.graph.undo = _orig.undo;
    if (app.graph && _orig.redo) app.graph.redo = _orig.redo;
    if (_orig.exec && app.extensionManager?.command)
      app.extensionManager.command.execute = _orig.exec;
  }
  _orig = {};
  _installed = false;
  _tokens.clear();
}

/**
 * Register a fullscreen editor with the shared graph-undo guard.
 * @param {() => boolean} isAlive returns true while this editor's overlay is in the DOM.
 * @returns {() => void} uninstall function — call from the editor's close/cleanup AND onRemoved.
 */
export function installGraphUndoGuard(isAlive) {
  const app = window.app;
  if (!app || !app.graph) return () => {};

  const token = { isAlive };
  _tokens.add(token);

  if (!_installed) {
    _installed = true;
    _orig.load = app.loadGraphData.bind(app);
    _orig.configure = app.graph.configure.bind(app.graph);
    _orig.undo = app.graph.undo ? app.graph.undo.bind(app.graph) : null;
    _orig.redo = app.graph.redo ? app.graph.redo.bind(app.graph) : null;
    _orig.exec = app.extensionManager?.command?.execute
      ? app.extensionManager.command.execute.bind(app.extensionManager.command)
      : null;

    app.loadGraphData = function (...args) {
      if (_anyAlive()) return Promise.resolve();
      const o = _orig.load; // capture before _restore clears it
      _restore();
      return (o || window.app.loadGraphData)(...args);
    };
    app.graph.configure = function (...args) {
      if (_anyAlive()) return undefined;
      const o = _orig.configure;
      _restore();
      return o ? o(...args) : window.app.graph.configure(...args);
    };
    if (_orig.undo)
      app.graph.undo = function (...args) {
        if (_anyAlive()) return undefined;
        const o = _orig.undo;
        _restore();
        return o(...args);
      };
    if (_orig.redo)
      app.graph.redo = function (...args) {
        if (_anyAlive()) return undefined;
        const o = _orig.redo;
        _restore();
        return o(...args);
      };
    if (_orig.exec)
      app.extensionManager.command.execute = function (id, ...rest) {
        if ((id === "Comfy.Undo" || id === "Comfy.Redo") && _anyAlive()) return undefined;
        return _orig.exec(id, ...rest);
      };
  }

  // Uninstall for THIS editor. Restores the originals only when the last
  // registered editor is gone. Idempotent (safe to call from close + onRemoved).
  return function uninstall() {
    _tokens.delete(token);
    if (_anyAlive()) return; // other editors still open — keep the guard
    _restore();
  };
}
