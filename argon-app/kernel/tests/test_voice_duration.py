# OWNER: karthik
from foundry_kernel.voice.duration import duration_seconds

def element(tag,payload):
    assert len(payload)<127
    return bytes.fromhex(tag)+bytes([0x80|len(payload)])+payload

def webm(clock=1000,scale=1000000):
    info=element('1549a966',element('2ad7b1',scale.to_bytes(3,'big')))
    track=element('ae',element('d7',b'\x01')+element('86',b'A_OPUS'))
    tracks=element('1654ae6b',track)
    # Opus configuration 19 = 20ms CELT, one packet, no lacing.
    block=element('a3',b'\x81\x00\x00\x80\x98\x00')
    cluster=element('1f43b675',element('e7',clock.to_bytes(2,'big'))+block)
    return element('18538067',info+tracks+cluster)

def test_durationless_mediarecorder():
    assert abs(duration_seconds(webm(),'audio/webm')-1.02)<.0001

def test_long_clip_detected():
    assert duration_seconds(webm(31000),'audio/webm')>30

def test_malformed_or_forged_duration_rejected():
    assert duration_seconds(b'not webm\x44\x89\x84\x00\x00\x00\x00','audio/webm') is None
    assert duration_seconds(webm()[:-1],'audio/webm') is None
    assert duration_seconds(b'anything','audio/ogg') is None


def unknown_cluster(clock, packet=b'\x98\x00'):
    block=element('a3',b'\x81\x00\x00\x80'+packet)
    return bytes.fromhex('1f43b675')+b'\xff'+element('e7',clock.to_bytes(2,'big'))+block


def multi_cluster_webm(clocks):
    info=element('1549a966',element('2ad7b1',(1000000).to_bytes(3,'big')))
    track=element('ae',element('d7',b'\x01')+element('86',b'A_OPUS'))
    tracks=element('1654ae6b',track)
    return bytes.fromhex('18538067')+b'\xff'+info+tracks+b''.join(unknown_cluster(c) for c in clocks)


def test_unknown_size_sibling_clusters_all_counted():
    assert abs(duration_seconds(multi_cluster_webm([0,1000]),'audio/webm')-1.02)<.0001
    assert duration_seconds(multi_cluster_webm([0,1000,31000]),'audio/webm')>30


def test_cluster_marker_in_opus_payload_not_treated_as_sibling():
    info=element('1549a966',element('2ad7b1',(1000000).to_bytes(3,'big')))
    tracks=element('1654ae6b',element('ae',element('d7',b'\x01')+element('86',b'A_OPUS')))
    audio=bytes.fromhex('18538067')+b'\xff'+info+tracks+unknown_cluster(1000,b'\x98\x1f\x43\xb6\x75')
    assert abs(duration_seconds(audio,'audio/webm')-1.02)<.0001


def test_unknown_sized_cluster_child_fails_closed():
    audio=multi_cluster_webm([0])+bytes.fromhex('a3')+b'\xff'+b'garbage'
    assert duration_seconds(audio,'audio/webm') is None


def box(kind,payload,extended=False):
    if extended:
        return (1).to_bytes(4,'big')+kind+(16+len(payload)).to_bytes(8,'big')+payload
    return (8+len(payload)).to_bytes(4,'big')+kind+payload


def full(payload,version=0,flags=0):
    return bytes([version])+flags.to_bytes(3,'big')+payload


def timing_header(kind,seconds,scale=1000,version=0):
    if version == 0:
        payload=bytes(8)+scale.to_bytes(4,'big')+int(seconds*scale).to_bytes(4,'big')
    else:
        payload=bytes(16)+scale.to_bytes(4,'big')+int(seconds*scale).to_bytes(8,'big')
    return box(kind,full(payload,version))


def mp4(seconds=1,fragmented=False,version=0,extended=False,default=0):
    mvhd=timing_header(b'mvhd',0 if fragmented else seconds,version=version)
    tkhd=box(b'tkhd',full(bytes(8)+(1).to_bytes(4,'big')))
    mdhd=timing_header(b'mdhd',0 if fragmented else seconds,scale=48000,version=version)
    hdlr=box(b'hdlr',full(bytes(4)+b'soun'))
    entries=b'' if fragmented else (1).to_bytes(4,'big')+int(seconds*48000).to_bytes(4,'big')
    stts=box(b'stts',full((0 if fragmented else 1).to_bytes(4,'big')+entries))
    media=box(b'mdia',mdhd+hdlr+box(b'minf',box(b'stbl',stts)))
    trak=box(b'trak',tkhd+media)
    mvex=box(b'mvex',box(b'trex',full((1).to_bytes(4,'big')+(1).to_bytes(4,'big')+default.to_bytes(4,'big')+bytes(8)))) if fragmented else b''
    result=box(b'ftyp',b'M4A '+bytes(4)+b'M4A isom')+box(b'moov',mvhd+trak+mvex,extended)
    if fragmented:
        result+=fragment(0,[int(seconds*48000)])
    return result+box(b'mdat',b'\x00'*32)


def fragment(decode,durations=None,default=0,track=1,tfdt_version=0,composition=None):
    tfhd=box(b'tfhd',full(track.to_bytes(4,'big')+(default.to_bytes(4,'big') if default else b''),flags=8 if default else 0))
    tfdt=box(b'tfdt',full(decode.to_bytes(8 if tfdt_version else 4,'big'),tfdt_version))
    durations=durations or [default]
    flags=(0 if default else 0x100)|(0x800 if composition is not None else 0)
    samples=b''.join((b'' if default else d.to_bytes(4,'big'))+(composition.to_bytes(4,'big') if composition is not None else b'') for d in durations)
    trun=box(b'trun',full(len(durations).to_bytes(4,'big')+samples,flags=flags))
    return box(b'moof',box(b'traf',tfhd+tfdt+trun))


def test_regular_mp4_and_version_one_extended_headers():
    assert duration_seconds(mp4(),'audio/mp4')==1
    assert duration_seconds(mp4(2.5,version=1,extended=True),'audio/mp4')==2.5
    assert duration_seconds(mp4(31),'audio/mp4')==31


def test_fragmented_mp4_uses_sample_timing_not_zero_header():
    assert duration_seconds(mp4(1,fragmented=True),'audio/mp4')==1
    assert duration_seconds(mp4(31,fragmented=True),'audio/mp4')==31
    assert duration_seconds(mp4(1,fragmented=True)+fragment(48000,[24000]),'audio/mp4')==1.5
    assert duration_seconds(mp4(1,fragmented=True)+fragment(31*48000,[960],tfdt_version=1),'audio/mp4')>31


def test_fragment_default_duration_and_composition_timing():
    assert duration_seconds(mp4(1,fragmented=True)+fragment(48000,[960]*5,default=960),'audio/mp4')==1.1
    assert duration_seconds(mp4(1,fragmented=True)+fragment(48000,[960],composition=48000),'audio/mp4')==2.02


def test_mp4_malformed_and_unknown_timing_fail_closed():
    assert duration_seconds(mp4()[:-1],'audio/mp4') is None
    assert duration_seconds(mp4()+box(b'moof',box(b'traf',b'')),'audio/mp4') is None
    assert duration_seconds(mp4(1,fragmented=True)+fragment(0,[1],track=2),'audio/mp4') is None
    assert duration_seconds(box(b'ftyp',b'M4A ')+box(b'mdat',b'\x00'),'audio/mp4') is None
    assert duration_seconds(b'\x00\x00\x00\x01moov\xff','audio/mp4') is None


def test_fragment_trex_default_sample_duration():
    base=mp4(1,fragmented=True,default=960)
    # A trun without explicit sample durations uses the moov/mvex/trex default.
    tfhd=box(b'tfhd',full((1).to_bytes(4,'big')))
    tfdt=box(b'tfdt',full((48000).to_bytes(4,'big')))
    trun=box(b'trun',full((5).to_bytes(4,'big')))
    assert duration_seconds(base+box(b'moof',box(b'traf',tfhd+tfdt+trun)),'audio/mp4')==1.1


def test_long_track_timing_cannot_hide_behind_short_movie_header():
    data=mp4(31)
    movie=timing_header(b'mvhd',31)
    data=data.replace(movie,timing_header(b'mvhd',1))
    assert duration_seconds(data,'audio/mp4')==31
