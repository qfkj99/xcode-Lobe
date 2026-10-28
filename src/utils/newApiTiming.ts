export const markNewApiComposer = (ready: boolean) => {
  if (typeof window === 'undefined') return;
  let entry: string | null;
  try {
    entry = sessionStorage.getItem('newapi:entryStarted');
  } catch {
    return;
  }
  if (!entry) return;
  const stage = ready ? 'ready' : 'composer';
  try {
    if (sessionStorage.getItem(`newapi:${stage}Entry`) === entry) return;
    sessionStorage.setItem(`newapi:${stage}Entry`, entry);
  } catch {
    return;
  }
  try {
    performance.measure(`newapi:${stage}`, {
      start: 0,
      end: performance.now(),
      detail: {
        entryToStageMs: Math.max(0, performance.timeOrigin + performance.now() - Number(entry)),
      },
    });
  } catch {
    // Optional diagnostics must never prevent a chat from opening.
  }
};
