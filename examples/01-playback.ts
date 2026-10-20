import type { Icon } from '../src/index.ts';
import { canvasFor, Clock, loadIcon } from './shared.ts';

const ICONS = [
    'lock',
    'coins',
    'trash',
    'puzzle',
    'morph-select',
    'wired-outline-489-rocket-space-hover-flying',
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clock = new Clock();
let icon: Icon | null = null;

async function open(name: string) {
    clock.items.clear();
    icon?.destroy();
    icon = await loadIcon(name);
    const canvas = canvasFor(icon, 192);
    $('stage').replaceChildren(canvas);
    clock.add(icon, canvas, () => ($('play').textContent = 'Play'));
    $<HTMLSelectElement>('state').replaceChildren(
        new Option('whole file', '*'),
        ...icon.markers.map((m) => new Option(m.name.replace(/^default:/, ''), m.name)),
    );
    const fallback = icon.markers.find((m) => m.name.startsWith('default:'));
    if (fallback) $<HTMLSelectElement>('state').value = fallback.name;
    select();
}

/** Loads the selected state and rests on its first frame in the play direction. */
function select() {
    if (!icon) return;
    const name = $<HTMLSelectElement>('state').value;
    const marker = icon.markers.find((m) => m.name === name);
    const [begin, end] = marker
        ? [marker.begin, marker.end]
        : [icon.firstFrame, icon.firstFrame + icon.totalFrames - 1];
    const direction = $<HTMLInputElement>('reverse').checked ? -1 : 1;
    icon.playback({
        speed: +$<HTMLInputElement>('speed').value,
        direction,
        loop: $<HTMLInputElement>('loop').checked,
    });
    icon.segment(begin, end);
    $('stats').textContent = `frames ${begin}–${end}`;
}

$<HTMLSelectElement>('icon').replaceChildren(...ICONS.map((n) => new Option(n, n)));
$('icon').addEventListener('change', () => open($<HTMLSelectElement>('icon').value));
$('state').addEventListener('change', select);
$('reverse').addEventListener('change', select);
for (const id of ['loop', 'speed']) {
    $(id).addEventListener('input', () =>
        icon?.playback({
            speed: +$<HTMLInputElement>('speed').value,
            direction: $<HTMLInputElement>('reverse').checked ? -1 : 1,
            loop: $<HTMLInputElement>('loop').checked,
        }),
    );
}
$('play').addEventListener('click', () => {
    if (!icon) return;
    if (icon.playing) {
        icon.pause();
        $('play').textContent = 'Play';
    } else {
        if (!icon.playing && $('play').textContent === 'Play' && atEnd(icon)) select();
        icon.play();
        $('play').textContent = 'Pause';
    }
});

/** True when the last run finished: playing again starts over. */
function atEnd(icon: Icon): boolean {
    const name = $<HTMLSelectElement>('state').value;
    const marker = icon.markers.find((m) => m.name === name);
    const end = marker ? marker.end : icon.firstFrame + icon.totalFrames - 1;
    const begin = marker ? marker.begin : icon.firstFrame;
    return $<HTMLInputElement>('reverse').checked ? icon.frame <= begin : icon.frame >= end;
}

await open(ICONS[0]);
