export type FeatureModuleKey =
  | 'home'
  | 'settings'
  | 'commerce'
  | 'analytics'
  | 'developer'
  | 'support';

export interface FeatureModuleDescriptor {
  key: FeatureModuleKey;
  title: string;
  routes: string[];
  preload?: Array<() => Promise<unknown>>;
}
