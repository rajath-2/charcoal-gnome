import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME Shell 51: screenShield._dialog is UnlockDialog (ui/unlockDialog.js).
// _stack contains _clock and _promptBox; authentication remains in _authPrompt.
export function findLockActors(shell = Main) {
    const dialog = shell.screenShield?._dialog;
    if (!dialog?._clock?._time || !dialog._clock._date || !dialog._promptBox ||
        !dialog._stack || !dialog._bottomButtonGroup || !dialog._backgroundGroup) return null;
    return {dialog, clock: dialog._clock._time, date: dialog._clock._date,
        user: dialog._authPrompt?._userWell ?? null, prompt: dialog._promptBox,
        authEntry: dialog._authPrompt?._entry ?? null, status: dialog._bottomButtonGroup,
        background: dialog._backgroundGroup, notifications: dialog._notificationsBox};
}

export const ACTOR_KEYS = ['clock', 'date', 'user', 'prompt', 'status', 'notifications'];

// Each entry records what the runtime changed: offsets it added (dx, dy) and whether it hid the actor.
export function snapshotActors(actors) {
    const snapshot = new Map();
    for (const key of ACTOR_KEYS) {
        const actor = actors[key];
        if (actor) snapshot.set(actor, {key, style: actor.style, dx: 0, dy: 0, hidden: false, visible: actor.visible});
    }
    return snapshot;
}

// Undo only our changes: GNOME animates the prompt's translation and visibility itself, so
// offsets are subtracted rather than reset, and the prompt's visibility is never touched.
export function restoreActors(snapshot) {
    for (const [actor, state] of snapshot) {
        if (!actor.get_parent()) continue;
        // Clear our bookkeeping before writing, so watchers of these properties see nothing left to re-add.
        const {dx, dy, hidden} = state;
        state.dx = state.dy = 0;
        state.hidden = false;
        actor.style = state.style;
        actor.translation_x -= dx;
        actor.translation_y -= dy;
        if (hidden && state.key !== 'prompt') actor.visible = state.visible;
    }
}
