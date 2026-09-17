let globalStoreInstance = null;

// Allow a developer to link an external global store if they chose to use one
export function setGlobalStore(store) {
  globalStoreInstance = store;
}

export class BlackbirdComponent extends HTMLElement {
  #unsubscribers = []; // Internal register array to capture cleanup tokens safely
  #isMounted = false;  // A strict private guard to track if mounting has already occurred

  // Expose: public state object
  state = {};

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Setup an invisible native browser proxy to intercept data mutations
    this.state = new Proxy({}, {
      set: (target, key, value) => {
        if (target[key] === value) return true; // Short-circuit identity guard
        target[key] = value;

        // If the component is fully mounted on screen, update matched text nodes instantly
        if (this.#isMounted) {
          this._updateDOMTextNode(key, value);
        }
        return true;
      }
    });
  }

  async connectedCallback() {
    // MOUNT GUARD: If this instance has already run its template loading setup, block it instantly.
    if (this.#isMounted) return;

    // Check if the developer provided an external template file path string
    const path = this.constructor.templatePath;

    if (path) {
      try {
        const response = await fetch(path);

        // If the path is broken (404, 500, etc.), do not parse it!
        if (!response.ok) throw new Error(`Status: ${response.status}`);

        const htmlText = await response.text();

        if (htmlText.includes('<html') && htmlText.includes(this.tagName.toLowerCase())) {
          throw new Error(`SPA Fallback detected. Dev server returned index.html instead of template asset.`);
        }

        // Convert the fetched raw text string into browser-executable DOM elements
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        // Append it cleanly inside the isolated Shadow DOM
        this.shadowRoot.innerHTML = doc.documentElement.innerHTML;
        this.#isMounted = true;
      } catch (err) {
        this.#isMounted = false;
        console.error(`[Blackbird] Failed to fetch external template at: ${path}\n`, err);
      }
    }

    // Fall back to <template id="..."> matching rule if no path exists
    if (!this.shadowRoot.innerHTML) {
      const templateId = this.getAttribute('template');

      if (templateId) {
        const template = document.getElementById(templateId);

        if (!template) {
          console.error(`[Blackbird] Template with id "${templateId}" not found.`);
          return;
        }

        const clone = template.content.cloneNode(true);
        this.shadowRoot.appendChild(clone);
        this.#isMounted = true;
      }
    }

    this._hydrateInitialAttributes();
    this._compileDOM();
  }

  async disconnectedCallback() {
    // Teardown active event listeners cleanly to protect runtime memory allocations
    this.#unsubscribers.forEach(unsubscribe => unsubscribe());
    this.#unsubscribers = [];
    this.#isMounted = false;
  }

  _hydrateInitialAttributes() {
    Array.from(this.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) {
        const cleanKey = attr.name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.state[cleanKey] = attr.value; // Hydrates state value directly throw proxy trap keys
      }
    });
  }

  _compileDOM() {
    // Map Text Bindings
    const boundElements = this.shadowRoot.querySelectorAll('[data-bind]');

    boundElements.forEach(element => {
      const bindingExpression = element.getAttribute('data-bind').trim();

      if (bindingExpression.startsWith('global.')) {
        const key = bindingExpression.replace('global.', '');
        if (globalStoreInstance && typeof globalStoreInstance.subscribe === 'function') {
          // Push the returned unsubscribe token to the cleanup tracking list
          const sub = globalStoreInstance.subscribe(key, (val) => {
            element.textContent = val;
          });
          // Check if subscription returns a standard cleanup method function or an unsubscribe object
          if (sub && typeof sub.unsubscribe === 'function') this.#unsubscribers.push(sub.unsubscribe);
          else if (typeof sub === 'function') this.#unsubscribers.push(sub);
        } else {
          console.warn(`[Blackbird] Global Variable "${key}" requested but no global store configured.`);
        }
      } else {
        // Initial text injection from local proxy state values
        if (this.state[bindingExpression] !== undefined) {
          element.textContent = this.state[bindingExpression];
        }
      }
    });

    // Wire up declarative custom clickable event listeners
    // TODO: change attribute name from data-on-click to data-on:[event]
    const actionElements = this.shadowRoot.querySelectorAll('[data-on-click]');
    actionElements.forEach(element => {
      const methodName = element.getAttribute('data-on-click').trim();

      const handler = (e) => {
        if (typeof this[methodName] === 'function') {
          this[methodName](e);
        } else {
          console.error(`[Blackbird] Event action handler method "${methodName}" missing on class`);
        }
      }

      element.addEventListener('click', handler);
      this.#unsubscribers.push(() => element.removeEventListener('click', handler));
    });
  }

  // Fine-grained (surgical) DOM node utility executed whenever a local proxy value alters
  _updateDOMTextNode(key, newValue) {
    const targets = this.shadowRoot.querySelectorAll(`[data-bind="${key}"]`);
    targets.forEach(element => {
      element.textContent = newValue;
    });
  }
}
