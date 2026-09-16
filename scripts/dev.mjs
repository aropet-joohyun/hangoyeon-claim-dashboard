import http from 'node:http';
import { readFile } from 'node:fs/promises';
import handler from '../api/claims.js';
const server = http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  if (req.url.split('?')[0] === '/api/claims') return handler(req, res);
  if (req.url === '/' || req.url === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('../index.html', import.meta.url)));
  }
  res.statusCode = 404; res.end('Not found');
});
server.listen(4173, '127.0.0.1', () => console.log('Dashboard preview: http://127.0.0.1:4173'));
