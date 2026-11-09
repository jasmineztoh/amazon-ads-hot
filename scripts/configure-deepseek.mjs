import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

// One local-only session. Credentials never appear in URLs, logs or shell arguments.
const folder=path.resolve(import.meta.dirname,'../.local');
await mkdir(folder,{recursive:true});
const token=randomBytes(24).toString('hex');
let saved=false, saving=false;
const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const page=(message,form=false,status=200)=>{
    res.writeHead(status,{...headers,'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek 密钥设置</title><style>body{font:17px/1.7 system-ui;margin:70px auto;padding:24px;max-width:520px;color:#173d37;background:#fafaf8}h1{font-size:25px}input{box-sizing:border-box;width:100%;padding:13px;font-size:18px;margin:12px 0;border:1px solid #aabdb6;border-radius:8px}button{background:#176c5c;color:white;border:0;padding:12px 24px;border-radius:8px;font-size:17px;cursor:pointer}p{color:#53665e}</style><h1>DeepSeek 密钥设置</h1><p>${message}</p>${form?`<form method="post" action="/${token}"><label for="key">API Key</label><input id="key" name="key" type="password" required minlength="16" maxlength="512" autocomplete="off" autofocus><button type="submit">保存密钥</button></form><p>仅在本机加密保存，随后由 Codex 配置为网站服务端密钥。不需要管理员权限。</p>`:''}</html>`);
  };
  if(req.headers.host!==new URL(origin).host || req.url!==`/${token}`){res.writeHead(404,headers).end();return;}
  if(req.method==='GET'){page(saved?'密钥已保存。请回到聊天告诉 Codex“已保存”。':'请粘贴 DeepSeek API Key，点击保存。密钥输入会隐藏。',!saved);return;}
  if(req.method!=='POST'||req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')){res.writeHead(403,headers).end();return;}
  if(saved||saving){page(saved?'密钥已保存。请回到聊天继续。':'正在保存，请稍后刷新。');return;}
  saving=true;
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('length');}
    const key=new URLSearchParams(body).get('key')?.trim();
    if(!key||key.length<16||key.length>512||/\s/.test(key)){page('密钥不完整，请重新粘贴。',true,400);return;}
    await new Promise((resolve,reject)=>{
      // PowerShell 7's inherited module path prevents Windows PowerShell loading its security module.
      const childEnv={...process.env,DEEPSEEK_LOCAL_DEST:path.join(folder,'deepseek-key.xml')};
      for(const name of Object.keys(childEnv))if(name.toLowerCase()==='psmodulepath')delete childEnv[name];
      const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | Export-Clixml -LiteralPath $env:DEEPSEEK_LOCAL_DEST"],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:childEnv});
      const timer=setTimeout(()=>{ps.kill();reject(Error('timeout'));},15000);
      ps.on('error',()=>{clearTimeout(timer);reject(Error('save'));});
      ps.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('save'));});
      ps.stdin.on('error',()=>{});ps.stdin.end(key);
    });
    saved=true;page('密钥已保存。请回到聊天告诉 Codex“已保存”。');
    console.log('DeepSeek key saved with Windows user encryption.');
  }catch{page('保存未成功，请回到聊天告诉 Codex。');}
  finally{saving=false;}
});
server.listen(0,'127.0.0.1',()=>console.log(`Local setup: http://127.0.0.1:${server.address().port}/${token}`));
