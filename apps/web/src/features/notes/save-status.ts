type NoteSaveState = {
  status: string;
  dirty: boolean;
  ready: boolean;
  online: boolean;
  busy: boolean;
  pending: boolean;
  conflict: boolean;
  recovery: boolean;
  error: string;
};

export function noteSaveStatus(state: NoteSaveState): string {
  if (!state.online) return "Offline · draft kept on this device";
  if (state.dirty && state.status === "Saved") return "Unsaved changes";
  // Undo, Redo, or deleting freshly typed text can cancel an edit before the
  // debounce fires. Equality alone is insufficient when a request may still
  // commit a different snapshot or reconciliation/error handling is pending.
  if (
    state.status === "Unsaved changes" &&
    !state.dirty &&
    state.ready &&
    !state.busy &&
    !state.pending &&
    !state.conflict &&
    !state.recovery &&
    !state.error
  )
    return "Saved";
  return state.status;
}
