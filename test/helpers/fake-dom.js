"use strict";

// Minimal DOM good enough to boot the content script and the options page:
// compound selectors built from an optional tag, `#id`, `.class`, `[attr]` and
// `[attr="value"]`, plus comma lists. Descendant combinators and substring
// attribute operators (`*=`) match nothing, which is the safe answer for the
// parser's optional-signal queries.

const COMPOUND_TOKEN_RE =
  /^(?:#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\])/;

function parseSelector(selector) {
  return String(selector || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCompound(selector) {
  let rest = selector;
  const compound = { tag: "", tests: [] };
  const tag = /^[a-z][a-z\d]*/i.exec(rest);

  if (tag) {
    compound.tag = tag[0].toUpperCase();
    rest = rest.slice(tag[0].length);
  }

  while (rest) {
    const token = COMPOUND_TOKEN_RE.exec(rest);

    if (!token) {
      return null;
    }

    if (token[1] !== undefined) {
      compound.tests.push((element) => element.id === token[1]);
    } else if (token[2] !== undefined) {
      compound.tests.push((element) => element.classList.contains(token[2]));
    } else {
      const name = token[3];
      const expected = token[4] ?? token[5] ?? token[6];
      compound.tests.push((element) => {
        const actual = attributeValue(element, name);
        return expected === undefined ? actual !== null : actual === expected;
      });
    }

    rest = rest.slice(token[0].length);
  }

  return compound.tag || compound.tests.length ? compound : null;
}

function dataKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function attributeValue(element, name) {
  if (element.attributes.has(name)) {
    return element.attributes.get(name);
  }

  if (name.startsWith("data-")) {
    const value = element.dataset[dataKey(name)];
    return value === undefined ? null : String(value);
  }

  if (["id", "name", "type", "value"].includes(name)) {
    const value = element[name];
    return value === undefined || value === "" ? null : String(value);
  }

  return null;
}

function matchesSimple(element, selector) {
  const compound = parseCompound(selector);

  if (!compound) {
    return false;
  }

  if (compound.tag && element.tagName !== compound.tag) {
    return false;
  }

  return compound.tests.every((check) => check(element));
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

  // Form-control values are always strings in the browser (a number written
  // to `input.value` reads back as text).
  get value() {
    return this._value;
  }

  set value(next) {
    this._value = String(next ?? "");
  }

  set innerHTML(value) {
    if (String(value ?? "") !== "") {
      throw new Error("FakeElement only supports clearing innerHTML");
    }

    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    this._text = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  matches(selector) {
    return parseSelector(selector).some((part) => matchesSimple(this, part));
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

// FormData over a fake <form>: named, enabled controls only; checkboxes and
// radios contribute only when checked, as in the browser.
class FakeFormData {
  constructor(form) {
    this.entries = [];

    for (const control of form?.descendants?.() || []) {
      if (!control.name || control.disabled) {
        continue;
      }

      if (!["INPUT", "SELECT", "TEXTAREA"].includes(control.tagName)) {
        continue;
      }

      if ((control.type === "checkbox" || control.type === "radio") && !control.checked) {
        continue;
      }

      const value =
        control.type === "checkbox" || control.type === "radio"
          ? control.value || "on"
          : control.value ?? "";
      this.entries.push([control.name, String(value)]);
    }
  }

  get(name) {
    const entry = this.entries.find(([key]) => key === name);
    return entry ? entry[1] : null;
  }
}

const VOID_TAGS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);
const TAG_RE = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][a-z\d]*)\s*>|<([a-z][a-z\d]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/gi;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function decodeEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function applyAttribute(element, name, value) {
  const lower = name.toLowerCase();
  element.setAttribute(lower, value);

  if (lower === "id") {
    element.id = value;
  } else if (lower === "class") {
    element.className = value;
  } else if (lower.startsWith("data-")) {
    element.dataset[dataKey(lower)] = value;
  } else if (["checked", "disabled", "selected"].includes(lower)) {
    element[lower] = true;
  } else if (["name", "type", "value"].includes(lower)) {
    element[lower] = value;
  }
}

function prepareControl(element) {
  if (element.tagName === "INPUT") {
    element.type = element.type || "text";
    element.value = element.value ?? "";
    element.checked = Boolean(element.checked);
    element.disabled = Boolean(element.disabled);
  } else if (element.tagName === "BUTTON") {
    element.type = element.type || "submit";
    element.disabled = Boolean(element.disabled);
  } else if (element.tagName === "SELECT") {
    const options = element.descendants().filter((node) => node.tagName === "OPTION");
    const selected = options.find((option) => option.selected) || options[0];
    element.value = selected ? selected.value ?? selected.textContent : "";
    element.disabled = Boolean(element.disabled);
  } else if (element.tagName === "OPTION") {
    element.value = element.value ?? element.textContent;
  }
}

// Builds well-formed markup (such as the real options.html <body>) into a
// fake element tree, so tests exercise the shipped page structure instead of a
// hand-copied imitation of it. Script elements are skipped.
function appendHtml(parent, html) {
  const document = parent.ownerDocument;
  const stack = [{ element: parent, text: "" }];
  let lastIndex = 0;
  let skipping = 0;

  const flushText = (until) => {
    const textValue = html.slice(lastIndex, until);

    if (!skipping) {
      stack[stack.length - 1].text += textValue;
    }
  };

  for (const match of html.matchAll(TAG_RE)) {
    flushText(match.index);
    lastIndex = match.index + match[0].length;

    if (match[0].startsWith("<!")) {
      continue;
    }

    if (match[1]) {
      const closing = match[1].toLowerCase();

      if (closing === "script") {
        skipping = Math.max(0, skipping - 1);
        continue;
      }

      if (skipping) {
        continue;
      }

      const frame = stack.pop();

      if (!frame || frame.element.tagName !== closing.toUpperCase()) {
        throw new Error(`Unbalanced </${closing}> in fake HTML`);
      }

      if (!frame.element.children.length) {
        frame.element._text = decodeEntities(frame.text.replace(/\s+/g, " ").trim());
      }

      prepareControl(frame.element);
      continue;
    }

    const tagName = match[2].toLowerCase();

    if (tagName === "script") {
      skipping += 1;
      continue;
    }

    if (skipping) {
      continue;
    }

    const element = document.createElement(tagName);

    for (const attribute of (match[3] || "").matchAll(ATTR_RE)) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      applyAttribute(element, attribute[1], decodeEntities(value));
    }

    stack[stack.length - 1].element.append(element);

    if (VOID_TAGS.has(tagName) || match[0].endsWith("/>")) {
      prepareControl(element);
    } else {
      stack.push({ element, text: "" });
    }
  }

  if (stack.length !== 1) {
    throw new Error(`Unclosed <${stack[stack.length - 1].element.tagName}> in fake HTML`);
  }
}

module.exports = {
  FakeDocument,
  FakeElement,
  FakeFormData,
  appendHtml,
  createClock,
  settle
};
