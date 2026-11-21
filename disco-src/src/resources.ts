import type { ResourceSpec } from "./types";

export interface ResourceError {
  slot: string;
  path: string;
  message: string;
}

export interface LoadedResources<T> {
  assets: Map<string, T>;
  errors: ResourceError[];
}

export async function loadResourceManifest<T>(
  resources: Record<string, ResourceSpec>,
  loader: (path: string) => Promise<T>,
): Promise<LoadedResources<T>> {
  const assets = new Map<string, T>();
  const errors: ResourceError[] = [];
  const entries = Object.entries(resources).filter(
    ([, spec]) => spec && spec.visible !== false && Boolean(spec.path),
  );
  await Promise.all(
    entries.map(async ([slot, spec]) => {
      try {
        assets.set(slot, await loader(spec.path));
      } catch (error) {
        errors.push({
          slot,
          path: spec.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  errors.sort((a, b) => a.slot.localeCompare(b.slot));
  return { assets, errors };
}
