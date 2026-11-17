// The Storage seam: get, set and update over a key-value store. Two adapters:
// chrome.storage.local (production) and an in-memory map (tests).

function makeStore(read, write) {
  const s = {
    async get(key, fallback = null) {
      const v = await read(key);
      return v === undefined ? fallback : v;
    },
    async set(key, value) {
      await write(key, value);
    },
    async update(key, fn, fallback = {}) {
      const cur = await s.get(key, fallback);
      const next = await fn(cur);
      await s.set(key, next);
      return next;
    },
  };
  return s;
}

export const chromeStore = makeStore(
  async (key) => (await chrome.storage.local.get(key))[key],
  (key, value) => chrome.storage.local.set({ [key]: value }),
);

// Values are copied in and out, as Chrome storage does, so a caller never
// changes what's stored by editing what it read.
export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  return makeStore(
    async (key) => structuredClone(data.get(key)),
    async (key, value) => { data.set(key, structuredClone(value)); },
  );
}
