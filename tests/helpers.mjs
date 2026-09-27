// Minimal chrome.* fake for loading background.js under node:test.
export function createChromeFake({ sync: syncInit = {}, local: localInit = {}, session: sessionInit = {} } = {}) {
  const local = new Map(Object.entries(localInit));
  const session = new Map(Object.entries(sessionInit));
  const sync = new Map(Object.entries(syncInit));
  const listeners = { message: null, alarm: null };
  const alarms = new Map();
  const read = (map, keys) => {
    const list = keys == null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, structuredClone(map.get(k))]));
  };
  const area = (map, hooks = {}) => ({
    get: (keys, callback) => {
      const result = read(map, keys);
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    set: async (values, callback) => {
      if (hooks.beforeSet) await hooks.beforeSet(values);
      Object.entries(values).forEach(([k, v]) => map.set(k, structuredClone(v)));
      callback?.();
    },
    remove: async (keys, callback) => {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => map.delete(k));
      callback?.();
    }
  });
  const hooks = {};
  const chrome = {
    storage: {
      local: area(local, hooks),
      session: { ...area(session), setAccessLevel: async () => {} },
      sync: area(sync),
      onChanged: { addListener() {} }
    },
    runtime: {
      id: "test-extension-id",
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onInstalled: { addListener() {} },
      openOptionsPage() {},
      getManifest: () => ({ version: "test" })
    },
    alarms: {
      create: (name, info) => alarms.set(name, info),
      get: (name, callback) => callback(alarms.get(name) || null),
      clear: (name, callback) => { alarms.delete(name); callback?.(true); },
      onAlarm: { addListener: (fn) => { listeners.alarm = fn; } }
    },
    commands: { onCommand: { addListener() {} } }
  };
  return { chrome, local, session, sync, listeners, alarms, hooks };
}

export const TRUSTED_PAGE = { id: "test-extension-id", url: "chrome-extension://test-extension-id/options.html" };

export function send(listeners, message, sender = TRUSTED_PAGE) {
  return new Promise((resolve) => {
    const keepOpen = listeners.message(message, sender, resolve);
    if (keepOpen !== true) setTimeout(() => resolve(undefined), 20);
  });
}

export async function loadBackground(fake, tag) {
  globalThis.chrome = fake.chrome;
  await import(`../background.js?${tag}-${Date.now()}-${Math.random()}`);
  // Let startup promises (migration, poll-health load) settle.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}
