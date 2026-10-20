// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneTemplate, el, icon, renderList, setAttrs } from '../../src/ui/render.js';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('el', () => {
  it('sets class, text, attributes, dataset, style, listeners and properties', () => {
    const onClick = vi.fn();
    const button = el('button', {
      class: 'button primary',
      text: 'Start',
      attrs: { 'aria-pressed': 'true', disabled: false, 'data-x': 1, autofocus: true },
      dataset: { id: 't1' },
      style: { '--depth': '2' },
      on: { click: onClick },
      type: 'button',
    });
    expect(button.className).toBe('button primary');
    expect(button.textContent).toBe('Start');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('data-x')).toBe('1');
    expect(button.getAttribute('autofocus')).toBe('');
    expect(button.dataset.id).toBe('t1');
    expect(button.style.getPropertyValue('--depth')).toBe('2');
    expect(button.type).toBe('button');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('appends children, turns strings into text and skips empty values', () => {
    const list = el('ul', {}, el('li', { text: 'a' }), null, false, undefined, 'b');
    expect(list.childNodes).toHaveLength(2);
    expect(list.textContent).toBe('ab');
  });

  it('never parses strings as HTML', () => {
    const p = el('p', {}, '<img src=x onerror=alert(1)>');
    expect(p.children).toHaveLength(0);
    expect(p.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('setAttrs', () => {
  it('removes attributes for false and null', () => {
    const div = el('div', { attrs: { hidden: true, title: 'x' } });
    setAttrs(div, { hidden: false, title: null });
    expect(div.hasAttribute('hidden')).toBe(false);
    expect(div.hasAttribute('title')).toBe(false);
  });
});

describe('cloneTemplate', () => {
  it('clones content and collects refs, by id or element', () => {
    const template = document.createElement('template');
    template.id = 'row';
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.dataset.ref = 'name';
    li.append(name);
    template.content.append(li);
    document.body.append(template);

    const first = cloneTemplate('row');
    const second = cloneTemplate(template);
    expect(first.refs.name).toBeInstanceOf(HTMLElement);
    expect(first.refs.name).not.toBe(second.refs.name);
    expect(first.fragment.firstElementChild?.tagName).toBe('LI');
    expect(template.content.querySelectorAll('span')).toHaveLength(1);
  });

  it('throws for a missing template', () => {
    expect(() => cloneTemplate('nope')).toThrow(/template/);
  });
});

describe('icon', () => {
  it('is decorative without a label and points <use> at the icon file', () => {
    const svg = icon('folder');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('icon');
    expect(svg.querySelector('use')?.getAttribute('href')).toMatch(/\/ui\/icons\/folder\.svg#i$/);
  });

  it('is a named image with a label', () => {
    const svg = icon('star', { label: 'Starred', class: 'star' });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Starred');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(svg.getAttribute('class')).toBe('icon star');
  });
});

describe('renderList', () => {
  /** @param {{id: string, name: string}} item */
  const create = (item) => el('li', { dataset: { id: item.id }, text: item.name });
  /** @param {HTMLLIElement} node @param {{id: string, name: string}} item */
  const update = (node, item) => {
    node.textContent = item.name;
  };
  const texts = (/** @type {Element} */ ul) => [...ul.children].map((li) => li.textContent);

  it('creates nodes in order', () => {
    const ul = el('ul');
    renderList(
      ul,
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      (i) => i.id,
      create,
    );
    expect(texts(ul)).toEqual(['A', 'B']);
  });

  it('reuses nodes by key, updates them, reorders, adds and removes', () => {
    const ul = el('ul');
    const createSpy = vi.fn(create);
    const updateSpy = vi.fn(update);
    const [a, b] = renderList(
      ul,
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      (i) => i.id,
      createSpy,
      updateSpy,
    );
    const nodes = renderList(
      ul,
      [
        { id: 'b', name: 'B2' },
        { id: 'd', name: 'D' },
        { id: 'a', name: 'A' },
      ],
      (i) => i.id,
      createSpy,
      updateSpy,
    );
    expect(texts(ul)).toEqual(['B2', 'D', 'A']);
    expect(nodes[0]).toBe(b);
    expect(nodes[2]).toBe(a);
    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(ul.querySelector('[data-id="c"]')).toBeNull();
  });

  it('keeps focus on a reused node when the list reorders', () => {
    const ul = el('ul');
    document.body.append(ul);
    const make = (/** @type {{id: string}} */ i) => el('li', { tabIndex: 0, text: i.id });
    const [first] = renderList(ul, [{ id: 'a' }, { id: 'b' }], (i) => i.id, make);
    first.focus();
    renderList(ul, [{ id: 'b' }, { id: 'a' }], (i) => i.id, make);
    // Only the other node moves, so the focused one stays in the document throughout.
    expect(document.activeElement).toBe(first);
  });

  it('empties the container for an empty list', () => {
    const ul = el('ul');
    renderList(ul, [{ id: 'a', name: 'A' }], (i) => i.id, create);
    renderList(ul, [], (i) => i.id, create);
    expect(ul.children).toHaveLength(0);
  });

  it('throws on duplicate keys', () => {
    expect(() =>
      renderList(
        el('ul'),
        [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'A' },
        ],
        (i) => i.id,
        create,
      ),
    ).toThrow(/duplicate key a/);
  });

  it('keeps separate state per container', () => {
    const one = el('ul');
    const two = el('ul');
    renderList(one, [{ id: 'a', name: 'A' }], (i) => i.id, create);
    renderList(two, [{ id: 'a', name: 'A' }], (i) => i.id, create);
    expect(one.firstElementChild).not.toBe(two.firstElementChild);
  });
});
