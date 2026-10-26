export const isManagedNewApiProvider = (provider?: string, managed?: boolean): boolean =>
  managed === true && (provider === 'newapi' || /^newapi-group-[a-f0-9]{40}$/.test(provider ?? ''));
