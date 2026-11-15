// Минимальный клиент протокола отладки Chrome (CDP) на встроенном WebSocket Node 22+. Копия tigris-bot/tools/cdp.js (15.11): съемка справки не зависит от архива.

export async function browserWsUrl(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!r.ok) throw new Error('CDP не отвечает: ' + r.status);
  return (await r.json()).webSocketDebuggerUrl;
}

/** Подключение к браузеру: send(method, params, sessionId) и подписка на события. */
export async function connect(port) {
  const ws = new WebSocket(await browserWsUrl(port));
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('не удалось подключиться к Chrome по CDP'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  let closed = null;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
      return;
    }
    for (const f of listeners) f(m);
  };
  ws.onclose = () => {
    for (const { rej } of pending.values()) rej(new Error('соединение с Chrome закрыто'));
    pending.clear();
    if (closed) closed();
  };
  return {
    send(method, params = {}, sessionId) {
      return new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
      });
    },
    on(f) { listeners.push(f); },
    onClose(f) { closed = f; },
    close() { ws.close(); },
  };
}
