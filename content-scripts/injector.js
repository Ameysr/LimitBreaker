/**
 * QueuePilot — Prompt Injector
 * Handles the mechanics of injecting text into AI platform input fields.
 * Used by platform adapters as a shared utility.
 */

const PromptInjector = {
  /**
   * Simulate realistic typing into an element
   * Some platforms reject instant text insertion, so we simulate keystrokes.
   */
  async simulateTyping(element, text, delayMs = 10) {
    element.focus();

    for (const char of text) {
      // Dispatch keydown
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char, code: `Key${char.toUpperCase()}`,
        bubbles: true, cancelable: true
      }));

      // Dispatch keypress
      element.dispatchEvent(new KeyboardEvent('keypress', {
        key: char, code: `Key${char.toUpperCase()}`,
        bubbles: true, cancelable: true
      }));

      // Actually insert the character
      if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        element.value += char;
      } else {
        // Contenteditable
        document.execCommand('insertText', false, char);
      }

      // Dispatch input event
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: char
      }));

      // Dispatch keyup
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char, code: `Key${char.toUpperCase()}`,
        bubbles: true, cancelable: true
      }));

      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  },

  /**
   * Fast insert text using clipboard-like approach
   * More reliable for React-based apps
   */
  async fastInsert(element, text) {
    element.focus();
    await new Promise(r => setTimeout(r, 100));

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // For native inputs, use the native value setter to bypass React
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Contenteditable div
      element.innerHTML = '';

      // Split by newlines and create paragraphs
      const lines = text.split('\n');
      for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line || '\u200B'; // Zero-width space for empty lines
        element.appendChild(p);
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 200));
  },

  /**
   * Click a button safely with retry
   */
  async clickButton(button, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      if (!button) return false;
      if (button.disabled) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Try native click
      button.click();

      // Also dispatch pointer events for stubborn UIs
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      return true;
    }
    return false;
  }
};

if (typeof window !== 'undefined') {
  window.PromptInjector = PromptInjector;
}
