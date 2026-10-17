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
it('prunes only an explicitly approved historical set while protecting the newest two deploy backups',async()=>{
 const f=await fixture();const names=['deploy-20260930T052121Z-04ddae1','deploy-20260930T201539Z-ed4ae50','deploy-20260930T211222Z-7bc9125','deploy-20261009T072249Z-53c60bf','deploy-20261017T055739Z-266de23']
 for(const name of names){const dir=join(f.root,name);await mkdir(dir);await writeFile(join(dir,'previous-release.txt'),'fixture');await writeFile(join(dir,'clideck-mcp-fixture.dump'),'complete');await writeFile(join(dir,'clideck-mcp-fixture.dump.sha256'),'checksum')}
 const denied=spawnSync('bash',[resolve('ops/scripts/prepare-backup-space.sh'),f.root,'',names[4]!],{env:f.env,encoding:'utf8'})
 expect(denied.status).toBe(1);expect(denied.stderr).toContain('newest completed')
 const approved=spawnSync('bash',[resolve('ops/scripts/prepare-backup-space.sh'),f.root,'',names.slice(0,3).join(',')],{env:f.env,encoding:'utf8'})
 expect(approved.status,approved.stderr).toBe(0)
 const remaining=await readdir(f.root);for(const name of names.slice(0,3))expect(remaining).not.toContain(name);for(const name of names.slice(3))expect(remaining).toContain(name)
})

it('preserves the empty failed-SHA slot through the canonical SSH preflight',async()=>{
 const f=await fixture();const names=['deploy-20260930T052121Z-04ddae1','deploy-20261009T072249Z-53c60bf','deploy-20261017T055739Z-266de23']
 for(const name of names){const dir=join(f.root,name);await mkdir(dir);await writeFile(join(dir,'previous-release.txt'),'fixture');await writeFile(join(dir,'clideck-mcp-fixture.dump'),'complete');await writeFile(join(dir,'clideck-mcp-fixture.dump.sha256'),'checksum')}
 await writeFile(join(f.bin,'ssh'),'#!/bin/bash\nshift 3\n/bin/bash -c "$*"\n',{mode:0o755})
 await writeFile(join(f.bin,'sudo'),'#!/bin/bash\nshift\nexec "$@"\n',{mode:0o755})
 const deploy=await readFile(resolve('ops/scripts/deploy-production.sh'),'utf8')
 const preflight=deploy.slice(deploy.indexOf("printf '==> Verify backup space"),deploy.indexOf("printf '==> Preflight"))
 const result=spawnSync('bash',['-c',preflight],{env:{...f.env,remote_host:'fixture',CLIDECK_MCP_BACKUP_ROOT:f.root,CLIDECK_MCP_CLEANUP_FAILED_BACKUP_SHA:'',CLIDECK_MCP_PRUNE_APPROVED_BACKUPS:names[0]!},encoding:'utf8'})
 expect(result.status,result.stderr).toBe(0);expect(await readdir(f.root)).not.toContain(names[0]);expect(await readdir(f.root)).toContain(names[2])
})
