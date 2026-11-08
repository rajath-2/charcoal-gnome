const ACTIONS = new Set(['lock', 'suspend', 'note', 'settings', 'logout', 'restart', 'poweroff']);

export function requiresConfirmation(id) {
    return ['logout', 'restart', 'poweroff'].includes(id);
}

export async function dispatchAction(id, services, confirmed = false) {
    if (!ACTIONS.has(id)) throw new Error(`Unknown action: ${id}`);
    if (requiresConfirmation(id) && !confirmed) return false;
    await services[id]();
    return true;
}
