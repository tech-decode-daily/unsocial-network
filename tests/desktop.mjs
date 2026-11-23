import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const exe=process.env.UNSOCIAL_TEST_EXECUTABLE||require('electron');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'unsocial-ui-')),screens=path.resolve('artifacts');
await fs.mkdir(screens,{recursive:true});
const apps=[],errors=[];
async function launch(name){
 const profile=path.join(tmp,name);const args=process.env.UNSOCIAL_TEST_EXECUTABLE?[]:[path.resolve('.')];
 const env={...process.env,UNSOCIAL_PROFILE:profile,UNSOCIAL_ADVERTISE:'127.0.0.1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:exe,args:[...args,'--user-data-dir='+profile],env,timeout:45000});apps.push(app);
 const w=await app.firstWindow();w.setDefaultTimeout(20000);w.on('pageerror',e=>errors.push(e.message));
 await w.getByRole('heading',{name:'Room directory'}).waitFor();return {app,w};
}
try{
 const h=await launch('host'),g=await launch('guest');
 await h.w.screenshot({path:path.join(screens,'directory.png')});
 await h.w.getByRole('button',{name:'Create room'}).click();await h.w.getByLabel('Room name').fill('Night shift');await h.w.getByLabel('Your display name').fill('Ada');
 await h.w.locator('#submit').click();await h.w.locator('#status').getByText('Connected',{exact:true}).waitFor();
 await h.app.evaluate(({clipboard})=>{clipboard.writeText=v=>{globalThis.testInvitation=v;};});await h.w.locator('#copy').click();const invite=await h.app.evaluate(()=>globalThis.testInvitation);assert.ok(invite.startsWith('unsocial://'));
 await g.w.getByRole('button',{name:'Join room'}).click();await g.w.getByLabel('Room invitation').fill(invite);await g.w.getByLabel('Your display name').fill('Lin');await g.w.locator('#submit').click();await g.w.locator('#status').getByText('Connected',{exact:true}).waitFor();
 await h.w.locator('#members').getByText('Lin',{exact:true}).waitFor();
 await h.w.getByLabel('Message the room').fill('Can you check the transfer?');await h.w.locator('#chat-form button').click();
 await g.w.locator('#messages').getByText('Can you check the transfer?').waitFor();
 const source=path.join(tmp,'protocol-note.txt'),out=path.join(tmp,'received');await fs.mkdir(out);await fs.writeFile(source,'Two independent desktops verified these bytes.\n');
 await h.app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
 await g.app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},out);
 await g.w.locator('[data-nav=settings]').click();await g.w.locator('#folder').click();await g.w.locator('[data-nav=rooms]').click();
 await h.w.locator('#pick').click();await g.w.locator('#files button').first().click();
 await g.w.locator('#room-jobs').getByText('Show in folder').waitFor();assert.equal(await fs.readFile(path.join(out,'protocol-note.txt'),'utf8'),await fs.readFile(source,'utf8'));
 await g.w.screenshot({path:path.join(screens,'room.png')});
 await g.w.locator('#leave').click();await g.w.locator('#submit').click();await g.w.getByRole('heading',{name:'Room directory'}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: two desktop processes, LAN invitation, presence, delivered chat, verified file, leave and directory. No renderer exceptions.');
}finally{
 for(const app of apps.reverse())await app.close().catch(()=>{});
 await fs.rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}

