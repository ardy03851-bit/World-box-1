import { clamp, round, vibrate } from '../core/util.js';
import { app } from '../app.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function clear(node) {
  while (node?.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function fmt(n, p = 2) {
  if (!isFinite(n)) return '0';
  const r = round(n, p);
  return Number.isInteger(r) ? String(r) : r.toFixed(p);
}

export function haptic(ms = 8) {
  if (app.settings?.haptics) vibrate(ms);
}

// ── layout ───────────────────────────────────────────────────
export function section(title, children, { collapsed = false, actions = null, id = '' } = {}) {
  const head = el('button', { class: 'section-head' },
    el('span', {}, title),
    icon('chevrond')
  );
  const body = el('div', { class: 'section-body' }, children);
  const sec = el('section', { class: `section${collapsed ? ' collapsed' : ''}`, dataset: id ? { section: id } : {} }, head, body);
  head.addEventListener('click', () => {
    sec.classList.toggle('collapsed');
    haptic(5);
  });
  if (actions) {
    head.append(actions);
  }
  return sec;
}

export function card(...children) {
  return el('div', { class: 'card' }, ...children);
}

export function row(label, control, { hint = null } = {}) {
  const labelNode = typeof label === 'string' ? el('span', { class: 'label' }, label) : label;
  const wrap = el('div', { class: 'row' }, labelNode, control ?? '');
  if (hint) wrap.append(el('span', { class: 'hint' }, hint));
  return wrap;
}

export function hint(text) {
  return el('p', { class: 'hint', html: text });
}

export function divider() {
  return el('div', { class: 'divider' });
}

// ── controls ─────────────────────────────────────────────────
export function button(label, { iconName = null, onClick = null, variant = '', small = false, title = '' } = {}) {
  const btn = el('button', { class: `pill-btn ${variant} ${small ? 'small' : ''}`, title, type: 'button' },
    iconName ? icon(iconName) : null,
    label ? el('span', {}, label) : null
  );
  if (onClick) btn.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
  return btn;
}

export function iconButton(name, onClick, { title = '', cls = 'icon-btn' } = {}) {
  const btn = el('button', { class: cls, type: 'button', title, 'aria-label': title || name }, icon(name));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export function toggle(checked, onChange, { label = null } = {}) {
  const sw = el('button', {
    class: `switch${checked ? ' on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
  });
  sw.addEventListener('click', () => {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', String(next));
    haptic(6);
    onChange(next);
  });
  if (!label) return sw;
  return el('div', { class: 'row' }, el('span', { class: 'label' }, label), sw);
}

export function slider({ label, value = 0, min = 0, max = 1, step = 0.01, unit = '', precision = 2, format = null, onInput = null, onChange = null } = {}) {
  const val = el('span', { class: 'val' }, format ? format(value) : `${fmt(value, precision)}${unit}`);
  const input = el('input', { type: 'range', min, max, step, value });
  const setFill = () => {
    const pct = ((Number(input.value) - Number(min)) / (Number(max) - Number(min) || 1)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  setFill();
  const wrap = el('div', { class: 'slider' },
    el('div', { class: 'slider-top' }, el('span', { class: 'label' }, label), val),
    input
  );
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = format ? format(v) : `${fmt(v, precision)}${unit}`;
    setFill();
    onInput?.(v, input);
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    onChange?.(v, input);
    haptic(3);
  });
  wrap.setValue = (v, fire = false) => {
    input.value = v;
    val.textContent = format ? format(Number(v)) : `${fmt(Number(v), precision)}${unit}`;
    setFill();
    if (fire) onInput?.(Number(v), input);
  };
  return wrap;
}

export function scrubField({ axis = 'x', value = 0, step = 0.05, precision = 2, label = '', onChange = null, onCommit = null } = {}) {
  const input = el('input', { type: 'text', inputmode: 'decimal', value: fmt(value, precision), 'aria-label': label || axis });
  const wrap = el('div', { class: `scrub ${axis}` }, axis ? el('span', { class: 'axis' }, axis) : null, input);
  let dragging = false;
  let startX = 0;
  let startVal = 0;
  let moved = false;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === input && document.activeElement === input) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startVal = parseFloat(input.value) || 0;
    wrap.setPointerCapture(e.pointerId);
    input.blur();
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    const next = startVal + dx * step * mult;
    input.value = fmt(next, precision);
    onChange?.(Number(next));
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (moved) onCommit?.(parseFloat(input.value) || 0);
    else if (document.activeElement !== input) {
      input.focus();
      input.select();
    }
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value) || 0;
    onChange?.(v);
    onCommit?.(v);
  });
  input.addEventListener('blur', () => {
    const v = parseFloat(input.value) || 0;
    input.value = fmt(v, precision);
    onCommit?.(v);
  });
  wrap.setValue = (v) => { input.value = fmt(v, precision); };
  return wrap;
}

export function segmented({ options = [], value, onChange = null, small = false, full = false } = {}) {
  const wrap = el('div', { class: `seg${small ? ' small' : ''}${full ? ' full' : ''}` });
  for (const opt of options) {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const btn = el('button', { type: 'button', class: val === value ? 'active' : '' }, label);
    btn.addEventListener('click', () => {
      [...wrap.children].forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      haptic(4);
      onChange?.(val);
    });
    wrap.append(btn);
  }
  wrap.setValue = (v) => {
    [...wrap.children].forEach((c, i) => {
      const opt = options[i];
      const val = typeof opt === 'string' ? opt : opt.value;
      c.classList.toggle('active', val === v);
    });
  };
  return wrap;
}

export function chips({ options = [], value = null, onChange = null, small = false, multi = false } = {}) {
  const selected = new Set(multi ? (Array.isArray(value) ? value : []) : [value]);
  const wrap = el('div', { class: `chips${small ? ' small' : ''}` });
  for (const opt of options) {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const color = opt?.color;
    const chip = el('button', {
      type: 'button',
      class: `chip${selected.has(val) ? ' active' : ''}`,
    }, color ? el('i', { class: 'dot', style: { background: color } }) : null, label);
    chip.addEventListener('click', () => {
      if (multi) {
        selected.has(val) ? selected.delete(val) : selected.add(val);
        chip.classList.toggle('active', selected.has(val));
        onChange?.([...selected]);
      } else {
        selected.clear();
        selected.add(val);
        [...wrap.children].forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        onChange?.(val);
      }
      haptic(4);
    });
    wrap.append(chip);
  }
  wrap.setValue = (v) => {
    selected.clear();
    if (multi && Array.isArray(v)) v.forEach((x) => selected.add(x));
    else selected.add(v);
    [...wrap.children].forEach((c, i) => {
      const opt = options[i];
      const val = typeof opt === 'string' ? opt : opt.value;
      c.classList.toggle('active', selected.has(val));
    });
  };
  return wrap;
}

export function colorField({ value = '#ffffff', onChange = null } = {}) {
  const input = el('input', { type: 'color', value });
  const hex = el('span', { class: 'hex' }, String(value).toUpperCase());
  const wrap = el('div', { class: 'color-field' }, input, hex);
  input.addEventListener('input', () => {
    hex.textContent = input.value.toUpperCase();
    onChange?.(input.value);
  });
  wrap.setValue = (v) => {
    input.value = v;
    hex.textContent = String(v).toUpperCase();
  };
  return wrap;
}

export function selectField({ options = [], value, onChange = null } = {}) {
  const select = el('select');
  for (const opt of options) {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const o = el('option', { value: val }, label);
    if (val === value) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', () => onChange?.(select.value));
  return select;
}

export function textField({ value = '', placeholder = '', onCommit = null } = {}) {
  const input = el('input', { class: 'text-input', type: 'text', value, placeholder });
  const commit = () => onCommit?.(input.value.trim());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', commit);
  return input;
}

export function textureSlot({ slot, label, asset = null, onClear = null, onPick = null, onDropped = null }) {
  const thumb = asset?.thumb ? el('img', { src: asset.thumb, alt: '' }) : el('div', { class: 'slot-icon' }, icon('image'));
  const slotEl = el('div', {
    class: `drop-slot${asset ? '' : ' empty'}`,
    'data-tex-slot': slot,
    role: 'button',
    tabindex: '0',
  },
    thumb,
    el('div', { class: 'slot-meta' },
      el('span', { class: 'slot-name' }, asset ? asset.name : `Drop ${label.toLowerCase()} map`),
      el('span', { class: 'slot-sub' }, asset ? 'Texture' : 'Empty')
    ),
    asset ? el('button', { class: 'slot-x', title: 'Remove', type: 'button', onpointerdown: (e) => e.stopPropagation() }, icon('close')) : el('span', { class: 'slot-x' }, icon('plus'))
  );
  slotEl.addEventListener('click', async (e) => {
    if (e.target.closest('.slot-x') && asset) {
      e.stopPropagation();
      onClear?.();
      return;
    }
    onPick?.(slot);
  });
  slotEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(slot); }
  });
  slotEl._onDropped = onDropped;
  return slotEl;
}

// ── overlays ─────────────────────────────────────────────────
let toastCount = 0;
export function toast(text, type = 'success') {
  const wrap = $('#toasts');
  if (!wrap) return;
  while (wrap.children.length >= 3) wrap.firstElementChild.remove();
  const iconName = type === 'err' ? 'warning' : type === 'warn' ? 'warning' : 'check';
  const node = el('div', { class: `toast ${type}` }, icon(iconName), el('span', {}, text));
  wrap.append(node);
  toastCount++;
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }, type === 'err' ? 4200 : 2800);
  toastCount = Math.max(0, toastCount - 1);
}

export function showBusy(title = 'Working…', note = '') {
  const b = $('#busy');
  $('#busyTitle').textContent = title;
  $('#busyNote').textContent = note;
  $('#busyBar').style.width = '0%';
  b.classList.remove('hidden');
}
export function updateBusy(note, value = null) {
  if (note !== undefined) $('#busyNote').textContent = note;
  if (value !== null) $('#busyBar').style.width = `${clamp(value, 0, 1) * 100}%`;
}
export function hideBusy() {
  $('#busy').classList.add('hidden');
}

export function openSheet(name) {
  closeSheets();
  const sheet = typeof name === 'string' ? document.getElementById(name) : name;
  if (!sheet) return;
  sheet.classList.remove('hidden');
  $('#sheetBackdrop').classList.remove('hidden');
}
export function closeSheets() {
  ['librarySheet', 'gallerySheet'].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
  $('#sheetBackdrop')?.classList.add('hidden');
}

export function openModal(id) {
  closeModals();
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hidden');
}
export function closeModals() {
  $$('.modal').forEach((m) => m.classList.add('hidden'));
}

export function confirmDialog(text, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const modal = $('#confirmSheet');
    $('#confirmText').textContent = text;
    const actions = modal.querySelector('.modal-actions');
    actions.innerHTML = '';
    const finish = (val) => {
      modal.classList.add('hidden');
      resolve(val);
    };
    actions.append(
      button('Cancel', { onClick: () => finish(false) }),
      button(confirmLabel, { variant: 'danger', onClick: () => finish(true) })
    );
    modal.querySelectorAll('[data-close-menu]').forEach((b) => { b.onclick = () => finish(false); });
    openModal('confirmSheet');
  });
}

export function emptyState(title, body, iconName = 'cube', action = null) {
  return el('div', { class: 'empty-state' },
    el('div', { class: 'orb' }),
    el('h3', {}, title),
    el('p', {}, body),
    action
  );
}

export function setPanelVisible(which, visible) {
  const node = which === 'left' ? $('#leftPanel') : $('#inspector');
  if (!node) return;
  node.classList.toggle('hidden', !visible);
}
