/**
 * The app allowlist. It is empty by default: until the device owner adds a
 * package, no app can be driven or observed through the daemon.
 */
export interface AppAllowlistStore {
  load(): readonly string[];
  save(packages: readonly string[]): void;
}

/** Default in-memory store. A real Android app persists the list in app-private storage. */
export class MemoryAppAllowlistStore implements AppAllowlistStore {
  #packages: readonly string[] = [];

  load(): readonly string[] {
    return [...this.#packages];
  }

  save(packages: readonly string[]): void {
    this.#packages = [...packages];
  }
}

const PACKAGE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const MAX_PACKAGE_LENGTH = 255;

/** Validate and canonicalise an Android application id. */
export function normalizeAppPackage(value: string): string {
  const packageName = value.trim();
  if (packageName.length === 0) {
    throw new TypeError("app package name must not be empty");
  }
  if (packageName.length > MAX_PACKAGE_LENGTH) {
    throw new TypeError(`app package name is longer than ${MAX_PACKAGE_LENGTH} characters`);
  }
  if (!PACKAGE_NAME.test(packageName)) {
    throw new TypeError(`invalid Android app package name: ${JSON.stringify(value)}`);
  }
  return packageName;
}

export function isAppPackageName(value: string): boolean {
  try {
    normalizeAppPackage(value);
    return true;
  } catch {
    return false;
  }
}

export class AppAllowlist {
  readonly #store: AppAllowlistStore;
  readonly #packages = new Set<string>();

  constructor(store: AppAllowlistStore = new MemoryAppAllowlistStore()) {
    this.#store = store;
    for (const packageName of store.load()) {
      this.#packages.add(normalizeAppPackage(packageName));
    }
  }

  /** Sorted, immutable snapshot for display on the device. */
  list(): readonly string[] {
    return [...this.#packages].sort();
  }

  isAllowed(packageName: string): boolean {
    const normalized = packageName.trim();
    return this.#packages.has(normalized);
  }

  /** Device-side admin action. It is not exposed as an MCP tool. */
  add(packageName: string): void {
    const normalized = normalizeAppPackage(packageName);
    if (this.#packages.has(normalized)) {
      return;
    }
    this.#packages.add(normalized);
    this.#store.save(this.list());
  }

  /** Device-side admin action. Returns whether the package was present. */
  remove(packageName: string): boolean {
    const removed = this.#packages.delete(packageName.trim());
    if (removed) {
      this.#store.save(this.list());
    }
    return removed;
  }

  /** Device-side admin action: back to the safe default-empty state. */
  clear(): void {
    this.#packages.clear();
    this.#store.save([]);
  }
}
