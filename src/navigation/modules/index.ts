import { analyticsFeatureModule } from './analyticsModule';
import { developerFeatureModule } from './developerModule';
import { homeFeatureModule } from './homeModule';
import { settingsFeatureModule } from './settingsModule';
import type { FeatureModuleDescriptor } from './types';

export const featureModules: FeatureModuleDescriptor[] = [
  homeFeatureModule,
  settingsFeatureModule,
  analyticsFeatureModule,
  developerFeatureModule,
];

export function getFeatureModuleRoutes() {
  return featureModules.flatMap((m) => m.routes);
}

export function getFeatureModulePreloads() {
  return featureModules.flatMap((m) => m.preload ?? []);
}
