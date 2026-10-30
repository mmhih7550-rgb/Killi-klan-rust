'use strict';

/* Lightweight realtime bus for the clan chat (Server-Sent Events). */

const clients = new Set();

function addClient(res, user) {
  const client = { res, user };
  clients.add(client);
  return () => clients.delete(client);
}

function broadcast(event, data, filter) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (filter && !filter(client)) continue;
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function count() {
  return clients.size;
}

setInterval(() => {
  for (const client of clients) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 25000).unref();

module.exports = { addClient, broadcast, count };
