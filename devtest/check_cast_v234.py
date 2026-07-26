import json, re

d = json.load(open('public/cast-registry.json', encoding='utf-8'))
ids, dups = {}, []
for c in d['characters']:
    v = c['voice']; k = v['provider'] + '||' + v['voiceId']
    if k in ids:
        dups.append((c['name'], ids[k], k))
    ids[k] = c['name']
print('registry version:', d.get('version'))
print('registry characters:', len(d['characters']))
print('registry collisions:', dups or 'none')

h = open('public/index.html', encoding='utf-8').read()
b = re.search(r'PANEL_BENCH: \{([\s\S]*?)\n\s+\},', h).group(1)
pairs = re.findall(r'"([^"]+)":\s*\{\s*elevenlabs:\s*\'([^\']+)\',\s*speechify:\s*\'([^\']+)\'', b)
print('bench chairs:', len(pairs))
el = [p[1] for p in pairs]; sp = [p[2] for p in pairs]
print('bench EL dupes:', [x for x in set(el) if el.count(x) > 1] or 'none')
print('bench SPX dupes:', [x for x in set(sp) if sp.count(x) > 1] or 'none')

saga = {c['voice']['provider'] + '||' + c['voice']['voiceId']: c['name']
        for c in d['characters'] if c.get('region') != 'panel'}
panel = {c['voice']['provider'] + '||' + c['voice']['voiceId']: c['name']
         for c in d['characters'] if c.get('region') == 'panel'}
cross = []
for n, e, s in pairs:
    for k in ('elevenlabs||' + e, 'speechify||' + s):
        if k in saga:
            cross.append((n, k, saga[k]))
print('bench vs saga collisions:', cross or 'none')

# every panel chair in the registry should agree with the bench's EL pick
mismatch = []
for n, e, s in pairs:
    for pk, pn in panel.items():
        if pn.upper().replace('THE ', '') in n.replace('THE ', '') or pn.upper() == n:
            if pk.startswith('elevenlabs||') and pk.split('||')[1] != e:
                mismatch.append((n, pn, pk.split('||')[1], e))
print('bench vs registry panel mismatches:', mismatch or 'none')
