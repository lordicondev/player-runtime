import { canvasFor, Clock, loadIcon } from './shared.ts';

const clock = new Clock();
const icon = await loadIcon('wired-outline-489-rocket-space-hover-flying');
const canvas = canvasFor(icon, 192);
document.getElementById('stage')!.append(canvas);
clock.add(icon, canvas);
icon.playback({ loop: true });
icon.play();

const controls = document.getElementById('controls')!;
for (const [name, value] of Object.entries(icon.colors)) {
    const input = Object.assign(document.createElement('input'), { type: 'color', value });
    input.addEventListener('input', () => icon.setColor(name, input.value));
    const label = document.createElement('label');
    label.append(`${name} `, input);
    controls.append(label);
}

const stroke = document.createElement('select');
stroke.append(new Option('light', '1'), new Option('regular', '2'), new Option('bold', '3'));
stroke.value = String(icon.stroke);
stroke.addEventListener('change', () => icon.setStroke(+stroke.value as 1 | 2 | 3));
controls.append(stroke);

// The whole icon in one colour; unticked, its own colours again.
const tint = Object.assign(document.createElement('input'), { type: 'color', value: '#3e63dd' });
const tinted = Object.assign(document.createElement('input'), { type: 'checkbox' });
const applyTint = () => icon.setTint(tinted.checked ? tint.value : null);
tint.addEventListener('input', applyTint);
tinted.addEventListener('change', applyTint);
const label = document.createElement('label');
label.append(tinted, ' tint ', tint);
controls.append(label);
