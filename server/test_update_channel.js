const http = require('http');
const data = JSON.stringify({ name:'Serial Radio 1', type:'serial', enabled:true, options:{ port:'COM3', baud:38400 } });
const opts = { hostname:'localhost', port:3000, path:'/api/channels/radio1', method:'PUT', headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data) } };
const req = http.request(opts, (res) => { let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ console.log('status', res.statusCode); console.log(d); }); });
req.on('error', (e)=>console.error(e));
req.write(data); req.end();
