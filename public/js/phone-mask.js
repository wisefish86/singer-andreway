/* Shared, dependency-free phone mask for the Singer Andrey request form. */
(() => {
  'use strict';

  const incompleteMessage = 'Введите номер полностью или оставьте поле пустым.';
  const digitsOnly = value => String(value).replace(/\D/g, '');

  function parsePhone(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { kind: 'empty', digits: '' };
    // International contacts are allowed: don't silently turn +374/+49/etc. into +7.
    if (value.startsWith('+') && !value.startsWith('+7')) {
      return { kind: 'international', digits: digitsOnly(value), value };
    }
    let digits = digitsOnly(value);
    if (value.startsWith('+7')) {
      digits = digits.slice(1);
    } else if (digits.length === 11 && /^[78]/.test(digits)) {
      digits = digits.slice(1);
    } else if (digits.length === 1 && /^[78]$/.test(digits)) {
      // A lone 7 or 8 is the start of a Russian country/trunk prefix.
      digits = '';
    } else if (digits.length > 10) {
      return { kind: 'invalid', digits, value };
    }
    if (digits.length > 10) return { kind: 'invalid', digits, value };
    return { kind: 'russian', digits, value };
  }

  function formatPhone(raw) {
    const parsed = parsePhone(raw);
    if (parsed.kind === 'empty') return '';
    if (parsed.kind !== 'russian') return parsed.value;
    const digits = parsed.digits;
    // Keep the prefix after someone types 7/8; don't insert trailing
    // punctuation after the last digit, so Backspace remains usable.
    if (!digits) return '+7 (';
    let value = '+7 (' + digits.slice(0, 3);
    if (digits.length > 3) value += ') ' + digits.slice(3, 6);
    if (digits.length > 6) value += '-' + digits.slice(6, 8);
    if (digits.length > 8) value += '-' + digits.slice(8, 10);
    return value;
  }

  function isCompletePhone(raw) {
    if (!String(raw ?? '').trim()) return true; // Optional field.
    const parsed = parsePhone(raw);
    if (parsed.kind === 'russian') return parsed.digits.length === 10;
    if (parsed.kind === 'international') return parsed.digits.length >= 7 && parsed.digits.length <= 15;
    return false;
  }

  function positionAfterDigits(formatted, count) {
    if (!formatted) return 0;
    if (count <= 0) return formatted.startsWith('+7 (') ? 4 : 0;
    let seen = 0;
    for (let i = 4; i < formatted.length; i++) {
      if (/\d/.test(formatted[i]) && ++seen === count) return i + 1;
    }
    return formatted.length;
  }

  function setup(input) {
    if (input.dataset.phoneMaskReady === 'true') return;
    input.dataset.phoneMaskReady = 'true';
    input.value = formatPhone(input.value);

    input.addEventListener('input', () => {
      const raw = input.value;
      const parsed = parsePhone(raw);
      const before = parsePhone(raw.slice(0, input.selectionStart ?? raw.length));
      const digitCount = before.kind === 'russian' ? before.digits.length : 0;
      input.value = formatPhone(raw);
      if (parsed.kind === 'russian' && document.activeElement === input) {
        const at = positionAfterDigits(input.value, digitCount);
        input.setSelectionRange(at, at);
      }
      input.setCustomValidity('');
    });

    input.addEventListener('keydown', event => {
      // When only '+7 (' remains, one Backspace must clear the optional field.
      if (event.key === 'Backspace' && input.value === '+7 (' &&
          input.selectionStart === input.selectionEnd && input.selectionStart === input.value.length) {
        input.value = '';
        input.setCustomValidity('');
        event.preventDefault();
      }
    });

    input.addEventListener('blur', () => {
      input.setCustomValidity(isCompletePhone(input.value) ? '' : incompleteMessage);
    });
  }

  function validate(input) {
    input.setCustomValidity(isCompletePhone(input.value) ? '' : incompleteMessage);
    if (!input.checkValidity()) {
      input.reportValidity();
      input.focus();
      return false;
    }
    return true;
  }

  window.SingerPhoneMask = Object.freeze({ formatPhone, isCompletePhone, setup, validate });
})();
