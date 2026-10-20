// Signature of a Lottie layer: sorted words for what it is made of (shape items, modifiers,
// matte, mask, effects, per-dimension easing...), with its matte source's and parents' words
// marked (matte) / (parent). Equal signatures cluster differences with the same cause.
// assets: precomps by id, to look into a precomp used as a matte.
export function signature(layer, layers, assets = new Map(), from = '') {
    const words = new Set();
    const visit = (items, depth) => {
        let groups = 0;
        for (const it of items ?? []) {
            if (it.hd) continue;
            if (it.ty === 'gr') {
                groups++;
                visit(it.it, depth + 1);
            } else if (it.ty === 'tm') {
                words.add(it.m === 2 ? 'trim-individual' : 'trim');
                if (it.m === 2 && groups >= 2) words.add('trim-over-groups');
            } else if (it.ty === 'mm') words.add(`merge-paths:${it.mm}`);
            else if (it.ty === 'st' && it.d) words.add('dash');
            else if (['fl', 'gf'].includes(it.ty) && depth === 0 && groups >= 2)
                words.add('fill-over-groups');
            else if (['rp', 'rd', 'zz', 'op', 'pb', 'tw', 'sr', 'gf', 'gs'].includes(it.ty))
                words.add(it.ty);
            if (['fl', 'st', 'gf', 'gs'].includes(it.ty) && it.bm) words.add('blend-shape');
            if (it.ty === 'st' && it.w?.a) words.add('animated-stroke');
        }
    };
    visit(layer.shapes, 0);
    const json = JSON.stringify(layer);
    if (/"i":\{"x":\[[^\]]*,/.test(json)) {
        // keyframes whose easing differs per dimension
        const m = json.match(/"[io]":\{"x":\[([^\]]+)\],"y":\[([^\]]+)\]/g) ?? [];
        if (
            m.some((s) => {
                const [x, y] = s
                    .match(/\[([^\]]+)\]/g)
                    .map((a) => a.slice(1, -1).split(',').map(Number));
                return (x.length > 1 && x[1] !== x[0]) || (y.length > 1 && y[1] !== y[0]);
            })
        )
            words.add('ease-per-dimension');
    }
    if (layer.tt && !from) {
        words.add(['', 'matte-alpha', 'matte-alpha-inv', 'matte-luma', 'matte-luma-inv'][layer.tt]);
        const i = layers.indexOf(layer);
        const src = layer.tp != null ? layers.find((l) => l.ind === layer.tp) : layers[i - 1];
        if (src?.ty === 0) {
            words.add('matte-from-precomp');
            // What the precomp is made of: the cause is often inside it.
            for (const inner of assets.get(src.refId)?.layers ?? [])
                for (const w of signature(
                    inner,
                    assets.get(src.refId).layers,
                    assets,
                    'matte',
                ).split(' '))
                    if (w) words.add(w);
        }
        // What the matte source is made of matters as much (e.g. its own animation).
        if (src)
            for (const w of signature(src, layers, assets, 'matte').split(' ')) if (w) words.add(w);
    }
    if (!from) {
        let p = layer.parent;
        const seen = new Set();
        while (p != null && !seen.has(p)) {
            seen.add(p);
            const parent = layers.find((l) => l.ind === p);
            if (!parent) break;
            const sig = signature({ ks: parent.ks }, layers, assets, 'parent');
            if (sig) for (const w of sig.split(' ')) words.add(w);
            p = parent.parent;
        }
    }
    if (layer.hasMask || layer.masksProperties?.length) {
        words.add('mask');
        for (const m of layer.masksProperties ?? []) words.add(`mask-mode:${m.mode}`);
    }
    if (layer.bm) words.add('blend-layer');
    if (layer.ddd) words.add('3d');
    if (layer.ty === 0) words.add('precomp');
    if (layer.ty === 1) words.add('solid');
    if (layer.ty === 2) words.add('image');
    if (layer.ty === 5) words.add('text');
    if (layer.tm) words.add('time-remap');
    if (layer.sr && layer.sr !== 1) words.add('time-stretch');
    for (const ef of layer.ef ?? [])
        if (!/Control$/.test(ef.mn ?? '') && !ef.mn?.startsWith('Pseudo/'))
            words.add(`effect:${(ef.mn ?? '?').replace(/^ADBE /, '').replace(/\s+/g, '-')}`);
    return [...words]
        .map((w) => (from ? `${w}(${from})` : w))
        .sort()
        .join(' ');
}
