import json, re

d = json.load(open('public/cast-registry.json', encoding='utf-8'))
ids, dups = {}, []
voiceless = []
for c in d['characters']:
    v = c.get('voice')
    if not v:
        # a voiceless child row reads in the Narrator voice (Merra); a voiceless
        # teen/adult row is score-matched (Auren, until a voice is picked)
        voiceless.append(c['name'])
        continue
    k = v['provider'] + '||' + v['voiceId']
    if k in ids:
        dups.append((c['name'], ids[k], k))
    ids[k] = c['name']
print('registry version:', d.get('version'))
print('registry characters:', len(d['characters']))
print('registry collisions:', dups or 'none')
print('voiceless (Narrator if child, else score-matched):', voiceless or 'none')

# v1.10 canon (recast by ear 2026-10-07)
row = {c['name']: c for c in d['characters']}
def seat(n):
    v = row[n].get('voice')
    return (v['provider'], v['voiceId']) if v else None
canon_fail = []
def expect(label, cond):
    print(('  ok    ' if cond else '  FAIL  ') + label)
    if not cond: canon_fail.append(label)
expect("version 1.10-polly-recast", d.get('version') == '1.10-polly-recast')
expect("Ka'el -> polly/Kevin, locked", seat("Ka'el") == ('polly', 'Kevin') and row["Ka'el"].get('locked'))
expect("Junia -> polly/Justin, locked", seat('Junia') == ('polly', 'Justin') and row['Junia'].get('locked'))
expect("Pip -> polly/Ivy, locked", seat('Pip') == ('polly', 'Ivy') and row['Pip'].get('locked'))
expect("Merra voiceless child (Narrator)", seat('Merra') is None and row['Merra']['age'] == 'child')
expect("Auren voiceless, unlocked, teen", seat('Auren') is None and not row['Auren'].get('locked') and row['Auren']['age'] == 'teen')
expect("Auren keeps aliases AUREN / THE WATCHER", {'AUREN', 'THE WATCHER'} <= set(row['Auren']['aliases']))
expect("elder Watcher row has no THE WATCHER alias", not any(a.upper() == 'THE WATCHER' for a in row['Watcher']['aliases']))
reserved = {c['voice']['voiceId'] for c in d['characters'] if c.get('locked') and c.get('voice')}
expect("reserved set = Justin, Ivy, Kevin, linda", reserved == {'Justin', 'Ivy', 'Kevin', 'linda'})
expect("no evie/rory anywhere", not any(c.get('voice') and c['voice']['voiceId'] in ('evie', 'rory') for c in d['characters']))

h = open('public/index.html', encoding='utf-8').read()
b = re.search(r'PANEL_BENCH: \{([\s\S]*?)\n\s+\},', h).group(1)
pairs = re.findall(r'"([^"]+)":\s*\{\s*elevenlabs:\s*\'([^\']+)\',\s*speechify:\s*\'([^\']+)\'', b)
print('bench chairs:', len(pairs))
el = [p[1] for p in pairs]; sp = [p[2] for p in pairs]
print('bench EL dupes:', [x for x in set(el) if el.count(x) > 1] or 'none')
print('bench SPX dupes:', [x for x in set(sp) if sp.count(x) > 1] or 'none')

saga = {c['voice']['provider'] + '||' + c['voice']['voiceId']: c['name']
        for c in d['characters'] if c.get('region') != 'panel' and c.get('voice')}
panel = {c['voice']['provider'] + '||' + c['voice']['voiceId']: c['name']
         for c in d['characters'] if c.get('region') == 'panel' and c.get('voice')}
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

if dups or cross or mismatch or canon_fail:
    raise SystemExit('FAILED')
