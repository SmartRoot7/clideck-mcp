import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {afterEach,expect,it} from 'vitest'
const directories:string[]=[]
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true})})
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'clideck-backup-'));directories.push(root)
 const bin=join(root,'bin');await mkdir(bin)
 await writeFile(join(bin,'df'),'#!/bin/bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 99999999 1 ${FIXTURE_AVAILABLE_KB:-99999999} 1%% /\\n"\n',{mode:0o755})
 await writeFile(join(bin,'pgrep'),'#!/bin/bash\nexit 1\n',{mode:0o755})
 return {root,bin,env:{...process.env,PATH:bin+':'+process.env['PATH'],BACKUP_DIRECTORY:root,BACKUP_DATABASE_URL:'postgresql://fixture',BACKUP_MIN_FREE_BYTES:'1024'}}
}
it('removes only the explicitly selected failed deployment partial and preserves complete/unrelated backups',async()=>{
 const f=await fixture();const sha='a'.repeat(40)
 for(const prefix of ['aaaaaaa','bbbbbbb']){
  const dir=join(f.root,`deploy-20261017T000000Z-${prefix}`);await mkdir(dir)
  await writeFile(join(dir,'previous-release.txt'),'/opt/clideck-mcp/releases/fixture')
  await writeFile(join(dir,'clideck-mcp-failed.dump.partial'),'incomplete')
  await writeFile(join(dir,'clideck-mcp-good.dump'),'complete')
  await writeFile(join(dir,'clideck-mcp-good.dump.sha256'),'checksum')
 }
 const result=spawnSync('bash',[resolve('ops/scripts/prepare-backup-space.sh'),f.root,sha],{env:f.env,encoding:'utf8'})
 expect(result.status,result.stderr).toBe(0)
 expect(await readdir(join(f.root,'deploy-20261017T000000Z-aaaaaaa'))).not.toContain('clideck-mcp-failed.dump.partial')
 expect(await readdir(join(f.root,'deploy-20261017T000000Z-bbbbbbb'))).toContain('clideck-mcp-failed.dump.partial')
 expect(await readFile(join(f.root,'deploy-20261017T000000Z-aaaaaaa','clideck-mcp-good.dump'),'utf8')).toBe('complete')
})
it('blocks backup preflight without deleting completed history when free capacity is insufficient',async()=>{
 const f=await fixture();const result=spawnSync('bash',[resolve('ops/scripts/prepare-backup-space.sh'),f.root],{env:{...f.env,FIXTURE_AVAILABLE_KB:'0'},encoding:'utf8'})
 expect(result.status).toBe(1);expect(result.stderr).toContain('BACKUP_INSUFFICIENT_FREE_SPACE')
})
it('cleans its own incomplete archive after pg_dump failure',async()=>{
 const f=await fixture()
 await writeFile(join(f.bin,'pg_dump'),'#!/bin/bash\nfor arg do case "$arg" in --file=*) printf incomplete > "${arg#--file=}";; esac; done\nexit 2\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/backup.sh')],{env:f.env,encoding:'utf8',timeout:5000})
 expect(result.status).toBe(2);expect((await readdir(f.root)).filter(name=>name.endsWith('.partial'))).toEqual([])
})
it('stops only its dump and cleans the partial when the free-space reserve is crossed',async()=>{
 const f=await fixture()
 await writeFile(join(f.bin,'df'),'#!/bin/bash\nif test -e "$BACKUP_DIRECTORY/started"; then available=0; else available=99999999; fi\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 99999999 1 $available 1%% /\\n"\n',{mode:0o755})
 await writeFile(join(f.bin,'pg_dump'),'#!/bin/bash\ntrap "exit 2" TERM\nfor arg do case "$arg" in --file=*) printf incomplete > "${arg#--file=}";; esac; done\ntouch "$BACKUP_DIRECTORY/started"\nwhile true; do sleep 0.05; done\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/backup.sh')],{env:f.env,encoding:'utf8',timeout:5000})
 expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('BACKUP_DISK_RESERVE')
 expect((await readdir(f.root)).filter(name=>name.endsWith('.partial'))).toEqual([])
})
it('keeps a successful archive and its checksum',async()=>{
 const f=await fixture()
 await writeFile(join(f.bin,'pg_dump'),'#!/bin/bash\nfor arg do case "$arg" in --file=*) printf complete > "${arg#--file=}";; esac; done\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/backup.sh')],{env:f.env,encoding:'utf8',timeout:5000})
 expect(result.status,result.stderr).toBe(0)
 const files=await readdir(f.root);expect(files.some(name=>name.endsWith('.dump'))).toBe(true);expect(files.some(name=>name.endsWith('.dump.sha256'))).toBe(true)
})
