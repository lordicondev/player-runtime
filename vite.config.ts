import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

const dist = resolve(import.meta.dirname, 'dist');

/** Copies the wasm next to the built code, where `new URL('./lordicon.wasm', import.meta.url)` finds it. */
function copyWasm(): Plugin {
    return {
        name: 'copy-wasm',
        apply: 'build',
        async writeBundle() {
            await mkdir(dist, { recursive: true });
            await copyFile(
                resolve(import.meta.dirname, 'src/wasm/lordicon.wasm'),
                resolve(dist, 'lordicon.wasm'),
            );
        },
    };
}

/**
 * `@vite-ignore` keeps this build from touching `new URL('./lordicon.wasm', import.meta.url)`,
 * but left in dist it would keep the consumer's Vite from emitting the file too: it goes.
 */
function consumersSeeWasm(): Plugin {
    return {
        name: 'consumers-see-wasm',
        apply: 'build',
        renderChunk(code) {
            const marked = /\/\*\s*@vite-ignore\s*\*\/\s*("\.\/lordicon\.wasm")/g;
            if (!marked.test(code)) throw new Error('no ./lordicon.wasm URL in the bundle');
            return code.replace(marked, '$1');
        },
    };
}

/**
 * The npm package: ESM with the emscripten glue bundled in and the .wasm next to it. Library
 * mode would inline the .wasm as base64, so the source points at `./lordicon.wasm`, which only
 * exists in dist: this build leaves the URL as written and consumers' bundlers emit the file.
 */
export default defineConfig({
    plugins: [
        dts({
            include: ['src'],
            exclude: ['src/**/*.test.ts', 'src/testing/**'],
            beforeWriteFile: (filePath, content) => ({
                filePath: filePath.replace('/dist/src/', '/dist/'),
                content,
            }),
        }),
        copyWasm(),
        consumersSeeWasm(),
    ],
    build: {
        target: 'es2022',
        outDir: dist,
        lib: {
            formats: ['es'],
            entry: resolve(import.meta.dirname, 'src', 'index.ts'),
            fileName: () => 'index.js',
        },
    },
});
