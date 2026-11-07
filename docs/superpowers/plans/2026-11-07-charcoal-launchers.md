# Charcoal Launchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a configurable search launcher and hold-to-select favorites wheel to the GNOME 51 theme bundle.

**Architecture:** One independent Shell extension owns both surfaces, shortcut lifecycle, and GSettings preferences. Installed GNOME search providers supply files, calculations, and settings; Shell's application system supplies apps. Pure policy functions keep gesture/geometry/shortcut ownership testable without a running Shell.

**Tech Stack:** GJS, GNOME Shell 51, St/Clutter, GTK4/libadwaita, GSettings, Node's built-in test runner, existing Python installer tests.

**Spec:** `docs/superpowers/specs/2026-11-07-charcoal-launchers-design.md`

## Global Constraints

- GNOME Shell 51 on Wayland; no privileged helper or compositor patch.
- Super+Space opens search; tap Super opens overview; hold Super opens wheel.
- Release launches the highlighted app once; neutral/outside/Esc/cancel never launches.
- Preserve other Super shortcuts and restore displaced shortcuts without overwriting user edits.
- Preferences expose appearance, providers, motion, favorites, geometry, and controls.
- Reinstall preserves user customization; installer backup/restore remains functional.
- Report actual runtime verification separately from static checks.

## Review Focus

- Super chords during pending/visible wheel must cancel selection and remain usable: task 1 state tests and task 4 runtime checks.
- Screen-edge clamping must never select under a stationary pointer: task 1 geometry tests and task 2 runtime checks.
- New searches and closing must invalidate late provider results: task 2 query-generation test and runtime checks.
- User edits during shortcut ownership must survive disable/restart: task 1 ownership tests and task 4 lifecycle checks.
- Disable/lock/settings changes during a gesture must release input without activating: task 1 cancel tests and task 4 lifecycle checks.

## File responsibilities

`extensions/charcoal-launchers@local/`:
- `metadata.json`, `schemas/org.gnome.shell.extensions.charcoal-launchers.gschema.xml`: extension declaration and persistent settings.
- `policy.js`: gesture transitions, wheel geometry/hit testing, ownership merges, query generations.
- `input.js`: native shortcut registration, modal gesture handling, reversible keybinding ownership.
- `wheel.js`: disc drawing, icons, highlighting and animations.
- `search.js`: search field/results, provider calls, app matching, keyboard selection.
- `appearance.js`, `stylesheet.css`: shared colors/effects/animation helpers and baseline styles.
- `prefs.js`: editable libadwaita preferences and favorites picker.
- `extension.js`: lifecycle and coordination.
Tests: `tests/test_launchers.mjs`, `tests/test_installer.py`, and an isolated GNOME runtime harness if supported.
Integration: `install.py`, `README.md`.

### Task 1: Verify input feasibility and implement tested policies

**Interfaces:** `Gesture.press()`, `open()`, `cancel()`, `release(selection)` return action strings or selected app; `wheelGeometry(pointer, monitor, radius)` returns bounded center/radius; `wheelSelection(x,y,geometry,count,deadZone)` returns index or -1; shortcut merge helpers preserve concurrent edits; `QueryGeneration.next()/current(id)` guard stale results.

- [ ] Inspect installed GNOME input APIs and exercise a throwaway probe in an isolated headless session with a normal app focused. Confirm press/release and chord behavior before UI polish.
- [ ] Write Node tests for tap, hold, chord cancellation, repeated release, neutral/outside sectors, edge clamping, preserved shortcut edits, and stale queries. Run `node --test tests/test_launchers.mjs`; expect missing-policy failures.
- [ ] Implement pure policies and rerun the same tests; expect all pass.
- [ ] Record the verified native input mechanism and any limitations; stop changing the agreed gesture if feasibility fails.
- [ ] Commit task files.

### Task 2: Implement extension surfaces and preferences

**Consumes:** task 1's policy interfaces. **Produces:** wheel `open()/close()/selection`, search `toggle()/close()/destroy()`, input `enable()/destroy()` with callbacks, and default extension `enable()/disable()`.

- [ ] Add metadata/schema with 300 ms hold, short animations, independent feature toggles, bounded geometry, provider toggles, colors, shortcut ownership storage, favorites initialization marker, and resettable user settings.
- [ ] Implement input integration using the proven mechanism; use pending modal input only if necessary and preserve normal Shell shortcut action mode.
- [ ] Implement wheel with actual drawn-sector hit testing, movement-to-arm after opening, neutral center/outside boundary, and monitor clamping.
- [ ] Implement centered search using Shell's installed provider loader and cancellation; bound results, keep independent provider errors visible, and copy calculator clipboard text on Enter.
- [ ] Implement Preferences with live GSettings binding, app picker/reordering, shortcut capture/validation, appearance/motion controls, and reset confirmation.
- [ ] Implement lifecycle cleanup and guarded settings changes. Optional blur must be runtime verified and fall back gracefully.
- [ ] Compile schemas; import preferences in GJS; run Node tests; exercise surfaces in isolated GNOME with screenshots and provider calls.
- [ ] Commit task files.

### Task 3: Integrate installation and documentation

**Consumes:** new extension directory and schema. **Produces:** all installer modes install the new extension without resetting preferences; restore lets input ownership be released before deleting extension files.

- [ ] Extend installer test to assert new extension and compiled schema installation, repeated install preservation, dry-run behavior, and restore removal. Run `python3 tests/test_installer.py`; expect failure before installer change.
- [ ] Add new extension to target/activation/schema lists; ensure active launcher cleanup precedes restore/replacement and do not reset its own settings.
- [ ] Update README with launchers, Preferences, provider/index behavior, supported version, and verification commands.
- [ ] Run `python3 tests/test_installer.py` and `node --test tests/test_launchers.mjs`; expect green.
- [ ] Commit task files.

### Task 4: Runtime validation and final review

**Consumes:** complete extension and installer. **Produces:** runtime evidence and reviewed deliverable.

- [ ] Exercise normal-app focus, tap/hold/release, selected/unselected wheel, Esc, Super+Space, Super+Arrow before/after wheel, autorepeat, edge clamping, and disable while visible.
- [ ] Exercise app/file/calculation/settings searches, stale queries, Preferences updates, persistence, and animation-off behavior; inspect Shell logs.
- [ ] Run complete targeted suite, schema compilation, installer dry run, and diff checks once final changes are in place.
- [ ] Request one fresh whole-branch code review; fix important issues with regression checks.
- [ ] Deliver changes to the user's working checkout and install/activate when supported by the session without automatically logging out. Clearly report anything needing the next login or physical input verification.
