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

export function snapshotActors(actors) {
    const snapshot = new Map();
    for (const key of ['clock', 'date', 'user', 'prompt', 'status', 'notifications']) {
        const actor = actors[key];
        if (actor) snapshot.set(actor, {style: actor.style, translationX: actor.translation_x,
            translationY: actor.translation_y, visible: actor.visible});
    }
    return snapshot;
}

export function restoreActors(snapshot) {
    for (const [actor, state] of snapshot) {
        if (!actor.get_parent()) continue;
        actor.style = state.style;
        actor.translation_x = state.translationX;
        actor.translation_y = state.translationY;
        actor.visible = state.visible;
    }
}
