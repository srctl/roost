import os,sys,tempfile
os.umask(0o022)
e={k:v for k,v in os.environ.items() if not k.startswith(('ROOST_','NITRO_','CODEX_','HERDR_')) and k not in ['HOST','PORT']}
e['PATH']='/tmp/approved-three-bin:'+e['PATH']
e['ROOST_DATA_DIR']=tempfile.mkdtemp(prefix='approved-three-test-')
e['CODEX_HOME']=tempfile.mkdtemp(prefix='approved-three-codex-')
e['ROOST_TEST_CHROME']='/opt/google/chrome/chrome'
e['ROOST_BROWSER_EXECUTABLE']='/opt/google/chrome/chrome'
e['ROOST_BROWSER_EVIDENCE_DIR']=os.path.abspath('artifacts/approved-three-merge')
os.execvpe(sys.argv[1],sys.argv[1:],e)
