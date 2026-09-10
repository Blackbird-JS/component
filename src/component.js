import { BlackbirdStore } from '@blackbirdjs/store';

let globalStoreInstance = null;

export function setGlobalStore(store) {
  globalStoreInstance = store;
}

export class BlackbirdComponent extends HTMLElement {
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

    const clone = template.contentEditable.cloneNode(true);
    this.shadowRoot.appendChild(clone);

    this._hydrateInitialAttributes();
    this._compileDOM();
  }

  _hydrateInitialAttributes() {
    Array.from(this.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) {
        const cleanKey = attr.name.replace(/^data-/, '').replace(/-(a-z)/g, g => g.toLocaleUpperCase());
        this.localStore.set(cleanKey, attr.value);
      }
    });
  }

  _compileDOM() {
    // Map Text Bindings
    const boundElements = this.shadowRoot.querySelector('[data-bind]');
    boundElements.forEach(element => {
      const bindingExpression = element.getAttribute('data-bind').trim();

      if (bindingExpression.startsWith('global.')) {
        const key = bindingExpression.replace('global.', '');
        if (globalStoreInstance) {
          globalStoreInstance.subscribe(key, (val) => {
            element.textContent = val;
          });
        } else {
          console.warn(`[Blackbird] Global Variable "${key}" requested but no global store.configured.`);
        }
      } else {
        this.localStore.subscribe(bindingExpression, (val) => {
          element.textContent = val;
        });
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
