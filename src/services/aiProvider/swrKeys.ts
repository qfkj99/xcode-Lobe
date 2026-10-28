export const newApiSWRKeys = {
  selection: (userId: string, context: string, model: string, provider: string) =>
    ['newApi:selection', userId, context, model, provider] as const,
};
