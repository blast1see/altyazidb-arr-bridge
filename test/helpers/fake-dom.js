"use strict";

// Minimal DOM good enough to boot the content script: simple `#id`, `.class`,
// and tag selectors plus comma lists. Anything more complex matches nothing,
// which is the safe answer for the parser's optional-signal queries.

function parseSelector(selector) {
  return String(selector || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesSimple(element, selector) {
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }

  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  if (/^[a-z][a-z\d]*$/i.test(selector)) {
    return element.tagName === selector.toUpperCase();
  }

  return false;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.id = "";
    this.tabIndex = 0;
    this.focused = false;
    this._className = "";
    this._text = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value ?? "");
  }

  get classList() {
    const owner = this;

    return {
      contains(name) {
        return owner._className.split(/\s+/).filter(Boolean).includes(name);
      }
    };
  }

  get isConnected() {
    let node = this;

    while (node.parentElement) {
      node = node.parentElement;
    }

    return node === this.ownerDocument.documentElement;
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join("")
      : this._text;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement?.remove?.call(node);
      node.parentElement = this;
      this.children.push(node);
    }

    this.ownerDocument.notifyMutation();
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    const parent = this.parentElement;

    if (!parent) {
      return;
    }

    parent.children = parent.children.filter((child) => child !== this);
    this.parentElement = null;
    this.ownerDocument.notifyMutation();
  }

  insertAdjacentElement(position, node) {
    const parent = this.parentElement;

    if (!parent) {
      return node;
    }

    const index = parent.children.indexOf(this);
    parent.children.splice(position === "afterend" ? index + 1 : index, 0, node);
    node.parentElement = parent;
    this.ownerDocument.notifyMutation();
    return node;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }

    this.listeners.get(type).push(handler);
  }

  focus() {
    this.focused = true;
  }

  descendants() {
    const found = [];

    for (const child of this.children) {
      found.push(child, ...child.descendants());
    }

    return found;
  }

  querySelectorAll(selector) {
    this.ownerDocument.recordQuery(selector);
    const parts = parseSelector(selector);
    return this.descendants().filter((node) =>
      parts.some((part) => matchesSimple(node, part))
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    const parts = parseSelector(selector);
    let node = this;

    while (node) {
      if (parts.some((part) => matchesSimple(node, part))) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }
}

class FakeDocument {
  constructor() {
    this.title = "";
    this.readyState = "complete";
    this.queries = [];
    this.observers = [];
    this.listeners = new Map();
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.append(this.body);
  }

  recordQuery(selector) {
    this.queries.push(String(selector));
  }

  notifyMutation() {
    // Observers are triggered explicitly by tests so that render scheduling
    // stays deterministic.
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }

    this.listeners.get(type).push(handler);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  getElementById(id) {
    return this.documentElement.descendants().find((node) => node.id === id) || null;
  }
}

function createClock() {
  const tasks = new Map();
  let nextId = 1;
  let now = 0;

  return {
    get pending() {
      return tasks.size;
    },
    setTimeout(handler, delay = 0) {
      const id = nextId++;
      tasks.set(id, { handler, at: now + Number(delay) || now });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    async advance(ms) {
      const target = now + ms;

      for (let guard = 0; guard < 100000; guard += 1) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];

        if (!due) {
          break;
        }

        tasks.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].handler();
        await settle();
      }

      now = target;
    }
  };
}

async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

module.exports = { FakeDocument, FakeElement, createClock, settle };
