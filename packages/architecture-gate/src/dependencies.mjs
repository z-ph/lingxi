export const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/**
 * Flatten every dependency section of a package.json.
 *
 * @param {any} packageJson
 * @returns {{section: string, name: string, version: string}[]}
 */
export function dependencyEntries(packageJson) {
  const entries = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const value = packageJson?.[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, version] of Object.entries(value)) {
        entries.push({ section, name, version });
      }
    }
  }
  return entries;
}

export function declaredDependencyNames(packageJson) {
  return new Set(dependencyEntries(packageJson).map((entry) => entry.name));
}
