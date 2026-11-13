const target = new EventTarget();

export function emit(type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, fn) {
  const handler = (e) => fn(e.detail, e);
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

export function once(type, fn) {
  const off = on(type, (d, e) => {
    off();
    fn(d, e);
  });
  return off;
}
