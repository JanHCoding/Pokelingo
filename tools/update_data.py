#!/usr/bin/env python3
"""Lädt die Pokémon-Liste von PokéWiki neu und erzeugt data/pokemon.js + img/NNNN.png.

Aufruf (aus dem Repo-Ordner):  python3 tools/update_data.py [--images]
Nur nötig, wenn neue Pokémon dazukommen.
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Pokelingo personal learning app)'}
PAGE = 'Pok%C3%A9mon-Liste'
GEN_STARTS = [1, 152, 252, 387, 494, 650, 722, 810, 906]


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def main():
    wiki = json.loads(get(f'https://www.pokewiki.de/api.php?action=parse&page={PAGE}&prop=wikitext&format=json'))
    w = wiki['parse']['wikitext']['*']
    html = get(f'https://www.pokewiki.de/{PAGE}').decode('utf-8')
    imgs = {}
    for m in re.finditer(r'src="(/images/[^"]+/Pok%C3%A9mon-Icon_(\d+)\.png)"', html):
        imgs.setdefault(int(m.group(2)), 'https://www.pokewiki.de' + m.group(1))

    rows = []
    for line in w.split('\n'):
        m = re.match(r'\|\s*(?:<span id="nr\d+"></span>)?\s*(\d{4})\s*\|\|(.*)', line)
        if not m:
            continue
        nr = int(m.group(1))
        cells = [c.strip() for c in m.group(2).split('||')]
        de = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', cells[1]).strip()
        en = cells[2]
        types = re.findall(r'\{\{#ic:([^}]+)\}\}', cells[-1])
        gen = sum(1 for s in GEN_STARTS if nr >= s)
        rows.append([nr, de, en, types, gen])

    out = ('// Quelle: PokéWiki (https://www.pokewiki.de/Pok%C3%A9mon-Liste) – Felder: [Dex-Nr, Deutsch, Englisch, Typen, Generation]\n'
           'window.POKEMON = [\n' + ',\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n];\n')
    with open(os.path.join(ROOT, 'data', 'pokemon.js'), 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'{len(rows)} Pokémon geschrieben')

    if '--images' in sys.argv:
        os.makedirs(os.path.join(ROOT, 'img'), exist_ok=True)
        for nr, url in sorted(imgs.items()):
            path = os.path.join(ROOT, 'img', f'{nr:04d}.png')
            if os.path.exists(path) and os.path.getsize(path) > 0:
                continue
            with open(path, 'wb') as f:
                f.write(get(url))
            time.sleep(0.15)  # PokéWiki schonen
        print('Bilder aktuell')


if __name__ == '__main__':
    main()
