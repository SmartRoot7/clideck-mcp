#!/usr/bin/env python3
"""Submit the fixed 20-question cohort once through the production public MCP."""
import datetime,json,pathlib,time,subprocess,os
root=pathlib.Path(__file__).resolve().parent
out=root/'initial-responses.json'
if out.exists():raise SystemExit('Cohort already submitted; inspect existing responses.')
cohort=json.loads((root/'questions.json').read_text())
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
result={'started_at':utc(),'endpoint':'https://mcp.clideck.com/mcp','tool':'query_network_knowledge','responses':[]}
preloaded=os.environ.get('PRELOADED_FIRST_RESPONSE')
if preloaded:
 raw=json.loads(pathlib.Path(preloaded).read_text())
 result['responses'].append({'experiment_id':1,'question':cohort['selected'][0]['question'],'server_date':'2026-09-30T15:50:49+00:00','http_status':200,'response':raw,'note':'curl transport retry after edge 403; server journal supplies exact experiment timestamps'})
 result['started_at']='2026-09-30T15:50:49+00:00'
for item in cohort['selected']:
 if preloaded and item['experiment_id']==1:continue
 request={'jsonrpc':'2.0','id':item['experiment_id'],'method':'tools/call','params':{'name':result['tool'],'arguments':{'question':item['question'],'context':item['context'],'limit':3}}}
 started=time.monotonic();sent=utc()
 try:
  process=subprocess.run(['curl','--silent','--show-error','--fail-with-body','--max-time','35','-H','content-type: application/json','-H','accept: application/json, text/event-stream','-H','mcp-protocol-version: 2025-11-25','--data-binary','@-',result['endpoint']],input=json.dumps(request),capture_output=True,text=True,timeout=40)
  if process.returncode:raise RuntimeError(f'curl exit {process.returncode}: {process.stderr.strip()}')
  raw=json.loads(process.stdout);http=200
  entry={'experiment_id':item['experiment_id'],'question':item['question'],'sent_at':sent,'received_at':utc(),'http_status':http,'duration_ms':round((time.monotonic()-started)*1000),'response':raw}
 except Exception as error:entry={'experiment_id':item['experiment_id'],'question':item['question'],'sent_at':sent,'received_at':utc(),'error':str(error),'duration_ms':round((time.monotonic()-started)*1000)}
 result['responses'].append(entry)
 out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 payload=entry.get('response',{}).get('result',{}).get('structuredContent',{})
 print(json.dumps({'id':item['experiment_id'],'http':entry.get('http_status'),'answer_status':payload.get('answer_status'),'learning':payload.get('learning'),'error':entry.get('error')},ensure_ascii=False),flush=True)
result['completed_at']=utc();out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
