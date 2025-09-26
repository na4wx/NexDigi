const http = require('http');
http.get('http://localhost:3000/api/serial-ports', (res) => {
  let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ console.log(d); process.exit(0); });
}).on('error', (e)=>{ console.error(e); process.exit(2); });
