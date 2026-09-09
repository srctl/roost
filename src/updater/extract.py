"""Bounded regular-file/directory-only GNU/ustar extractor. No tar subprocess."""
import gzip, os, pathlib, sys
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
root.mkdir(mode=0o700)  # fresh owned staging only
expanded = 0
seen = set()
long_name = None

def number(value):
    text = value.rstrip(b'\0 ').lstrip(b' ')
    if not text: return 0
    if any(c not in b'01234567' for c in text): raise ValueError('Invalid tar number')
    return int(text, 8)

with gzip.open(archive, 'rb') as stream:
    def read(size):
        global expanded
        expanded += size
        if expanded > 2 * 1024**3: raise ValueError('Expanded archive limit')
        value = stream.read(size)
        if len(value) != size: raise ValueError('Truncated archive')
        return value
    for count in range(100001):
        if count == 100000: raise ValueError('Archive entry limit')
        header = read(512)
        if header == bytes(512):
            if read(512) != bytes(512): raise ValueError('Invalid archive end')
            # Consume bounded padding, rejecting concatenated hidden content.
            while True:
                chunk = stream.read(65536)
                if not chunk: break
                expanded += len(chunk)
                if expanded > 2 * 1024**3 or any(chunk): raise ValueError('Trailing archive content')
            break
        if sum(header[:148]) + 8 * 32 + sum(header[156:]) != number(header[148:156]): raise ValueError('Tar checksum')
        size = number(header[124:136])
        kind = header[156:157]
        if kind == b'L':
            if long_name is not None or size > 4096: raise ValueError('Long-name limit')
            long_name = read(size).rstrip(b'\0').decode('utf-8', 'strict')
            if size % 512: read(512-size%512)
            continue
        if kind not in (b'0', b'\0', b'5'): raise ValueError('Links/extensions/special files forbidden')
        name = long_name or header[:100].split(b'\0')[0].decode('utf-8','strict')
        if not long_name and header[257:263] == b'ustar\0':
            prefix = header[345:500].split(b'\0')[0].decode('utf-8','strict')
            if prefix: name = prefix + '/' + name
        long_name = None
        if len(name)>4096 or '\\' in name or '\0' in name or name.startswith('/') or '..' in name.split('/'): raise ValueError('Unsafe path')
        name = str(pathlib.PurePosixPath(name))
        if name in seen: raise ValueError('Duplicate path')
        seen.add(name)
        target = root / name
        if kind == b'5':
            if size: raise ValueError('Directory payload')
            target.mkdir(mode=0o700, parents=True, exist_ok=True)
        else:
            if name == '.': raise ValueError('Invalid file')
            target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with target.open('xb') as output:
                remaining = size
                while remaining:
                    chunk=read(min(65536,remaining)); output.write(chunk); remaining-=len(chunk)
                output.flush(); os.fsync(output.fileno())
            os.chmod(target, 0o700 if number(header[100:108]) & 0o111 else 0o600)
            if size % 512: read(512-size%512)
    else: raise ValueError('Missing archive end')
