export class TextureCache<K, V> {
  private readonly values = new Map<K, V>();

  constructor(private readonly factory: (key: K) => V) {}

  get(key: K): V {
    const existing = this.values.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = this.factory(key);
    this.values.set(key, created);
    return created;
  }

  get size(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }
}
