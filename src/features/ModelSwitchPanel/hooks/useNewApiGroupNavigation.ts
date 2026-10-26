import { useEffect, useState } from 'react';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

export const useNewApiGroupNavigation = (
  groups: EnabledProviderWithModels[],
  currentProvider: string,
  legacyGroupName?: string,
) => {
  const [navigation, setNavigation] = useState<{
    provider?: string;
    returnTo?: string;
    search: string;
  }>({ search: '' });
  const currentGroup = groups.find(
    (group) =>
      group.id === currentProvider ||
      (currentProvider === 'newapi' && group.name === legacyGroupName),
  );
  const selectedGroup = groups.find((group) => group.id === navigation.provider);

  useEffect(() => {
    if (navigation.provider && !selectedGroup) setNavigation({ search: '' });
  }, [navigation.provider, selectedGroup]);

  const keyword = navigation.search.trim().toLocaleLowerCase();
  const matchingModels = selectedGroup?.children.filter(
    (model) =>
      !keyword ||
      model.id.toLocaleLowerCase().includes(keyword) ||
      model.displayName?.toLocaleLowerCase().includes(keyword),
  );

  // Group navigation never commits the topic's model/provider selection.
  return {
    back: () => setNavigation((state) => ({ returnTo: state.provider, search: '' })),
    browse: (provider: string) => {
      if (groups.some((group) => group.id === provider)) setNavigation({ provider, search: '' });
    },
    currentGroup,
    matchingModels: matchingModels ?? [],
    returnToGroup: navigation.returnTo,
    searchKeyword: navigation.search,
    selectedGroup,
    setSearchKeyword: (search: string) => setNavigation((state) => ({ ...state, search })),
  };
};
