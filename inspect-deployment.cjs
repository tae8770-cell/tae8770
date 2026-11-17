const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const credentials = JSON.parse(fs.readFileSync('C:/Users/KIM_TAEHYOUNG02/.clasprc.json','utf8'));
const config = JSON.parse(fs.readFileSync('.clasp.json','utf8'));
function request(url, options, body) { return new Promise((resolve,reject) => { const req=https.request(url,options,res=>{let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>{if(res.statusCode>=400)return reject(new Error('HTTP '+res.statusCode+' '+data.slice(0,300)));resolve(JSON.parse(data));});});req.on('error',reject);if(body)req.write(body);req.end();}); }
async function main(){
 const post=new URLSearchParams({client_id:credentials.oauth2ClientSettings.clientId,client_secret:credentials.oauth2ClientSettings.clientSecret,refresh_token:credentials.token.refresh_token,grant_type:'refresh_token'}).toString();
 const auth=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'}},post);
 const headers={Authorization:'Bearer '+auth.access_token};
 const base='https://script.googleapis.com/v1/projects/'+encodeURIComponent(config.scriptId);
 const content=await request(base+'/content',{headers});
 const deployments=await request(base+'/deployments',{headers});
 for(const f of content.files||[]){ const ext=f.type==='HTML'?'.html':f.type==='SERVER_JS'?'.js':'.json';const p=f.name+ext;let local=fs.existsSync(p)?fs.readFileSync(p,'utf8'):null; const hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex').slice(0,12);console.log(p, local===null?'REMOTE_ONLY':hash(local)===hash(f.source)?'MATCH':'DIFFERENT'); if(process.argv[2]==='diff' && ['Admin.html','AdminAccessService.js','AdminScript.html','AuthService.js','Code.js','Config.js','SheetSchema.js','UserAccess.html'].includes(p) && local!==null){const a=f.source.replace(/\r\n/g,'\n').split('\n'),b=local.replace(/\r\n/g,'\n').split('\n');const sa=new Set(a),sb=new Set(b);console.log('REMOTE ONLY LINES',a.filter(x=>x.trim()&&!sb.has(x)).slice(0,60).join('\n'));console.log('LOCAL ONLY LINES',b.filter(x=>x.trim()&&!sa.has(x)).slice(0,60).join('\n'));} }
 console.log('deployments',JSON.stringify((deployments.deployments||[]).map(d=>({deploymentId:d.deploymentId,versionNumber:d.deploymentConfig?.versionNumber,description:d.deploymentConfig?.description,entryPoints:d.entryPoints}))));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
