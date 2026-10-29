import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/js/phone-mask.js', import.meta.url), 'utf8');
const window = {};
const document = { activeElement: null };
runInNewContext(source, { window, document });
const mask = window.SingerPhoneMask;
assert.ok(mask, 'Phone mask must be available on the page');

const samples = [
  ['9181234567', '+7 (918) 123-45-67'],
  ['89181234567', '+7 (918) 123-45-67'],
  ['79181234567', '+7 (918) 123-45-67'],
  ['+7 918 123 45 67', '+7 (918) 123-45-67'],
  ['+7 (918) 123-45-67', '+7 (918) 123-45-67'],
  ['918', '+7 (918'],
  ['8', '+7 ('],
  ['7', '+7 ('],
  ['', ''],
  ['+49 171 1234567', '+49 171 1234567'],
];
for (const [raw, expected] of samples) {
  assert.equal(mask.formatPhone(raw), expected, 'Phone formatting: ' + raw);
}
for (const phone of ['', '+7 (918) 123-45-67', '+49 171 1234567']) {
  assert.equal(mask.isCompletePhone(phone), true, phone + ' should be valid');
}
for (const phone of ['8', '918123', '+7 (918) 123', '+49 17', '123456789012']) {
  assert.equal(mask.isCompletePhone(phone), false, phone + ' should be incomplete/invalid');
}

function fakeInput() {
  const listeners = {};
  const input = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    dataset: {},
    reportWasCalled: false,
    addEventListener(name, fn) { listeners[name] = fn; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setCustomValidity(message) { this.validationMessage = message; },
    checkValidity() { return !this.validationMessage; },
    reportValidity() { this.reportWasCalled = true; },
    focus() { document.activeElement = this; },
    edit(raw, caret = raw.length) {
      this.value = raw;
      this.selectionStart = this.selectionEnd = caret;
      listeners.input();
    },
    trigger: listeners,
  };
  return input;
}

const input = fakeInput();
mask.setup(input);
input.focus();
input.edit('8');
assert.equal(input.value, '+7 (', '8 should start the Russian prefix');
input.edit('+7 (9');
assert.equal(input.value, '+7 (9');
assert.equal(input.selectionStart, input.value.length, 'Caret stays after inserted digit');
input.edit('89181234567');
assert.equal(input.value, '+7 (918) 123-45-67', 'Pasting a full 8-prefixed number');
input.edit('+7 (918) 123');
assert.equal(mask.validate(input), false, 'Incomplete optional phone must block submission');
assert.equal(input.reportWasCalled, true);
input.edit('');
assert.equal(mask.validate(input), true, 'Blank optional phone must be accepted');
input.edit('8');
let prevented = false;
input.trigger.keydown({key:'Backspace', preventDefault(){prevented = true;}});
assert.equal(input.value, '');
assert.equal(prevented, true, 'Deleting the optional prefix should clear the field');
input.edit('+49 171 1234567');
assert.equal(mask.validate(input), true, 'International phone must remain usable');

const dist = new URL('../../dist/', import.meta.url).pathname;
assert.ok(existsSync(dist+'js/phone-mask.js'), 'Phone mask asset missing from built site');
const html = readFileSync(dist+'podborka/index.html', 'utf8');
assert.ok(html.includes('src="/js/phone-mask.js"'), 'Phone mask must load on repertoire page');
assert.ok(html.includes('inputmode="tel"') && html.includes('placeholder="+7 (999) 123-45-67"'));
console.log('Phone mask tests passed: input, paste, 8/+7 prefixes, backspace, optional and international numbers');
