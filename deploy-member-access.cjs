const fs = require('fs');
const https = require('https');
const credentials = JSON.parse(fs.readFileSync('C:/Users/KIM_TAEHYOUNG02/.clasprc.json','utf8'));
const config = JSON.parse(fs.readFileSync('.clasp.json','utf8'));
const deploymentId = 'AKfycbyoZ5CwGfbqMlCsozjFEgRsvS4GCRfRElSeCyRAHYdhBV00TNgXw1nWnuGELCAvU_DOJg';
function request(url, options, body) { return new Promise((resolve,reject) => {const req=https.request(url,options,res=>{let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>{if(res.statusCode>=400)return reject(new Error('HTTP '+res.statusCode+' '+data.slice(0,400)));try{resolve(JSON.parse(data));}catch(e){reject(e);}});});req.on('error',reject);if(body)req.write(body);req.end();}); }
async function main(){
 const post=new URLSearchParams({client_id:credentials.oauth2ClientSettings.clientId,client_secret:credentials.oauth2ClientSettings.clientSecret,refresh_token:credentials.token.refresh_token,grant_type:'refresh_token'}).toString();
 const auth=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'}},post);
 const headers={Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'};
 const base='https://script.googleapis.com/v1/projects/'+encodeURIComponent(config.scriptId);
 const current=await request(base+'/content',{headers});
 const deployment=await request(base+'/deployments/'+deploymentId,{headers});
 if(deployment.deploymentConfig.versionNumber!==18) throw new Error('운영 버전이 변경되어 배포를 중단했습니다.');
 const names=['Admin','AdminScript','AdminAccessService','AuthService','Config'];
 const files=current.files.map(f=>{if(!names.includes(f.name))return f; const path=f.name+(f.type==='HTML'?'.html':'.js');return {name:f.name,type:f.type,source:fs.readFileSync(path,'utf8')};});
 for(const name of names) if(!files.some(f=>f.name===name)) throw new Error('운영 파일 누락: '+name);
 await request(base+'/content',{method:'PUT',headers},JSON.stringify({files}));
 const version=await request(base+'/versions',{method:'POST',headers},JSON.stringify({description:'Restore chatbot access modes'}));
 console.log('Created version',version.versionNumber);
 const updated=await request(base+'/deployments/'+deploymentId,{method:'PUT',headers},JSON.stringify({deploymentConfig:{scriptId:config.scriptId,versionNumber:version.versionNumber,manifestFileName:'appsscript',description:'Restore chatbot access modes'}}));
 console.log('Deployment updated',updated.deploymentId,'version',updated.deploymentConfig.versionNumber);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
