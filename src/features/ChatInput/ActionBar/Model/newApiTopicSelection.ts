interface ModelSelection {
  model: string;
  provider: string;
}

interface Dependencies {
  activate: (topicId: string) => Promise<void>;
  create: (selection: ModelSelection) => Promise<string>;
  isCurrent: () => boolean;
  onPending: (pending: boolean) => void;
  topicId: string | null;
  update: (topicId: string, selection: ModelSelection) => Promise<void>;
}

// Serialize writes so a slow earlier selection cannot overwrite the latest choice.
export const createNewApiTopicSelection = (dependencies: Dependencies) => {
  let invalidated = false;
  let generation = 0;
  let topicId = dependencies.topicId;
  let revision = 0;
  let pending = Promise.resolve();
  const current = (selectedGeneration: number) =>
    !invalidated && selectedGeneration === generation && dependencies.isCurrent();

  return {
    invalidate: () => {
      invalidated = true;
      generation += 1;
      dependencies.onPending(false);
    },
    resume: () => {
      invalidated = false;
    },
    select: (selection: ModelSelection) => {
      const selectedRevision = ++revision;
      const selectedGeneration = generation;
      dependencies.onPending(true);
      const task = pending
        .catch(() => undefined)
        .then(async () => {
          if (!current(selectedGeneration)) return;
          const resolvedTopicId = topicId ?? (await dependencies.create(selection));
          if (!current(selectedGeneration)) return;
          topicId = resolvedTopicId;
          if (!current(selectedGeneration) || selectedRevision !== revision) return;
          await dependencies.update(topicId, selection);
          if (!current(selectedGeneration) || selectedRevision !== revision || dependencies.topicId)
            return;
          await dependencies.activate(topicId);
        })
        .finally(() => {
          if (selectedRevision === revision) dependencies.onPending(false);
        });
      pending = task;
      return task;
    },
  };
};

export const preserveNewApiComposer = (
  editor: {
    contextSelectionKey?: string;
    getJSONState: () => Record<string, any> | undefined;
    getMarkdownContent: () => string;
  },
  nextKey: string,
  saveDraft: (key: string, document: Record<string, any>) => unknown,
  moveSelections: (from: string, to: string) => unknown,
) => {
  const document = editor.getJSONState();
  if (document && editor.getMarkdownContent().trim()) saveDraft(nextKey, document);
  if (editor.contextSelectionKey) moveSelections(editor.contextSelectionKey, nextKey);
};
