# OWNER: karthik
"""Bounded container timing for WebM Opus and ISO BMFF/MP4 audio recordings.

This validates timestamps, not the compressed audio bitstream. Unsupported or ambiguous
container structures fail closed; no client-supplied duration is trusted.
"""
import math
import struct

def _vint(data, pos, keep=False):
    if pos >= len(data) or not data[pos]: raise ValueError('Invalid vint')
    first = data[pos]; width = 1
    while not first & (1 << (8 - width)):
        width += 1
        if width > 8: raise ValueError('Invalid vint width')
    if pos + width > len(data): raise ValueError('Truncated vint')
    value = int.from_bytes(data[pos:pos + width], 'big')
    if not keep: value &= (1 << (7 * width)) - 1
    return value, pos + width, width

# Matroska Segment children terminate an unknown-sized Cluster. Walk element headers,
# never scan payload bytes (an Opus packet may contain any of these byte sequences).
_SEGMENT_CHILDREN = {0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1F43B675,
                     0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367}
_CLUSTER_CHILDREN = {0xE7, 0xA7, 0xAB, 0xA3, 0xA0, 0xAF, 0x5854, 0xEC, 0xBF}

def _unknown_cluster_end(data, start, end):
    pos = start
    while pos < end:
        boundary = pos
        tag, pos, _ = _vint(data, pos, True)
        if tag in _SEGMENT_CHILDREN:
            return boundary
        if tag not in _CLUSTER_CHILDREN:
            raise ValueError('Unsupported unknown-sized Cluster child')
        size, pos, width = _vint(data, pos)
        if size == (1 << (7 * width)) - 1 or pos + size > end:
            raise ValueError('Invalid Cluster child bounds')
        pos += size
    return end

def _elements(data, start, end):
    pos = start
    while pos < end:
        tag, pos, _ = _vint(data, pos, True)
        size, pos, width = _vint(data, pos)
        if size == (1 << (7 * width)) - 1:
            if tag == 0x18538067:
                stop = end
            elif tag == 0x1F43B675:
                stop = _unknown_cluster_end(data, pos, end)
            else:
                raise ValueError('Unsupported unknown-sized EBML element')
        else:
            stop = pos + size
        if stop > end or stop < pos:
            raise ValueError('Invalid element bounds')
        yield tag, pos, stop
        pos = stop

def _opus_duration(packet):
    if not packet: raise ValueError('Empty Opus packet')
    toc = packet[0]; cfg = toc >> 3
    frame = ([10,20,40,60][cfg & 3] if cfg < 12 else
             [10,20][cfg & 1] if cfg < 16 else [2.5,5,10,20][cfg & 3])
    code = toc & 3
    count = 1 if code == 0 else 2 if code in (1,2) else (packet[1] & 63 if len(packet) > 1 else 0)
    duration = frame * count / 1000
    if not 0 < duration <= .12: raise ValueError('Invalid Opus duration')
    return duration

def _webm_duration(audio: bytes) -> float | None:
    try:
        segments = [(a,b) for tag,a,b in _elements(audio,0,len(audio)) if tag == 0x18538067]
        if len(segments) != 1: return None
        children = list(_elements(audio,*segments[0]))
        if any(sum(tag == expected for tag,_,_ in children) > 1 for expected in (0x1549A966,0x1654AE6B)):
            return None
        scale = 1_000_000; declared = None; tracks = set()
        for tag,a,b in children:
            if tag == 0x1549A966:
                for t,x,y in _elements(audio,a,b):
                    if t == 0x2AD7B1: scale = int.from_bytes(audio[x:y],'big')
                    if t == 0x4489 and y-x in (4,8):
                        declared = struct.unpack('>f' if y-x == 4 else '>d',audio[x:y])[0]
            if tag == 0x1654AE6B:
                for t,x,y in _elements(audio,a,b):
                    if t != 0xAE: continue
                    values = {k:audio[c:d] for k,c,d in _elements(audio,x,y)}
                    if values.get(0x86) == b'A_OPUS' and 0xD7 in values:
                        tracks.add(int.from_bytes(values[0xD7],'big'))
        if scale <= 0 or not tracks: return None
        last = 0; seen = False
        for tag,a,b in children:
            if tag != 0x1F43B675: continue
            elements = list(_elements(audio,a,b)); clock = 0
            if any(t not in _CLUSTER_CHILDREN for t,_,_ in elements):
                return None
            for t,x,y in elements:
                if t == 0xE7: clock = int.from_bytes(audio[x:y],'big')
            blocks = [(x,y) for t,x,y in elements if t == 0xA3]
            for t,x,y in elements:
                if t == 0xA0:
                    blocks.extend((c,d) for k,c,d in _elements(audio,x,y) if k == 0xA1)
            for x,y in blocks:
                track,p,_ = _vint(audio,x)
                if track not in tracks: continue
                if p + 3 >= y: raise ValueError('Truncated block')
                offset = int.from_bytes(audio[p:p+2],'big',signed=True); flags=audio[p+2]
                # Browser Opus normally has no lacing; fail closed for unsupported lacing.
                if flags & 6: return None
                end = (clock + offset) * scale / 1e9 + _opus_duration(audio[p+3:y])
                last = max(last,end); seen = True
        if declared is not None:
            declared = declared * scale / 1e9
            if not math.isfinite(declared): return None
            last = max(last,declared)
        return last if seen and math.isfinite(last) else None
    except (ValueError, IndexError, OverflowError, struct.error):
        return None


def _boxes(data, start, end):
    """Yield ISO BMFF boxes with checked 32/64-bit sizes and no recursive payload scans."""
    pos = start
    while pos < end:
        if end - pos < 8:
            raise ValueError('Truncated MP4 box')
        size = int.from_bytes(data[pos:pos + 4], 'big')
        kind = data[pos + 4:pos + 8]
        header = 8
        if size == 1:
            if end - pos < 16:
                raise ValueError('Truncated extended MP4 size')
            size = int.from_bytes(data[pos + 8:pos + 16], 'big')
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise ValueError('Invalid MP4 box size')
        yield kind, pos + header, pos + size
        pos += size


def _uint(data, start, end, size=4):
    if start < 0 or start + size > end:
        raise ValueError('Truncated MP4 field')
    return int.from_bytes(data[start:start + size], 'big')


def _fullbox(data, start, end):
    return _uint(data, start, end, 1), _uint(data, start + 1, end, 3)


def _header_timing(data, start, end):
    version, _ = _fullbox(data, start, end)
    if version not in (0, 1):
        raise ValueError('Unsupported timing header version')
    scale_offset, width = (12, 4) if version == 0 else (20, 8)
    scale = _uint(data, start + scale_offset, end)
    duration = _uint(data, start + scale_offset + 4, end, width)
    if not scale:
        raise ValueError('Invalid MP4 timescale')
    # All-ones is the ISO BMFF unknown-duration sentinel, not a usable timestamp.
    return scale, None if duration == (1 << (8 * width)) - 1 else duration / scale


def _mp4_duration(data):
    top = list(_boxes(data, 0, len(data)))
    if not any(k == b'ftyp' for k,_,_ in top) or not any(k == b'mdat' and b > a for k,a,b in top):
        return None
    movies = [(a,b) for k,a,b in top if k == b'moov']
    if len(movies) != 1:
        return None
    movie = list(_boxes(data, *movies[0]))
    longest = 0.0
    tracks = {}
    defaults = {}
    for kind, start, end in movie:
        if kind == b'mvhd':
            _, declared = _header_timing(data, start, end)
            longest = max(longest, declared or 0)
        elif kind == b'mvex':
            for k,a,b in _boxes(data, start, end):
                if k == b'trex':
                    defaults[_uint(data,a+4,b)] = _uint(data,a+12,b)
        elif kind == b'trak':
            track_id = None
            media = None
            for k,a,b in _boxes(data, start, end):
                if k == b'tkhd':
                    version, _ = _fullbox(data,a,b)
                    if version not in (0,1):
                        raise ValueError('Unsupported track header version')
                    track_id = _uint(data,a+(12 if version == 0 else 20),b)
                elif k == b'mdia':
                    media = (a,b)
            if not track_id or media is None or track_id in tracks:
                raise ValueError('Invalid MP4 track')
            scale = None
            duration = None
            audio = False
            stts_duration = 0
            for k,a,b in _boxes(data,*media):
                if k == b'mdhd':
                    scale, duration = _header_timing(data,a,b)
                elif k == b'hdlr':
                    if a + 12 > b:
                        raise ValueError('Truncated MP4 handler')
                    audio = data[a+8:a+12] == b'soun'
                elif k == b'minf':
                    for q,c,d in _boxes(data,a,b):
                        if q != b'stbl':
                            continue
                        for t,x,y in _boxes(data,c,d):
                            if t != b'stts':
                                continue
                            version, _ = _fullbox(data,x,y)
                            count = _uint(data,x+4,y)
                            if version != 0 or count > (y-x-8)//8 or x+8+count*8 != y:
                                raise ValueError('Invalid sample timing table')
                            for offset in range(x+8,y,8):
                                n = _uint(data,offset,y)
                                delta = _uint(data,offset+4,y)
                                if n and not delta:
                                    raise ValueError('Invalid sample duration')
                                stts_duration += n * delta
            if not audio or not scale:
                # Voice uploads are audio-only. Fail closed instead of ignoring another timeline.
                raise ValueError('Unsupported non-audio MP4 track')
            longest = max(longest,duration or 0,stts_duration/scale)
            tracks[track_id] = {'scale':scale,'end':0,'seen': bool(duration or stts_duration)}
    if not tracks:
        return None
    for kind,start,end in top:
        if kind != b'moof':
            continue
        for k,a,b in _boxes(data,start,end):
            if k != b'traf':
                continue
            children = list(_boxes(data,a,b))
            headers = [(x,y) for t,x,y in children if t == b'tfhd']
            decodes = [(x,y) for t,x,y in children if t == b'tfdt']
            if len(headers) != 1 or len(decodes) > 1:
                raise ValueError('Invalid MP4 fragment headers')
            x,y = headers[0]
            version, flags = _fullbox(data,x,y)
            track_id = _uint(data,x+4,y)
            if version != 0 or track_id not in tracks:
                raise ValueError('Unknown MP4 fragment track')
            track = tracks[track_id]
            cursor = x+8 + (8 if flags & 1 else 0) + (4 if flags & 2 else 0)
            default = _uint(data,cursor,y) if flags & 8 else defaults.get(track_id,0)
            cursor += (4 if flags & 8 else 0) + (4 if flags & 16 else 0) + (4 if flags & 32 else 0)
            if cursor != y:
                raise ValueError('Invalid fragment track header')
            timestamp = track['end']
            if decodes:
                x,y = decodes[0]
                version,_ = _fullbox(data,x,y)
                if version not in (0,1):
                    raise ValueError('Invalid decode time version')
                timestamp = _uint(data,x+4,y,8 if version == 1 else 4)
            for t,x,y in children:
                if t != b'trun':
                    continue
                version,flags = _fullbox(data,x,y)
                count = _uint(data,x+4,y)
                if version not in (0,1) or count > 1_000_000:
                    raise ValueError('Invalid sample run')
                cursor = x+8 + (4 if flags & 1 else 0) + (4 if flags & 4 else 0)
                width = 4 * sum(bool(flags & bit) for bit in (0x100,0x200,0x400,0x800))
                if cursor + count * width != y:
                    raise ValueError('Truncated sample run')
                if not flags & 0x100 and not default and count:
                    raise ValueError('Unknown sample duration')
                if not flags & (0x100 | 0x800):
                    timestamp += count * default
                    longest = max(longest,timestamp/track['scale'])
                else:
                    for _ in range(count):
                        duration = _uint(data,cursor,y) if flags & 0x100 else default
                        if flags & 0x100: cursor += 4
                        cursor += (4 if flags & 0x200 else 0) + (4 if flags & 0x400 else 0)
                        composition = 0
                        if flags & 0x800:
                            composition = _uint(data,cursor,y)
                            if version == 1 and composition >= 1 << 31:
                                composition -= 1 << 32
                            cursor += 4
                        if not duration:
                            raise ValueError('Invalid sample duration')
                        timestamp += duration
                        longest = max(longest,(timestamp+max(0,composition))/track['scale'])
                if count:
                    track['seen'] = True
            track['end'] = max(track['end'],timestamp)
    return longest if all(t['seen'] for t in tracks.values()) and longest > 0 else None


def duration_seconds(audio: bytes, mime: str) -> float | None:
    """Return conservative seconds or None for unsupported/malformed container timing."""
    if len(audio) > 6_000_000:
        return None
    try:
        if mime == 'audio/webm':
            return _webm_duration(audio)
        if mime == 'audio/mp4':
            value = _mp4_duration(audio)
            return value if value is not None and math.isfinite(value) else None
    except (ValueError, IndexError, OverflowError, struct.error):
        pass
    return None
