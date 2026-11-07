# Charcoal launchers

Status: approved and implemented; runtime validation recorded in the implementation plan ledger.

User refinement: smaller wheel and a cleaner minimal theme for both surfaces. Defaults now use a 120 logical-pixel radius, 32-pixel wheel icons, and subtle highlights.

## Intent and agreed behavior

Extend the user's charcoal GNOME desktop with a centered multipurpose launcher
and a favorites wheel. Ordinary changes must be available in the GNOME Extensions
application's Preferences window rather than requiring source edits.

| Input | Result |
| --- | --- |
| Super+Space | Toggle the centered search launcher. |
| Tap Super | Keep the existing workspace overview behavior. |
| Hold Super | After the configurable delay, expand the favorites wheel around the cursor. |
| Move into a wheel sector | Highlight that app. |
| Release Super with a highlighted app | Launch that app once and close the wheel. |
| Release Super without a highlighted app | Close without launching. |
| Esc | Cancel either surface without launching. |

Super+Space cancels the pending wheel gesture. Other Super shortcuts must continue
working without opening the wheel or triggering an app on release. The wheel
never stays open after Super is released. Its center is a neutral cancellation
area. Closing animations do not extend the selection or activation window.

## Current environment and constraints

- Observed GNOME Shell 51.1 on Wayland; the bundle targets GNOME 51.
- Existing custom extension controls the adaptive panel and popup handoffs.
  Keep the launchers independently enableable rather than adding them to that
  extension's lifecycle.
- Existing themes and Blur My Shell provide the desktop's charcoal appearance.
- GNOME Files, Calculator, and Settings search-provider definitions and
  `localsearch` are installed. Their presence does not prove runtime availability
  or full file indexing; verify both during implementation.
- Super+Space currently belongs to forward input-source switching. Only US
  English is configured. Super+Shift+Space is the backward switching shortcut.
- The installer has explicit extension lists, schema compilation, activation,
  backup, dry-run, copy-only, and restore paths; the new extension must participate
  in those paths.
- Reference video: a local screen recording of the desired search animation (not included).
  Use it as a styling/motion reference; the requested search surface is centered.

## Approaches

The conversation established a GNOME extension with editable preferences as the
direction and accepted the interaction design. The precise implementation choice
below is the builder's recommendation, not a claim that the user selected a
particular internal API.

1. **One dedicated Shell extension, reusing installed search providers — chosen
   recommendation.** Shares appearance, settings, and input coordination between
   the two surfaces. Reuses desktop search services while allowing a custom
   centered interface. Requires maintaining compatibility with GNOME 51 APIs.
2. **A standalone search application plus a separate wheel extension.** Separates
   search from Shell but introduces another dependency and settings surface, and
   makes consistent styling and shortcut coordination harder. Does not improve
   the requested integrated experience enough to justify those costs here.

CSS alone cannot implement the requested interactions. No change of desktop or
compositor is in scope.

## Centered launcher

Use a compact floating panel centered on the monitor containing the pointer at
invocation (builder default). Give its search field immediate keyboard focus.
Use themed app icons, charcoal colors, rounded corners, and a brief scale/fade
transition. Bound its width and result height to the monitor's available area.

Initial scope:

- Installed applications: find by name and relevant desktop metadata; activate
  using the desktop application APIs.
- Files and folders: query the installed Files provider and open its results.
  Coverage follows the provider/index; do not promise a whole-disk search or
  scan the filesystem in the Shell process.
- Calculations: query the installed Calculator provider, show the result inline,
  and provide a clear Copy result action. No evaluation of input as JavaScript
  or shell commands. Verify the provider's result format before implementing copy.
- Settings: query the installed Settings provider and open the selected result.

Use modest result limits with visible category labels, keyboard Up/Down selection,
Enter activation, pointer activation, and Escape/outside-click dismissal. For
calculation results, Enter copies the answer; communicate that action in the UI.
An empty query shows configured favorites. This is a builder default.

Debounce provider queries and ignore stale responses when the input changes or
the launcher closes. One unavailable or slow provider must not block others.
Honor the extension's category toggles and relevant desktop search privacy
settings. Provide a concise unavailable state when a requested provider cannot
be used. Additional providers, web search, command execution, and custom plugin
systems are outside the initial scope.

## Favorites wheel

Builder defaults: 300 ms hold delay, approximately 180 ms opening animation,
approximately 120 ms closing animation, and six to eight comfortably spaced
slots where the configured favorites permit it. Final dimensions are tunable
after viewing the interface at the user's display scale.

Initialize the configurable list from GNOME's current favorites once. Persist an
independent list of desktop app IDs so changing this wheel does not unexpectedly
reorder the desktop dash. Preferences provide an installed-app picker, removal,
and ordering controls. Handle missing or uninstalled favorites gracefully.

Freeze the wheel's position when it opens. Clamp its bounds to the invoking
monitor and reduce geometry if necessary on a small display. Hit testing must
use the actual drawn center and sectors. Require pointer movement into a sector
after opening before arming an app, so edge clamping cannot accidentally select
an app under a stationary cursor. The neutral center and outside the wheel's
outer selection boundary clear the highlight. Allow up to twelve favorites for
the first version; no nested wheels or paging.

Snapshot the selection on Super release, stop input immediately, dismiss, and
activate at most once. Esc, locking, disabling the extension, monitor changes,
and cancellation by another shortcut never activate a selection. Handle an empty
favorites list without trapping input; direct setup to Preferences.

## Keyboard integration and feasibility check

Before polishing the UI, verify on GNOME 51 Wayland that the implementation can
observe the required Super press/release lifecycle while a normal app has focus,
preserve modifier combinations, and prevent the ordinary overview action after
a consumed hold. Shell's existing overlay-key signal alone must not be assumed
to provide both edges. Examine the installed APIs/source and test the mechanism.

No root helper, global input-device reader, synthetic keystrokes, or compositor
patch is part of this design. If supported Shell integration cannot satisfy the
gesture reliably, report the precise limitation before changing the agreed
shortcut or implementing a replacement gesture.

State handling must distinguish idle, pending hold, cancelled chord, visible
wheel, and consumed release. Ignore autorepeat. Cancel pending work on lock,
session transitions, disable, and loss of the relevant input context. A chord
pressed while the wheel is visible must cancel wheel activation and preserve the
intended shortcut; this is part of the feasibility test, not an assumed property
of modal input capture.

Record only the conflicting shortcut entries that this extension changes.
Remove the exact Super+Space conflict while retaining unrelated keyboard-switch
bindings. Restore displaced entries when the configured shortcut changes or the
extension is disabled, without overwriting intervening user edits. Persist enough
ownership information to recover after a Shell restart. Do not reset entire
keybinding arrays to system defaults. If the binding is locked or claimed by an
unknown component, expose the conflict and leave the unrelated binding intact.

## Preferences and persistence

Provide a GTK4/libadwaita Preferences window through GNOME Extensions, backed by
the extension's GSettings schema. Organize it into understandable sections:

- General: enable each launcher independently, search shortcut, hold delay.
- Search: applications/files/calculator/settings toggles and result limit.
- Favorites: add/remove/reorder apps, wheel size, icon size, and neutral-center
  size/spacing controls with bounds that preserve usable geometry.
- Appearance: background, foreground, accent/highlight colors, opacity, launcher
  corner radius, and icon size. Defaults match the existing charcoal desktop.
- Motion: animation duration, scale effect, and off switch; respect the system's
  disabled-animations setting.
- Background effects: blur enable/strength only if supported and verified for
  these surfaces. Clearly mark unavailable controls; use a readable translucent
  or opaque fallback. Do not change global Blur My Shell settings for this UI.
- Reset to defaults: reset this extension's preferences, with an explicit UI
  confirmation because it also resets the user's favorites.

Routine appearance settings apply live. Changes affecting an active gesture close
it without launching before applying. Settings persist across sessions and bundle
updates; reinstalling must not reset user customization.

## Lifecycle and integration

Create a dedicated extension (working name `charcoal-launchers@local`) with
separate input, search, wheel, and preferences responsibilities as needed; avoid
a framework or generic provider system. Keep UI actors, signals, async results,
sources/timers, effects, and modal grabs owned by its lifecycle. Disable must
clean them up and restore any Shell integration it replaced.

Integrate the extension and schema into all installer modes. Preserve existing
backups and unrelated extensions, and retain copy-only/dry-run behavior. Include
any installer-owned new settings in backup/restore. Restore an active launcher
extension in a way that lets it release its owned shortcuts before its files or
schema are removed. Do not overwrite extension preferences during activation.
Document opening Preferences, keyboard behavior, file-indexing limitations,
installation, and restore. No automatic logout; the existing GNOME code-reload
requirement remains documented.

## Validation and completion criteria

- Targeted tests for the input state machine, one-shot release activation,
  neutral/outside selection, edge geometry, stale query handling, and restoration
  that preserves user edits. Avoid tests that simply repeat UI implementation.
- Compile schemas and check JavaScript using appropriate available tools.
- Extend and run installer tests for the new extension/schema and backup/restore.
- Exercise Preferences and confirm live updates and session persistence.
- In GNOME 51 Wayland, test tap, hold, release, empty selection, Esc, Super+Space,
  other Super combinations before/after wheel opening, repeat presses, normal-app
  focus, and disable while either surface is active.
- Check providers against actual app/file/calculation/settings queries; report
  index limitations separately from launcher failures.
- Visually check centered placement, wheel edge handling, scaling, motion, and
  disabled animations, plus extension logs for runtime errors.
- Distinguish static verification from real-session verification in the delivery
  report. Do not claim the gesture works until it has been observed live.

## Decisions left to implementation

Exact color values, dimensions, debounce interval, result ranking details,
internal module boundaries, and the supported blur mechanism are builder choices
within this design. Existing providers and Shell APIs must be verified against
the installed version. Changing the agreed shortcuts, hold/release semantics,
editable-preferences requirement, or adding a privileged helper requires returning
to the user with the reason.
