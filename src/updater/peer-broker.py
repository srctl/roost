"""Private Unix socket transport with Linux SO_PEERCRED; no command execution.
Node owns policy/state. This bridge only multiplexes bounded JSON envelopes.
"""
import json, os, queue, socket, struct, sys, threading, uuid
path=sys.argv[1]
pending={}
lock=threading.Lock()
slots=threading.BoundedSemaphore(32)
server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
# systemd owns this process group; on a daemon restart no old broker remains.
try: os.unlink(path)
except FileNotFoundError: pass
server.bind(path); os.chmod(path,0o600);server.listen(16)

def reply_reader():
    for line in sys.stdin:
        try:
            message=json.loads(line)
            with lock: target=pending.get(message['id'])
            if target: target.put_nowait(message['result'])
        except (ValueError,KeyError,queue.Full): pass
    os._exit(0)
threading.Thread(target=reply_reader,daemon=True).start()

def client(connection):
    request_id=None
    try:
        connection.settimeout(20)
        _,uid,_=struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        if uid != os.getuid(): return
        data=b''
        while b'\n' not in data:
            chunk=connection.recv(4096)
            if not chunk: return
            data+=chunk
            if len(data)>8192: return
        if data.count(b'\n')!=1 or data.split(b'\n',1)[1]: return
        message=json.loads(data)
        if not isinstance(message,dict): return
        # Fixed CLI-only service/repair budgets; clients cannot supply a timeout.
        action=message.get('action')
        wait=600 if action=='repair' else 120 if action in ('start','stop') else 18
        request_id=str(uuid.uuid4()); result=queue.Queue(1)
        with lock:
            pending[request_id]=result
            print(json.dumps({'id':request_id,'message':message}),flush=True)
        try: response=result.get(timeout=wait)
        except queue.Empty:
            response={'error':'Updater response deadline exceeded. Check durable status before repeating an operation.'}
        answer=json.dumps(response).encode()+b'\n'
        if len(answer)>65536: return
        connection.sendall(answer)
    except (ValueError,OSError,queue.Empty): pass
    finally:
        with lock: pending.pop(request_id,None)
        connection.close(); slots.release()
print(json.dumps({'ready':True}),flush=True)
while True:
    connection,_=server.accept()
    if not slots.acquire(False): connection.close();continue
    threading.Thread(target=client,args=(connection,),daemon=True).start()
