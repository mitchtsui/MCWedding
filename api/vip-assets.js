'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {verifyHubSession}=require('../lib/hub-auth.cjs');
function createHandler({env=process.env,root=path.resolve(__dirname,'..')}={}){
  return async (req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.setHeader('Allow','GET');res.statusCode=405;res.end();return;}
    try{
      if(!verifyHubSession(req,{env}).authenticated){res.statusCode=401;res.end('Wedding party sign-in required');return;}
    }catch{res.statusCode=503;res.end('Family guide unavailable');return;}
    const asset=new URL(req.url,'https://hub.invalid').searchParams.get('asset');
    if(asset!=='data'&&!/^[a-zA-Z0-9_-]+\.jpg$/.test(asset||'')){res.statusCode=404;res.end();return;}
    try{
      if(asset==='data'){
        const data=JSON.parse(await fs.readFile(path.join(root,'hub-private/vip-data.json'),'utf8'));
        const people=data.people.map(({id,name,relationship,family})=>({id,name,relationship,family,photo:'/api/vip-assets.js?asset='+encodeURIComponent(id+'.jpg')}));
        const rows=data.rows.map(({family,ids,breakBefore})=>({family,ids,breakBefore:Boolean(breakBefore)}));
        res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({people,rows}));
      }else{
        const bytes=await fs.readFile(path.join(root,'photos/vip',asset));
        res.setHeader('Content-Type','image/jpeg');res.end(bytes);
      }
    }catch{res.statusCode=404;res.end('Family guide unavailable');}
  };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
