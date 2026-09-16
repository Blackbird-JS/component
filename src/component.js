import { BlackbirdStore } from '@blackbirdjs/store';

let globalStoreInstance = null;

export function setGlobalStore(store) {
  globalStoreInstance = store;
}

export class BlackbirdComponent extends HTMLElement {
  // Add an internal register array to capture cleanup tokens safely
  #unsubscribers = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.localStore = new BlackbirdStore({});
  }

  static get observedAttributes() {
    return [];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    const cleanKey = name.replace(/^data-/, '').replace(/-([a-z])/g, g => g.toUpperCase());
    this.localStore.set(cleanKey, newValue);
  }

  connectedCallback() {
    const templateId = this.getAttribute('template');
    const template = document.getElementById(templateId);

    if (!template) {
      console.error(`[Blackbird] Template with id "${templateId}" not found.`);
      return;
    }

    // Changed contentEditable to template.content
    const clone = template.content.cloneNode(true);
    this.shadowRoot.appendChild(clone);

    this._hydrateInitialAttributes();
    this._compileDOM();
  }

  // Automatically clean up memory when the component leaves the screen
  disconnectedCallback() {
    this.#unsubscribers.forEach(unsubscribe => unsubscribe());
    this.#unsubscribers = [];
  }

  _hydrateInitialAttributes() {
    Array.from(this.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) {
        // FIX 3: Fixed broken regex format from /-(a-z)/g to /-([a-z])/g
        const cleanKey = attr.name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.localStore.set(cleanKey, attr.value);
      }
    });
  }

  _compileDOM() {
    // Map Text Bindings
    // Changed querySelector to querySelectorAll so .forEach runs successfully
    const boundElements = this.shadowRoot.querySelectorAll('[data-bind]');

    boundElements.forEach(element => {
      const bindingExpression = element.getAttribute('data-bind').trim();

      if (bindingExpression.startsWith('global.')) {
        const key = bindingExpression.replace('global.', '');
        if (globalStoreInstance) {
          // Push the returned unsubscribe token to the cleanup tracking list
          const sub = globalStoreInstance.subscribe(key, (val) => {
            element.textContent = val;
          });
          this.#unsubscribers.push(sub.unsubscribe);
        } else {
          console.warn(`[Blackbird] Global Variable "${key}" requested but no global store configured.`);
        }
      } else {
        // Capture local store unsubscriptions as well
        const sub = this.localStore.subscribe(bindingExpression, (val) => {
          element.textContent = val;
        });
        this.#unsubscribers.push(sub.unsubscribe);
      }
    });

    // Map Event Triggers
    const actionElements = this.shadowRoot.querySelectorAll('[data-on-click]');
    actionElements.forEach(element => {
      const methodName = element.getAttribute('data-on-click').trim();

      element.addEventListener('click', (e) => {
        if (typeof this[methodName] === 'function') {
          this[methodName](e);
        } else {
          console.error(`[Blackbird] Event action handler method "${methodName}" missing on class`);
        }
      });
    });
  }
}
