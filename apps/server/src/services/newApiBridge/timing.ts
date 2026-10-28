export const startBridgeTiming = () => {
  let last = performance.now();
  const stages: Record<string, number> = {};
  return {
    mark: (stage: string) => {
      const now = performance.now();
      stages[stage] = Math.round((now - last) * 10) / 10;
      last = now;
    },
    finish: () => {
      // Stage durations only: never record tickets, cookies, users or models.
      console.info('[newApiBridge:timing]', stages);
      return stages;
    },
  };
};
