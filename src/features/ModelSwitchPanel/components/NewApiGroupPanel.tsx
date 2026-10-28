import { Button, cssVar, DropdownMenuItem, Flexbox, Icon, SearchBar } from '@lobehub/ui';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { type ComponentProps, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';
import { newApiCatalogActions, useNewApiCatalogStore } from '@/store/newApiCatalog';

import { useModelAndProvider } from '../hooks/useModelAndProvider';
import { useNewApiGroupNavigation } from '../hooks/useNewApiGroupNavigation';
import { styles } from '../styles';
import { List } from './List';

type NewApiGroupPanelProps = Omit<ComponentProps<typeof List>, 'groupMode' | 'searchKeyword'>;

export const NewApiGroupPanel = ({
  enabledList = [],
  model,
  provider,
  onOpenChange,
  ...listProps
}: NewApiGroupPanelProps) => {
  const { t } = useTranslation('components');
  const { provider: currentProvider } = useModelAndProvider(model, provider);
  const legacyGroupName = useAiInfraStore(
    (s) => s.enabledAiProviders?.find((item) => item.id === 'newapi')?.name,
  );
  const {
    back,
    browse,
    currentGroup,
    matchingModels,
    returnToGroup,
    searchKeyword,
    selectedGroup,
    setSearchKeyword,
  } = useNewApiGroupNavigation(enabledList, currentProvider, legacyGroupName);
  const groupSync = newApiCatalogActions.useFetchGroup(selectedGroup?.id);
  const loadedGroup = useNewApiCatalogStore((s) =>
    selectedGroup ? s.groups[selectedGroup.id] : undefined,
  );
  const resolvedGroup = loadedGroup ?? selectedGroup;
  const query = searchKeyword.trim().toLocaleLowerCase();
  const loadedMatches =
    resolvedGroup?.children.filter(
      (m) =>
        !query ||
        m.id.toLocaleLowerCase().includes(query) ||
        m.displayName?.toLocaleLowerCase().includes(query),
    ) ?? matchingModels;
  const groupListRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (selectedGroup) return;
    const groupId = returnToGroup ?? currentGroup?.id;
    const row = Array.from(
      groupListRef.current?.querySelectorAll<HTMLElement>('[data-group-id]') ?? [],
    ).find((item) => item.dataset.groupId === groupId);
    row?.scrollIntoView({ block: 'nearest' });
    if (returnToGroup) row?.focus();
  }, [currentGroup?.id, returnToGroup, selectedGroup]);

  if (!selectedGroup) {
    return (
      <>
        <Flexbox className={styles.toolbar} padding={12} style={{ flexShrink: 0 }}>
          {t('ModelSwitchPanel.newApiSelectGroup')}
        </Flexbox>
        <Flexbox className={styles.list} flex={1} ref={groupListRef} style={{ minHeight: 0 }}>
          {enabledList.length === 0 ? (
            <Flexbox padding={16} role="status" style={{ color: cssVar.colorTextSecondary }}>
              {t('ModelSwitchPanel.newApiNoGroups')}
            </Flexbox>
          ) : (
            enabledList.map((group) => (
              <DropdownMenuItem
                aria-current={group.id === currentGroup?.id ? true : undefined}
                className={styles.menuItem}
                closeOnClick={false}
                data-group-id={group.id}
                key={group.id}
                label={group.name}
                style={{ minHeight: 44 }}
                onClick={() => browse(group.id)}
              >
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{group.name}</span>
                {group.id === currentGroup?.id && <Icon aria-hidden icon={Check} size={16} />}
                <Icon aria-hidden icon={ChevronRight} size={16} />
              </DropdownMenuItem>
            ))
          )}
        </Flexbox>
      </>
    );
  }

  const groupLabel = t('ModelSwitchPanel.newApiGroup', { name: selectedGroup.name });
  return (
    <>
      <Flexbox className={styles.toolbar} style={{ flexShrink: 0 }}>
        <DropdownMenuItem
          aria-label={t('ModelSwitchPanel.newApiBackToGroups')}
          className={styles.menuItem}
          closeOnClick={false}
          label={t('ModelSwitchPanel.newApiBackToGroups')}
          style={{ minHeight: 44 }}
          title={t('ModelSwitchPanel.newApiBackToGroups')}
          onClick={back}
        >
          <Icon aria-hidden icon={ArrowLeft} size={18} />
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{groupLabel}</span>
        </DropdownMenuItem>
        <Flexbox padding={8}>
          <SearchBar
            allowClear
            autoFocus
            aria-label={t('ModelSwitchPanel.searchPlaceholder')}
            placeholder={t('ModelSwitchPanel.searchPlaceholder')}
            size="small"
            styles={{ input: { width: '100%' } }}
            value={searchKeyword}
            variant="borderless"
            onChange={(event) => setSearchKeyword(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') onOpenChange?.(false);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                modelListRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
              }
            }}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} ref={modelListRef} style={{ minHeight: 0 }}>
        {groupSync.error && !loadedGroup ? (
          <Flexbox gap={8} padding={16} role="status">
            {t('ModelSwitchPanel.newApiLoadFailed')}
            <Button
              loading={groupSync.isValidating}
              onClick={() => {
                void groupSync.revalidate();
              }}
            >
              {t('ModelSwitchPanel.newApiRetry')}
            </Button>
          </Flexbox>
        ) : !loadedGroup ? (
          <Flexbox padding={16} role="status">
            {t('ModelSwitchPanel.newApiLoading')}
          </Flexbox>
        ) : loadedMatches.length === 0 ? (
          <Flexbox padding={16} role="status" style={{ color: cssVar.colorTextSecondary }}>
            {t(
              resolvedGroup?.children.length === 0
                ? 'ModelSwitchPanel.newApiNoModels'
                : 'ModelSwitchPanel.newApiNoMatches',
            )}
          </Flexbox>
        ) : (
          <Flexbox flex={1} style={{ minHeight: 0 }}>
            {groupSync.error && (
              <Button
                loading={groupSync.isValidating}
                onClick={() => {
                  void groupSync.revalidate();
                }}
              >
                {t('ModelSwitchPanel.newApiLoadFailed')} {t('ModelSwitchPanel.newApiRetry')}
              </Button>
            )}
            <List
              {...listProps}
              enabledList={[{ ...loadedGroup, children: loadedMatches }]}
              groupMode="byProvider"
              key={selectedGroup.id}
              model={model}
              provider={provider}
              searchKeyword=""
              onOpenChange={onOpenChange}
            />
          </Flexbox>
        )}
      </Flexbox>
    </>
  );
};
