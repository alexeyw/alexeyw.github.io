#!/usr/bin/env python3
"""Build the dossier site.

Usage:  python3 dossier/_src/build.py [--offline] [--no-browser]

1. Checks the public facts (GitHub API through `gh`, store pages, every linked source) and stops
   if a verified source is gone. --offline reuses _src/facts.json.
2. Renders one static page per language: /, /es/, /ru/.
3. Prints the English page to Aleksei_Volodin_CV.pdf and captures the social preview with Chrome.
"""
import argparse
import datetime as dt
import html
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent
sys.path.insert(0, str(SRC))
import content as C  # noqa: E402

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
E = html.escape
UA = {'User-Agent': 'Mozilla/5.0 (dossier link check)', 'Accept-Language': 'en'}


def gh(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def fetch(url, headers=UA):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def gather():
    """Every figure the page calls verified comes from here."""
    repo = gh('repos/alexeyw/knotwork')
    tags = subprocess.check_output(['gh', 'api', '--paginate', 'repos/alexeyw/knotwork/tags', '--jq', 'length'], text=True).split()
    people = gh('repos/alexeyw/knotwork/contributors')
    window = gh('repos/alexeyw/knotwork/commits?per_page=30')
    agent = sum(1 for c in window if re.search(r'Co-Authored-By: Claude', c['commit']['message'], re.I))
    prs = gh('search/issues?q=repo:alexeyw/knotwork+is:pr+is:merged&per_page=1')['total_count']
    tree = gh('repos/alexeyw/knotwork/git/trees/main?recursive=1')
    if tree['truncated']:
        sys.exit('GitHub truncated the tree listing, so the screenshot count would be wrong.')
    paths = [n['path'] for n in tree['tree']]
    # Google Play puts the rating markup only in the page it serves to plain HTTP clients.
    _, page = fetch(C.PLAY_SEEDS + '&hl=en', {'User-Agent': 'curl/8.7.1', 'Accept-Language': 'en'})

    def pick(pattern):
        found = re.search(pattern, page)
        if not found:
            sys.exit(f'Google Play page no longer matches {pattern!r}; fix the pattern before calling the figure verified.')
        return found.group(1)

    return {
        'stars': repo['stargazers_count'],
        'forks': repo['forks_count'],
        'release': gh('repos/alexeyw/knotwork/releases/latest')['tag_name'].lstrip('v'),
        'releases': sum(map(int, tags)),
        'commits': sum(p['contributions'] for p in people),
        'agent': agent,
        'window': len(window),
        'prs': prs,
        'golden': sum(1 for x in paths if re.search(r'src/test/snapshots/.*\.png$', x)),
        'workflows': sum(1 for x in paths if x.startswith('.github/workflows/') and x.endswith('.yml')),
        'seeds_downloads': pick(r'>([0-9.,]+[KMB]?\+)</div><div[^>]*>Downloads'),
        'seeds_rating': '%.1f' % float(pick(r'"ratingValue":"([^"]+)"')),
        'seeds_ratings': pick(r'"ratingCount":"([^"]+)"'),
        'seeds_updated': pick(r'Updated on</div><div[^>]*>([^<]+)'),
    }


def check_links():
    urls = {r['src'] for r in C.RECORDS if r.get('src')}
    urls |= {u for case in C.CASES for _, u in case['links']}
    urls |= {C.MURUNA, 'https://github.com/alexeyw', C.CERT_URL}
    bad = []
    for u in sorted(urls):
        try:
            code, _ = fetch(u)
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:  # network errors are failures too
            code = repr(e)
        print(f'  {code}  {u}')
        if code != 200:
            bad.append(u)
    if bad:
        sys.exit('A cited source is not answering, so its claim cannot be called verified:\n  ' + '\n  '.join(bad))


PAPER_H = {
    'en': {'chronicle': 'Experience', 'cases': 'Selected projects', 'caps': 'Skills', 'papers': 'Education and languages'},
    'es': {'chronicle': 'Experiencia', 'cases': 'Proyectos destacados', 'papers': 'Educación e idiomas'},
    'ru': {'chronicle': 'Опыт работы', 'cases': 'Избранные проекты', 'papers': 'Образование и языки'},
}


def L(v, lang):
    return v if isinstance(v, str) else v[lang]


def filler(facts):
    def fill(s):
        return re.sub(r'\{\{(\w+)\}\}', lambda m: str(facts[m.group(1)]), s)
    return fill


def fmt_date(s, lang):
    if s == 'now':
        return C.UI[lang]['now']
    y, _, m = s.partition('-')
    return f'{C.MON[lang][int(m) - 1]} {y}' if m else y


def when(r, lang):
    if not r.get('from'):
        return ''
    a = fmt_date(r['from'], lang)
    return f"{a} – {fmt_date(r['to'], lang)}" if r.get('to') else a


def rd(n):
    return f'<span class="rd wh" style="--n:{n}"></span>'


def ul(items, fill):
    if not items:
        return ''
    return '<ul>' + ''.join(f'<li>{E(fill(i))}</li>' for i in items) + '</ul>'


def counts():
    return tuple(sum(1 for r in C.RECORDS if r['s'] == x) for x in 'vsk')


def data_blob(lang, fill, checked):
    t = C.UI[lang]
    strip = lambda s: re.sub(r'\[#\d+\]', ' ', fill(s))
    records = []
    for r in C.RECORDS:
        titles = [r['t']] if isinstance(r['t'], str) else list(r['t'].values())
        labels = [r['l']] if isinstance(r['l'], str) else list(r['l'].values())
        rec = {k: r[k] for k in ('id', 'k', 's', 'py', 'a') if k in r}
        rec.update({'from': r.get('from'), 'px': r.get('px'), 't': L(r['t'], lang), 'l': L(r['l'], lang), 'x': fill(r['x'][lang]), 'w': when(r, lang),
                    'src': r.get('src'), 'sl': r.get('sl'), 'legacy': bool(r.get('legacy')),
                    'ia': ' '.join(titles + labels), 'ib': r['kw'], 'ic': ' '.join(strip(s) for s in r['x'].values())})
        records.append(rec)
    nv, ns, nk = counts()
    boot = [s.format(n=len(records), e=len(C.LINKS), v=nv, s=ns, k=nk, w=C.WITHHELD) for s in t['boot']]
    js = {k: t[k] for k in ('stV', 'stS', 'stK', 'srcK', 'withheld', 'checked', 'srcCv', 'cvDate', 'empty', 'rest', 'legacy', 'all', 'chips', 'copy', 'copied', 'denied')}
    js['boot'] = boot
    blob = {'lang': lang, 'checked': checked, 't': js, 'records': records, 'links': C.LINKS}
    return json.dumps(blob, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def first_screen(lang, base, langs_nav, checked, nv, ns, nk):
    t = C.UI[lang]
    return f'''<div class="sheet" id="top">
  <header class="bar">
    <div class="bar-l"><span>{E(t['file'])}</span><span>{E(t['clr'])}</span><span>{E(t['sync'])} {checked}</span></div>
    <nav class="langs" aria-label="Language">{langs_nav}</nav>
  </header>
  <main class="main">
    <section class="subject" aria-labelledby="nm">
      <h1 class="name" id="nm"><span>{E(t['first'])}</span> <span>{E(t['last'])}</span></h1>
      <p class="role">{E(t['role'])}</p>
      <p class="note"><b>{E(t['noteL'])}</b><span>{E(t['note'])}</span></p>
      <dl class="fields">
        <div><dt>{E(t['fBased'])}</dt><dd>{E(t['vBased'])}</dd></div>
        <div><dt>{E(t['fNow'])}</dt><dd>Senior Android Developer, Muruna</dd></div>
        <div><dt>{E(t['fClients'])}</dt><dd>{rd(6)}&ensp;{rd(10)}</dd></div>
        <div><dt>{E(t['fRecord'])}</dt><dd>{E(t['vRecord'])}</dd></div>
        <div><dt>{E(t['fLang'])}</dt><dd>{E(t['vLang'])}</dd></div>
        <div><dt>{E(t['fPhone'])}</dt><dd>{rd(13)}</dd></div>
      </dl>
      <div class="cta">
        <button class="btn js-contact" type="button">{E(t['contact'])}</button>
        <a class="lnk" href="{base}Aleksei_Volodin_CV.pdf">{E(t['pdf'])} ↓</a>
        <a class="lnk" href="https://github.com/alexeyw" target="_blank" rel="noopener">GitHub ↗</a>
        <a class="lnk" href="https://www.linkedin.com/in/alexeyw" target="_blank" rel="noopener">LinkedIn ↗</a>
      </div>
    </section>
    <section class="right">
      <div class="field" id="field">
        <canvas id="terrain" aria-hidden="true"></canvas>
        <svg id="map" role="group" aria-label="{E(t['mapcap'])}"></svg>
        <p class="mapcap">{E(t['mapcap'])}</p>
      </div>
      <div class="console">
        <form class="q" id="qf" role="search">
          <label class="qlab" for="q">{E(t['ask'])}</label>
          <input id="q" name="q" autocomplete="off" spellcheck="false" placeholder="{E(t['ph'])}">
          <kbd>/</kbd>
        </form>
        <div class="chips" id="chips"></div>
        <div class="out" id="out" aria-live="polite"></div>
      </div>
    </section>
  </main>
  <footer class="legend">
    <span><i class="g v"></i>{E(t['stV'])} <b>{nv}</b></span>
    <span><i class="g s"></i>{E(t['stS'])} <b>{ns}</b></span>
    <span><i class="g k"></i>{E(t['stK'])} <b>{nk}</b></span>
    <span><i class="rd"></i>{E(t['stW'])} <b>{C.WITHHELD}</b></span>
    <a class="more" href="#file">{E(t['more'])} ↓</a>
    <span id="status" role="status"></span>
    <span class="tail">{E(t['local'])}</span>
  </footer>
</div>'''


def case_html(c, lang, base, fill, checked):
    t = C.UI[lang]
    evidence = ''.join(f'<div><dt>{E(C.LBL[k][lang])}</dt><dd>{E(fill(v))}</dd></div>' for k, v in c['ev'])
    links = ' '.join(f'<a href="{E(u)}" target="_blank" rel="noopener">{E(n)}<span class="ar"> ↗</span></a>' for n, u in c['links'])
    shots = ''.join(f'<figure style="--w:{min(w, 256) if w == h else 200}px"><img src="{base}assets/{f}" width="{w}" height="{h}" loading="lazy" alt="{E(cap[lang])}"><figcaption>{E(cap[lang])}</figcaption></figure>' for f, w, h, cap in c['shots'])
    return f'''<article class="case" id="case-{c['id']}">
  <header class="case-h"><h3>{E(c['name'])}</h3><span class="stamp v">{E(t['stV'])}</span><span class="chk">{E(t['checked'])} {checked}</span></header>
  <p class="kicker">{E(c['kicker'][lang])}</p>
  <div class="case-g">
    <div class="case-t"><p>{E(c['lede'][lang])}</p>{ul(c['points'][lang], fill)}</div>
    <div class="case-s"><dl class="ev">{evidence}</dl><p class="case-l">{links}</p></div>
  </div>
  <div class="shots">{shots}</div>
</article>'''


def job_html(j, lang):
    t = C.UI[lang]
    org = L(j['org'], lang)
    org_html = f'<a href="{E(j["href"])}" target="_blank" rel="noopener">{E(org)}</a>' if j.get('href') else E(org)
    note = f'<p class="cl-note">{E(t["clientsNote"])} <a href="{E(j["href"])}" target="_blank" rel="noopener">{E(t["clientsSite"])} ↗</a>.</p>' if j.get('clients') else ''
    old = f'<button class="oldbtn" type="button" data-legacy="1">{E(t["legacy"])}</button>' if j.get('legacy') else ''
    return f'''<article class="job">
  <time>{E(when(j, lang))}</time>
  <div><h3>{E(L(j['title'], lang))}<span class="org">, {org_html}</span></h3>
  <p class="where">{E(j['where'][lang])}</p>{ul(j['points'][lang], str)}{note}{old}</div>
</article>'''


def doc_html(lang, base, fill, checked):
    t = C.UI[lang]
    sections = [('summary', t['sSummary'], None), ('cases', t['sCases'], len(C.CASES)), ('ai', t['sAI'], len(C.AI_NATIVE)), ('chronicle', t['sChron'], len(C.CHRONICLE)),
                ('caps', t['sCaps'], len(C.CAPS)), ('ref', t['sRef'], None), ('papers', t['sPapers'], None)]
    index = ''.join(f'<a href="#sec-{i}"><span>{E(n)}</span><i>{c if c else ""}</i></a>' for i, n, c in sections)
    title = {i: f'<span class="scr">{E(n)}</span><span class="prn">{E(PAPER_H[lang].get(i, n))}</span>' for i, n, _ in sections}
    cases =''.join(case_html(c, lang, base, fill, checked) for c in C.CASES)
    jobs = ''.join(job_html(j, lang) for j in C.CHRONICLE)
    ai = ''
    for a in C.AI_NATIVE:
        ev = E(fill(a['ev'][lang])) if a.get('ev') else E(t['srcK'])
        ai += f'<div class="cap"><h3>{E(a["t"])}</h3><div><p>{E(a["x"][lang])}</p><p class="cap-e"><i class="g {a["s"]}"></i>{ev}</p></div></div>'
    caps = ''
    for c in C.CAPS:
        ev = E(fill(c['ev'][lang])) if c.get('ev') else E(t['stS'])
        caps += f'<div class="cap"><h3>{E(L(c["l"], lang))}</h3><div><p>{E(c["items"])}</p><p class="cap-e"><i class="g {c["s"]}"></i>{ev}</p></div></div>'
    ref = ''.join(f'<li>{E(x)}</li>' for x in t['ref'])
    return f'''<div class="doc" id="file">
  <nav class="index" aria-label="{E(t['index'])}"><b>{E(t['index'])}</b>{index}<a class="up" href="#top"><span>↑ AV-0001</span></a></nav>
  <div class="body">
    <header class="pr-head">
      <h1>{E(t['first'])} {E(t['last'])}</h1>
      <p class="pr-role">{E(t['role'])}</p>
      <p class="pr-contact">{E(t['vBased'])} · <a class="pr-mail" href="mailto:alexeyw@gmail.com">alexeyw@gmail.com</a> · github.com/alexeyw · linkedin.com/in/alexeyw · alexeyw.github.io</p>
    </header>
    <section class="sec" id="sec-summary"><h2>{title['summary']}</h2><p class="sum">{E(t['summary'])}</p><p class="sum-s"><span class="stamp s">{E(t['stS'])}</span><span class="chk">{E(t['srcCv'])}, {E(t['cvDate'])}</span></p></section>
    <section class="sec" id="sec-cases"><h2>{title['cases']}</h2>{cases}</section>
    <section class="sec" id="sec-ai"><h2>{title['ai']}</h2><p class="ref-i">{E(t['aiIntro'])}</p>{ai}</section>
    <section class="sec" id="sec-chronicle"><h2>{title['chronicle']}</h2><p class="sec-s"><span class="stamp s">{E(t['stS'])}</span><span class="chk">{E(t['srcCv'])}, {E(t['cvDate'])}</span></p>{jobs}</section>
    <section class="sec" id="sec-caps"><h2>{title['caps']}</h2>{caps}</section>
    <section class="sec" id="sec-ref"><h2>{title['ref']}</h2><p class="ref-i">{E(t['refIntro'])}</p><ul class="ref">{ref}</ul><p class="sum-s"><span class="stamp k">{E(t['stK'])}</span><span class="chk">{E(t['refFoot'])}</span></p></section>
    <section class="sec" id="sec-papers"><h2>{title['papers']}</h2>
      <div class="cap"><h3>{E(t['pEdu'])}</h3><div><p>{E(t['vEdu'])}</p></div></div>
      <div class="cap"><h3>{E(t['pCert'])}</h3><div><p><a href="{C.CERT_URL}" target="_blank" rel="noopener">GitHub Copilot, Microsoft</a>, {E(t['vCert'])}; {E(C.CERT)}</p><p class="cap-e"><i class="g v"></i>GitHub Copilot: learn.microsoft.com, {E(t['checked'])} {checked}</p></div></div>
      <div class="cap"><h3>{E(t['pLangs'])}</h3><div><p>{E(t['vLangs'])}</p></div></div>
    </section>
    <footer class="end"><button class="btn js-contact" type="button">{E(t['contact'])}</button><p>{E(t['kept'])} {checked}.</p></footer>
  </div>
</div>'''


def dialogs(lang):
    t = C.UI[lang]
    args = E(json.dumps({'to': 'Aleksei Volodin', 'channel': 'email', 'risk': t['risk']}, ensure_ascii=False, indent=2))
    return f'''<dialog id="approve" aria-labelledby="apT"><div class="ap">
  <h2 id="apT">{E(t['apT'])}</h2>
  <div id="apAsk" class="ap-s"><p>{t['apQ']}</p><pre>{args}</pre>
    <div class="acts"><button class="ghost" id="apDeny" type="button">{E(t['deny'])}</button><button class="btn" id="apAllow" type="button">{E(t['allow'])}</button></div></div>
  <div id="apOk" class="ap-s" hidden><p>{E(t['granted'])}</p><output id="apMail"></output>
    <div class="acts"><button class="ghost" id="apCopy" type="button">{E(t['copy'])}</button><a class="btn" id="apSend">{E(t['send'])}</a><button class="ghost" id="apClose" type="button">{E(t['close'])}</button></div></div>
</div></dialog>
<dialog id="legacy" aria-labelledby="lgT"><div class="w2k" lang="ru">
  <div class="cp"><span id="lgT">Справочник: Эпохи — 2003–2012</span><button class="x" id="lgX" type="button" aria-label="Закрыть">×</button></div>
  <div class="mn" aria-hidden="true"><span>Файл</span><span>Операции</span><span>Справочники</span><span>Отчеты</span><span>Помощь</span></div>
  <div class="fb">
    <div class="r"><span>Код:</span><div class="i">000000001</div></div>
    <div class="r"><span>Период:</span><div class="i">2003 – 2012</div></div>
    <div class="r"><span>Должность:</span><div class="i">Аналитик, инженер ПО, фриланс</div></div>
    <div class="r"><span>Стек:</span><div class="i">1С · C++ · SQL</div></div>
    <div class="r"><span>Образование:</span><div class="i">BS in Computer Science, Serpukhov Technical College</div></div>
    <div class="r"><span>Статус:</span><div class="i">Перемещено в архив</div></div>
  </div>
  <div class="ms">Документ проведен. Эпоха закрыта, субъект ушел в Android.</div>
  <div class="bs"><button class="b" id="lgOk" type="button">OK</button></div>
</div></dialog>'''


def page(lang, facts, checked):
    t = C.UI[lang]
    fill = filler(facts)
    base = '' if lang == 'en' else '../'
    path = '' if lang == 'en' else f'{lang}/'
    nv, ns, nk = counts()
    nav = ''
    for l in C.LANGS:
        target = base + ('' if l == 'en' else f'{l}/') or './'
        current = ' aria-current="page"' if l == lang else ''
        nav += f'<a href="{target}index.html" hreflang="{l}"{current}>{l.upper()}</a>'
    alternates = ''.join(f'<link rel="alternate" hreflang="{l}" href="{C.SITE}{"" if l == "en" else l + "/"}">' for l in C.LANGS)
    person = json.dumps({'@context': 'https://schema.org', '@type': 'Person', 'name': 'Aleksei Volodin', 'jobTitle': 'Senior Android Engineer, AI Native Engineer', 'url': C.SITE,
                         'address': {'@type': 'PostalAddress', 'addressLocality': 'Santiago', 'addressCountry': 'CL'},
                         'knowsLanguage': ['en', 'es', 'ru'], 'sameAs': ['https://github.com/alexeyw', 'https://www.linkedin.com/in/alexeyw']}, separators=(',', ':'))
    return f'''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{E(t['title'])}</title>
<meta name="description" content="{E(t['desc'])}">
<link rel="canonical" href="{C.SITE}{path}">
{alternates}
<meta property="og:type" content="profile">
<meta property="og:title" content="{E(t['title'])}">
<meta property="og:description" content="{E(t['desc'])}">
<meta property="og:url" content="{C.SITE}{path}">
<meta property="og:image" content="{C.SITE}assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0c11">
<link rel="icon" href="{base}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@300;400;500&family=Martian+Mono:wdth,wght@75..112.5,200..600&display=swap">
<link rel="stylesheet" href="{base}assets/site.css">
<script type="application/ld+json">{person}</script>
</head>
<body>
{first_screen(lang, base, nav, checked, nv, ns, nk)}
{doc_html(lang, base, fill, checked)}
{dialogs(lang)}
<script type="application/json" id="dossier-data">{data_blob(lang, fill, checked)}</script>
<script src="{base}assets/site.js"></script>
</body>
</html>
'''


FAVICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a0c11"/><g fill="none" stroke="#e1ac6e"><ellipse cx="17" cy="15" rx="12" ry="9.5" opacity=".4"/><ellipse cx="18" cy="15" rx="8" ry="6.2" opacity=".7"/></g><circle cx="19" cy="15" r="3.2" fill="#e1ac6e"/></svg>
'''


def browser(*args):
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={profile}', *args], check=True, capture_output=True, timeout=120)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    store = SRC / 'facts.json'
    if a.offline:
        saved = json.loads(store.read_text())
        facts, checked = saved['facts'], saved['checked']
    else:
        print('checking public sources')
        check_links()
        facts, checked = gather(), dt.date.today().isoformat()
        store.write_text(json.dumps({'checked': checked, 'facts': facts}, indent=2) + '\n')
    print(facts)
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    (assets / 'site.css').write_text((SRC / 'site.css').read_text())
    (assets / 'site.js').write_text((SRC / 'site.js').read_text())
    (assets / 'favicon.svg').write_text(FAVICON)
    (ROOT / '.nojekyll').write_text('')
    for lang in C.LANGS:
        target = ROOT / ('index.html' if lang == 'en' else f'{lang}/index.html')
        target.parent.mkdir(exist_ok=True)
        target.write_text(page(lang, facts, checked))
        print('wrote', target.relative_to(ROOT), target.stat().st_size)
    if not a.no_browser:
        url = (ROOT / 'index.html').as_uri()
        browser('--no-pdf-header-footer', f'--print-to-pdf={ROOT / "Aleksei_Volodin_CV.pdf"}', '--virtual-time-budget=9000', url)
        browser('--window-size=1200,630', f'--screenshot={assets / "og.png"}', '--virtual-time-budget=9000', url)
        print('wrote CV pdf', (ROOT / 'Aleksei_Volodin_CV.pdf').stat().st_size, 'og', (assets / 'og.png').stat().st_size)


if __name__ == '__main__':
    main()
