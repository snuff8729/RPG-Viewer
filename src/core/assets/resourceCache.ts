export interface ResourceLease<T> {
  value: Promise<T>;
  /** Idempotent, including when loading is still in progress. */
  release(): void;
}

interface Entry<T> {
  promise: Promise<T>;
  refs: number;
  bytes: number;
  ready: boolean;
  value?: T;
}

/** Byte-budgeted async LRU. Pending loads are shared; leased values cannot be evicted.
 * The budget is soft only while callers hold leases (or loads are pending).
 * An entry limit also bounds zero-byte results such as missing assets.
 */
export class ResourceCache<T> {
  private entries = new Map<string, Entry<T>>();
  private used = 0;
  private budget: number;
  private sizeOf: (value: T) => number;
  private dispose: (value: T) => void;
  private keep: (value: T) => boolean;
  private limit: number;

  constructor(
    budget: number,
    sizeOf: (value: T) => number,
    dispose: (value: T) => void = () => {},
    keep: (value: T) => boolean = () => true,
    limit = 2048,
  ) {
    this.budget = budget;
    this.sizeOf = sizeOf;
    this.dispose = dispose;
    this.keep = keep;
    this.limit = limit;
  }

  get bytes(): number { return this.used; }
  get size(): number { return this.entries.size; }

  private entry(key: string, load: () => Promise<T>): Entry<T> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const entry: Entry<T> = { promise: undefined!, refs: 0, bytes: 0, ready: false };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.value = value;
      entry.ready = true;
      entry.bytes = Math.max(0, this.sizeOf(value));
      this.used += entry.bytes;
      if (!this.keep(value) && entry.refs === 0) this.remove(key, entry);
      this.trim();
      return value;
    }, error => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry;
  }

  /** For resources that remain usable after eviction (e.g. immutable Blobs). */
  get(key: string, load: () => Promise<T>): Promise<T> {
    return this.entry(key, load).promise;
  }

  acquire(key: string, load: () => Promise<T>): ResourceLease<T> {
    const entry = this.entry(key, load);
    entry.refs++;
    let released = false;
    return { value: entry.promise, release: () => {
      if (released) return;
      released = true;
      entry.refs--;
      if (entry.ready && !this.keep(entry.value!)) this.remove(key, entry);
      this.trim();
    } };
  }

  private remove(key: string, entry: Entry<T>): void {
    if (entry.refs > 0 || !entry.ready || this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.used -= entry.bytes;
    this.dispose(entry.value!);
  }

  private trim(): void {
    for (const [key, entry] of this.entries) {
      if (this.used <= this.budget && this.entries.size <= this.limit) break;
      this.remove(key, entry);
    }
  }
}
