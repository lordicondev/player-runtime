// The set of Lottie files a tool works on: a directory (every *.json below it; id = path relative
// to it, without .json) or a list file, one `path[<TAB>id]` per line (relative paths resolve
// against the list's directory; id defaults to the path; `#` starts a comment line).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

// [{ id, path }] in a stable order.
export function listInput(input) {
    if (statSync(input).isDirectory()) {
        const walk = (dir) =>
            readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
                e.isDirectory()
                    ? walk(join(dir, e.name))
                    : e.name.endsWith('.json')
                      ? [join(dir, e.name)]
                      : [],
            );
        return walk(input)
            .sort()
            .map((path) => ({ id: relative(input, path).replace(/\.json$/, ''), path }));
    }
    const base = dirname(input);
    return readFileSync(input, 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => {
            const [path, id] = line.split('\t');
            return { id: id || path, path: isAbsolute(path) ? path : join(base, path) };
        });
}

// Deterministic shuffle (the same sample on every run).
export function shuffled(items, seed) {
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    return items
        .map((item) => [rand(), item])
        .sort((a, b) => a[0] - b[0])
        .map(([, item]) => item);
}
