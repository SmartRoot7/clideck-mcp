import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {afterEach,expect,it} from 'vitest'
const directories:string[]=[]
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true})})
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'clideck-backup-'));directories.push(root)
 const bin=join(root,'bin');await mkdir(bin)
 await writeFile(join(bin,'df'),'#!/bin/bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 99999999 1 ${FIXTURE_AVAILABLE_KB:-99999999} 1%% /\\n"\n',{mode:0o755})
 await writeFile(join(bin,'pgrep'),'#!/bin/bash\nexit 1\n',{mode:0o755})
 await writeFile(join(bin,'pg_restore'),'#!/bin/bash\nexit 0\n',{mode:0o755})
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

async function completedDump(directory:string,timestamp:string){
 const dump=join(directory,`clideck-mcp-${timestamp}.dump`)
 await writeFile(dump,'complete')
 await writeFile(dump+'.sha256',createHash('sha256').update('complete').digest('hex')+'  '+dump+'\n')
 return dump
}

it('rotates daily backups by count only after the new archive passes validation',async()=>{
 const f=await fixture();const old=await completedDump(f.root,'20261018T000000Z')
 await writeFile(join(f.root,'operator-notes.txt'),'preserve')
 const deployment=join(f.root,'deploy-20261017T000000Z-aaaaaaa');await mkdir(deployment)
 await writeFile(join(deployment,'previous-release.txt'),'preserve')
 await writeFile(join(f.bin,'pg_dump'),'#!/bin/bash\nfor arg do case "$arg" in --file=*) printf complete > "${arg#--file=}";; esac; done\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/backup.sh')],{env:f.env,encoding:'utf8',timeout:5000})
 expect(result.status,result.stderr).toBe(0)
 const files=await readdir(f.root)
 expect(files).not.toContain(old.split('/').at(-1));expect(files.filter(name=>name.endsWith('.dump'))).toHaveLength(1)
 expect(files).toContain('operator-notes.txt');expect(files).toContain(deployment.split('/').at(-1))
})

it('preserves the previous daily backup if the new archive is unreadable',async()=>{
 const f=await fixture();const old=await completedDump(f.root,'20261018T000000Z')
 await writeFile(join(f.bin,'pg_dump'),'#!/bin/bash\nfor arg do case "$arg" in --file=*) printf broken > "${arg#--file=}";; esac; done\n',{mode:0o755})
 await writeFile(join(f.bin,'pg_restore'),'#!/bin/bash\nexit 2\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/backup.sh')],{env:f.env,encoding:'utf8',timeout:5000})
 expect(result.status).toBe(2);expect(await readFile(old,'utf8')).toBe('complete')
 expect(await readFile(old+'.sha256','utf8')).toContain(createHash('sha256').update('complete').digest('hex'))
})

it('retains one verified deployment and daily backup while leaving unmanaged paths alone',async()=>{
 const f=await fixture();const oldDaily=await completedDump(f.root,'20261017T000000Z');const daily=await completedDump(f.root,'20261018T000000Z')
 const old=join(f.root,'deploy-20261017T000000Z-aaaaaaa');const failed=join(f.root,'deploy-20261017T010000Z-bbbbbbb');const current=join(f.root,'deploy-20261019T000000Z-ccccccc')
 for(const dir of [old,failed,current]){await mkdir(dir);await writeFile(join(dir,'previous-release.txt'),'previous')}
 await completedDump(old,'20261017T000000Z');await writeFile(join(failed,'clideck-mcp-failed.dump.partial'),'incomplete');const currentDump=await completedDump(current,'20261019T000000Z')
 for(const name of ['host-migration','deploy-operator-notes'])await mkdir(join(f.root,name))
 const result=spawnSync('bash',[resolve('ops/scripts/prune-backups.sh'),f.root,current],{env:f.env,encoding:'utf8'})
 expect(result.status,result.stderr).toBe(0)
 const files=await readdir(f.root)
 expect(files).not.toContain(old.split('/').at(-1));expect(files).not.toContain(failed.split('/').at(-1));expect(files).not.toContain(oldDaily.split('/').at(-1))
 expect(await readFile(daily,'utf8')).toBe('complete');expect(await readFile(currentDump,'utf8')).toBe('complete')
 expect(files).toContain('host-migration');expect(files).toContain('deploy-operator-notes')
})

it('deletes no history when the retained deployment checksum is invalid',async()=>{
 const f=await fixture();const old=await completedDump(f.root,'20261017T000000Z');await completedDump(f.root,'20261018T000000Z')
 const current=join(f.root,'deploy-20261019T000000Z-ccccccc');await mkdir(current);await writeFile(join(current,'previous-release.txt'),'previous')
 const dump=await completedDump(current,'20261019T000000Z');await writeFile(dump,'corrupted')
 const result=spawnSync('bash',[resolve('ops/scripts/prune-backups.sh'),f.root,current],{env:f.env,encoding:'utf8'})
 expect(result.status).not.toBe(0);expect(await readFile(old,'utf8')).toBe('complete')
})

it('does not prune while another dump is running',async()=>{
 const f=await fixture();const old=await completedDump(f.root,'20261017T000000Z');await completedDump(f.root,'20261018T000000Z')
 await writeFile(join(f.bin,'pgrep'),'#!/bin/bash\nexit 0\n',{mode:0o755})
 const result=spawnSync('bash',[resolve('ops/scripts/prune-backups.sh'),f.root],{env:f.env,encoding:'utf8'})
 expect(result.status).toBe(1);expect(result.stderr).toContain('running pg_dump');expect(await readFile(old,'utf8')).toBe('complete')
})

it('neither follows backup symlinks nor accepts one as the retained deployment',async()=>{
 const f=await fixture();const outside=await fixture();const dump=await completedDump(outside.root,'20261017T000000Z')
 const linked=join(f.root,'deploy-20261017T000000Z-aaaaaaa');await symlink(outside.root,linked)
 const current=join(f.root,'deploy-20261019T000000Z-ccccccc');await mkdir(current);await writeFile(join(current,'previous-release.txt'),'previous');await completedDump(current,'20261019T000000Z')
 await symlink(dump,join(f.root,'clideck-mcp-20261017T000000Z.dump'));await symlink(dump+'.sha256',join(f.root,'clideck-mcp-20261017T000000Z.dump.sha256'))
 const denied=spawnSync('bash',[resolve('ops/scripts/prune-backups.sh'),f.root,linked],{env:f.env,encoding:'utf8'})
 expect(denied.status).not.toBe(0)
 const result=spawnSync('bash',[resolve('ops/scripts/prune-backups.sh'),f.root,current],{env:f.env,encoding:'utf8'})
 expect(result.status,result.stderr).toBe(0);expect(await readFile(dump,'utf8')).toBe('complete');expect(await readdir(f.root)).toContain(linked.split('/').at(-1))
})

it('runs deployment retention after smoke and restoration and keeps only current and previous releases',async()=>{
 const remote=await readFile(resolve('ops/scripts/deploy-production-remote.sh'),'utf8')
 const retentionAt=remote.indexOf('if ! prune_deployment_history; then')
 expect(retentionAt).toBeGreaterThan(remote.indexOf('"$release_directory/ops/scripts/smoke-test.sh"'))
 expect(retentionAt).toBeGreaterThan(remote.indexOf('restore_pipeline_state\n\nif [['))
 expect(remote).toContain('"$entry" == "$current_release" || "$entry" == "$previous_keep"')
 expect(remote).not.toContain('retention_count')
 expect(remote).toContain('bash "$release_directory/ops/scripts/prune-backups.sh" "$backup_root" "$backup_directory"')
})
