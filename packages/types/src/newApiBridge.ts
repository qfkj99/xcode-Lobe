import type { AiProviderModelListItem } from 'model-bank';

export interface NewApiGroupCatalog {
  models: AiProviderModelListItem[];
  name: string;
  provider: string;
}

export interface NewApiSelection {
  model: string;
  provider: string;
}

export interface NewApiSelectionResolution extends NewApiSelection {
  vision?: boolean;
  changed: boolean;
  groupName: string;
}
