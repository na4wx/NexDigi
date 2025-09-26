const http = require('http');
const data = JSON.stringify({ id:'radio1', name:'Serial Radio 1', type:'serial', options:{ port:'COM3', baud:19200 } });
const opts = { hostname:'localhost', port:3000, path:'/api/channels', method:'POST', headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data) } };
const req = http.request(opts, (res) => { let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ console.log('status', res.statusCode); console.log(d); }); });
req.on('error', (e)=>console.error(e));
req.write(data); req.end();
