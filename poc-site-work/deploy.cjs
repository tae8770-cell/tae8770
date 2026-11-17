const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sftp = require('C:/AppsScriptProjects/POC_AI_KR/node_modules/ssh2-sftp-client');
const env = Object.fromEntries(fs.readFileSync('C:/AppsScriptProjects/POC_AI_KR/host.env','utf8').split(/\r?\n/).filter(line=>/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).map(line=>{const i=line.indexOf('=');return [line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
async function main(){
 const sftp = new Sftp();
 try {
  await sftp.connect({host:env.SFTP_HOST,port:Number(env.SFTP_PORT||22),username:env.SFTP_USER,password:env.SFTP_PASSWORD,readyTimeout:15000});
  const files=['solutions.html','assets/solutions.js','assets/solutions-hero.css'];
  const originals = {};
  const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
  for (const name of files) {
    const remote=await sftp.get('/public_html/'+name);
    const local=fs.readFileSync(path.join('C:/AppsScriptProjects/POC_AI_KR/site',name));
    if(hash(remote)!==hash(local)) throw new Error('서버 파일이 로컬 원본과 달라 배포를 중단합니다: '+name);
    originals[name]=remote;
  }
  const image='assets/img/solutions-agent-hero.png';
  if(await sftp.exists('/public_html/'+image)) throw new Error('새 배너 파일이 이미 존재하여 배포를 중단합니다.');
  const backup=fs.mkdtempSync(path.join(__dirname,'backup-'));
  for(const name of files){const dest=path.join(backup,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,originals[name]);}
  console.log('Saved recovery copies:',backup);
  const changed=[];
  try {
    for(const name of [image,'assets/solutions-hero.css','assets/solutions.js','solutions.html']){
      const data=fs.readFileSync(path.join(__dirname,name));
      changed.push(name);
      await sftp.put(data,'/public_html/'+name);
      if(hash(await sftp.get('/public_html/'+name))!==hash(data)) throw new Error('업로드 확인 실패: '+name);
      console.log('Uploaded and verified:',name);
    }
  } catch(error) {
    for(const name of changed.filter(name=>originals[name]).reverse()) await sftp.put(originals[name],'/public_html/'+name);
    throw error;
  }
 } finally { await sftp.end(); }
}
main().catch(error=>{console.error('SFTP:',error.message);process.exitCode=1;});
