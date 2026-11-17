const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'solutions.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
  fs.readFile(file, (error, data) => {if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream'}).end(data);});
}).listen(4178, '127.0.0.1');
