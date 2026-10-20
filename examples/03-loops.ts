import { Events } from '../src/index.ts';
import { canvasFor, loadIcon } from './shared.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = await loadIcon('download');
const cycle = icon.markers.find((m) => m.name === 'loop-cycle')!;
icon.segment(cycle.begin, cycle.end);

const canvas = canvasFor(icon, 192);
$('stage').append(canvas);
const context = canvas.getContext('2d')!;
icon.draw(context);

const lines: string[] = [];
const log = (line: string) => {
    lines.unshift(`${(performance.now() / 1000).toFixed(2)} s  ${line}`);
    $('log').textContent = lines.slice(0, 12).join('\n');
};

// The caller's clock: tick, draw when there is a new frame, read the events.
let last = 0;
function frame(now: number) {
    const events = icon.tick(last ? (now - last) / 1000 : 0);
    last = now;
    if (events & Events.frame) icon.draw(context);
    if (events & Events.loop) log('loop: a round ended, the next starts after the rest');
    if (events & Events.complete) log('complete: the segment played to its end');
    if (icon.playing) requestAnimationFrame(frame);
    else last = 0;
}

const loop = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
const rest = document.createElement('select');
rest.append(
    new Option('no rest', '0'),
    new Option('rest 0.5 s', '0.5'),
    new Option('rest 1 s', '1'),
);
rest.value = '0.5';
const apply = () => icon.playback({ loop: loop.checked, rest: +rest.value });
loop.addEventListener('change', apply);
rest.addEventListener('change', apply);

const play = Object.assign(document.createElement('button'), { textContent: 'Play' });
play.addEventListener('click', () => {
    if (icon.playing) return;
    if (icon.frame >= cycle.end) icon.seek(cycle.begin);
    apply();
    icon.play();
    log('play');
    requestAnimationFrame(frame);
});
const pause = Object.assign(document.createElement('button'), { textContent: 'Pause' });
pause.addEventListener('click', () => {
    icon.pause();
    log('pause: a rest waits too');
});

const label = document.createElement('label');
label.append(loop, ' loop');
$('controls').append(label, rest, play, pause);
