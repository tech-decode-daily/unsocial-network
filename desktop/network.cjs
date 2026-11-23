'use strict';
const https = require('node:https');
const {X509Certificate} = require('node:crypto');
const WebSocket = require('ws');
function endpoint(value, ca='') {
  const url = new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('Enter an HTTPS server origin.');
  if(typeof ca!=='string'||ca.length>5000||(ca&&!new X509Certificate(ca).ca))throw Error('Invalid host certificate.');
  return {origin:url.origin,ca};
}
function encodeInvite(s) {
  return 'unsocial://join/'+Buffer.from(JSON.stringify({v:1,origin:s.origin,ca:s.ca,room:s.Room,key:s.Invite})).toString('base64url');
}
function parseInvite(raw) {
  const prefix='unsocial://join/';
  if(typeof raw!=='string'||raw.length>12000||!raw.trim().startsWith(prefix))throw Error('Paste the complete Unsocial Network invitation.');
  let i;try{i=JSON.parse(Buffer.from(raw.trim().slice(prefix.length),'base64url'));}catch{throw Error('Unreadable invitation.');}
  if(i.v!==1||!/^[a-f0-9]{24}$/.test(i.room)||!/^[a-f0-9]{64}$/.test(i.key))throw Error('Invalid invitation.');
  return {...endpoint(i.origin,i.ca),room:i.room,key:i.key};
}
class RoomConnection {
  constructor(server,token='') {
    Object.assign(this,endpoint(server.origin,server.ca));this.token=token;
    this.agent=new https.Agent({keepAlive:true,maxSockets:12,minVersion:'TLSv1.2',...(this.ca?{ca:this.ca}:{})});
  }
  request(method,route,{json,bytes,headers={},signal,binary=false,max=24<<20,timeout=90000}={}) {
    const data=bytes??(json===undefined?undefined:Buffer.from(JSON.stringify(json)));
    return new Promise((resolve,reject)=>{
      const req=https.request(this.origin+route,{method,agent:this.agent,signal,headers:{
        ...(this.token?{Authorization:'Bearer '+this.token}:{}),...(data?{'Content-Length':data.length,'Content-Type':bytes?'application/octet-stream':'application/json'}:{}),...headers
      }},res=>{
        const parts=[];let count=0;res.on('error',reject);res.on('data',chunk=>{count+=chunk.length;if(count>max)res.destroy(Error('Response exceeded expected size.'));else parts.push(chunk);});
        res.on('end',()=>{const body=Buffer.concat(parts);
          if(res.statusCode<200||res.statusCode>=300){let msg;try{msg=JSON.parse(body).error;}catch{}const e=Error(msg||'Room server returned HTTP '+res.statusCode);e.status=res.statusCode;return reject(e);}
          if(binary)return resolve({data:body,status:res.statusCode,headers:res.headers});
          try{resolve(JSON.parse(body));}catch{reject(Error('Unexpected server response.'));}
        });
      });req.on('error',reject);req.setTimeout(timeout,()=>req.destroy(Error('Server stopped responding. Retry when connected.')));req.end(data);
    });
  }
  socket(route){return new WebSocket(this.origin.replace(/^https:/,'wss:')+route,{agent:this.agent,headers:{Authorization:'Bearer '+this.token},handshakeTimeout:12000,maxPayload:24<<20,perMessageDeflate:false});}
  close(){this.agent.destroy();}
}
module.exports={RoomConnection,encodeInvite,parseInvite,endpoint};

