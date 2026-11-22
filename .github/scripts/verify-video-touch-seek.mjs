import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/js/media-gallery.js', import.meta.url), 'utf8');
const start = source.indexOf('  function addMobileSeekControls(');
const end = source.indexOf('  function renderVideo(){', start);
assert.ok(start > -1 && end > start, 'Touch seek function must exist');
let now = 1000;
let id = 0;
const scheduled = new Map();
const controls = [];
const stage = { append(node) { controls.push(node); } };
const player = {
  duration: 250, currentTime: 40, isConnected: true, paused: true,
  addEventListener() {}, play() { throw new Error('Seeking should not auto-play a paused video'); }
};
const sandbox = {
  window: { matchMedia: () => ({ matches: true }) },
  Date: { now: () => now },
  setTimeout(fn) { const timer = ++id; scheduled.set(timer, fn); return timer; },
  clearTimeout(timer) { scheduled.delete(timer); },
  Number, Math,
  elt(_tag, className) {
    return { className, type: '', attributes: {}, handlers: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, cb) { this.handlers[name] = cb; }
    };
  },
  stage, player
};
runInNewContext(source.slice(start,end)+'\naddMobileSeekControls(stage,player);', sandbox);
assert.equal(controls.length, 2);
const [back, forward] = controls;
forward.handlers.click();
assert.equal(player.currentTime, 40, 'No immediate seek on first tap');
now += 100;
forward.handlers.click();
now += 100;
forward.handlers.click();
assert.equal(scheduled.size, 1, 'Three taps must become exactly one seek');
for (const fn of [...scheduled.values()]) fn();
scheduled.clear();
assert.equal(player.currentTime, 70, 'Three forward taps must seek a combined 30 seconds');
now += 700;
back.handlers.click();
for (const fn of [...scheduled.values()]) fn();
scheduled.clear();
assert.equal(player.currentTime, 60);
player.currentTime=245;
now += 700;
forward.handlers.click();
for (const fn of [...scheduled.values()]) fn();
scheduled.clear();
assert.ok(player.currentTime < player.duration, 'Skip forward must clamp to the end');
sandbox.window.matchMedia = () => ({ matches: false });
const desktop=[];
runInNewContext(source.slice(start,end)+'\naddMobileSeekControls(stage,player);', {
  ...sandbox, stage: {append(node){desktop.push(node);}}
});
assert.equal(desktop.length,0,'Desktop must retain only native controls');
console.log('Video touch seek: taps coalesced, duration clamped, no unintended autoplay, desktop unchanged.');
