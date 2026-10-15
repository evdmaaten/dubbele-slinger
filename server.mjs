import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.csv':'text/csv; charset=utf-8', '.md':'text/plain; charset=utf-8' };
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root) || pathname.includes('/.') || !['.html','.js','.css','.json','.csv','.md'].includes(path.extname(file))) { res.writeHead(403); res.end('Niet beschikbaar'); return; }
    const data = await readFile(file);
    res.writeHead(200, {'Content-Type':mime[path.extname(file)], 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});res.end(data);
  } catch {res.writeHead(404);res.end('Niet gevonden');}
});
server.listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log(`Dubbele slinger: http://127.0.0.1:${server.address().port}`));
