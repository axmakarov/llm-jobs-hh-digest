# -*- coding: utf-8 -*-
"""Сборка PDF-дайджеста LLM JOBS из digest.json.
Запуск: python3 build_digest.py digest.json out_dir
Нужны: weasyprint, шрифт Inter (fc-list | grep Inter), style.css рядом со скриптом."""
import json, math, random, html, sys, os
from datetime import date
from weasyprint import HTML

E = html.escape
def Q(s): return E(s).replace("'", "’")

CATEGORIES = [  # ключ, название, описание, цвет
    ("agents", "Агентные платформы и AI-продукты", "Строят агентов и LLM-продукты для клиентов и рынка", "#39C6FF"),
    ("corp",   "Корпоративные ассистенты и RAG", "Внедряют LLM во внутренние процессы компании", "#3B82F6"),
    ("train",  "Обучение и дообучение моделей", "SFT, alignment, обучение с нуля, R&D", "#9B8CFF"),
    ("infra",  "Инфраструктура, inference, LLMOps", "GPU, vLLM, LLM-шлюзы, on-prem платформы", "#34D3A6"),
    ("sec",    "Безопасность AI", "Атаки на LLM и агентов, защитные механизмы", "#FF7D8E"),
    ("eval",   "Оценка качества, промпты, аналитика", "Приёмки моделей, промпт-инжиниринг, анализ", "#F5C451"),
    ("lead",   "Руководство и архитектура", "Стратегия, команды, архитектура решений", "#C7D4F2"),
]

def is_remote(fmt): return "удал" in fmt.lower()

def plural(n, one, few, many):
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11: return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14: return few
    return many

def network_svg(w=420, h=470, n=70, seed=7):
    rnd = random.Random(seed); pts = []
    cx, cy, rx, ry = w * 0.55, h * 0.45, w * 0.42, h * 0.40
    while len(pts) < n:
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1: pts.append((x, y))
    lines = []
    for i, (x1, y1) in enumerate(pts):
        for _, j in sorted(((math.hypot(x1 - x2, y1 - y2), j) for j, (x2, y2) in enumerate(pts) if j != i))[:3]:
            if j > i:
                x2, y2 = pts[j]
                lines.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#3FA9FF" stroke-opacity="{0.18 + rnd.random()*0.25:.2f}" stroke-width="0.8"/>')
    dots = []
    for x, y in pts:
        c = "#8BF06A" if rnd.random() < 0.18 else ("#7FD8FF" if rnd.random() < 0.5 else "#3F8CFF")
        r = rnd.choice([1.6, 2.0, 2.4, 3.0])
        dots.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*3.2:.1f}" fill="{c}" fill-opacity="0.10"/>'
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*1.8:.1f}" fill="{c}" fill-opacity="0.22"/>'
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{c}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">' + "".join(lines) + "".join(dots) + "</svg>"

TG_SVG = ('<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3.5 11.6 19.6 5.4c.8-.3 1.5.2 1.2 1.4l-2.7 12.8c-.2.9-.8 1.1-1.5.7'
          'l-4.2-3.1-2 1.9c-.2.2-.4.4-.9.4l.3-4.3 7.8-7c.3-.3-.1-.5-.5-.2L7.5 14l-4.1-1.3c-.9-.3-.9-.9.1-1.1z" fill="#fff"/></svg>')

def pill(handle, url, extra=""):
    return (f'<span class="ring {extra}"><a class="pill {extra}" href="{E(url)}"><span class="tg">{TG_SVG}</span>'
            f'<span class="handle">{E(handle)}</span><span class="sub">Подписаться\u00a0\u00a0→</span></a></span>')

def marks(fmt, sal):
    out = [f'<span class="mark {"mark-remote" if is_remote(fmt) else "mark-fmt"}"><span class="mk">Формат</span>{E(fmt)}</span>']
    if sal: out.append(f'<span class="mark mark-salary"><span class="mk">Зарплата</span>{E(sal)}</span>')
    return "".join(out)

def ddmmyyyy(iso):
    y, m, d = iso.split("-"); return f"{d}.{m}.{y}"

def card(v, k, color):
    label = f"{k:02d} · {Q(v['role'])} — {Q(v['company'])}"
    return f'''
<div class="card" style="border-left-color:{color}">
  <div class="card-top"><span class="num" style="background:{color}">{k:02d}</span><span class="date">Опубликовано {ddmmyyyy(v["date"])}</span></div>
  <h3 class="role" style="bookmark-label:'{label}'">{E(v["role"])}</h3>
  <div class="company">{E(v["company"])}</div>
  <div class="marks">{marks(v["format"], v.get("salary", ""))}<span class="chip">{E(v["exp"])}</span><span class="chip">{E(v["city"])}</span></div>
  <p class="summary">{E(v["summary"])}</p>
  <a class="cta" href="https://hh.ru/vacancy/{E(v["id"])}">Открыть на hh.ru\u00a0\u00a0→</a>
</div>'''

def stack_bars(stack, total):
    mx = max(c for _, c in stack); out = []
    for i, (t, c) in enumerate(stack):
        out.append(f'<div class="bar"><span class="bl">{E(t)}</span><span class="bt"><span class="bf {"lead" if i == 0 else ""}" '
                   f'style="width:{c / mx * 100:.1f}%"></span><span class="bv">{round(c / total * 100)}%</span></span></div>')
    return "".join(out)

def build(data, out_dir):
    P, S, VV = data["period"], data["stats"], data["vacancies"]
    ch = data.get("channel", {"handle": "@llm_jobs", "url": "https://t.me/llm_jobs"})
    for i, v in enumerate(VV): v["_i"] = i
    n_all = len(VV)
    cards = []; k = 0
    for key, name, desc, color in CATEGORIES:
        # внутри группы — от новых к старым; в один день — в исходном порядке
        items = sorted([v for v in VV if v["cat"] == key], key=lambda v: (-date.fromisoformat(v["date"]).toordinal(), v["_i"]))
        if not items: continue
        cards.append(f'<h2 class="group" style="bookmark-label:\'{Q(name)}\'; border-bottom-color:{color}">'
                     f'<span class="gdot" style="color:{color}">●</span>{E(name)}<span class="gcount">{len(items)}</span>'
                     f'<span class="gdesc">{E(desc)}</span></h2>')
        for v in items:
            k += 1; cards.append(card(v, k, color))
    unknown = [v["id"] for v in VV if v["cat"] not in {c[0] for c in CATEGORIES}]
    if unknown: raise SystemExit(f"Неизвестная категория у вакансий: {unknown}")

    remote_n = sum(1 for v in VV if is_remote(v["format"]))
    salary_n = sum(1 for v in VV if v.get("salary"))
    facts = "".join(f'<div class="fact"><div class="fk">{E(f["k"])}</div><div class="fv">{E(f["v"])}</div></div>' for f in S["facts"])
    css = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.css"), encoding="utf-8").read()
    css = css.replace("__FOOTER__", f'LLM JOBS · вакансии в AI и LLM · {P["short"]}')

    doc = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>LLM JOBS — вакансии в AI и LLM, {E(P["label"])}</title>
<meta name="author" content="LLM JOBS · {E(ch["handle"])}">
<meta name="description" content="Подборка LLM-вакансий с hh.ru, {E(P["label"])}">
<style>{css}</style></head><body>
<section class="cover">
  <div class="net">{network_svg()}</div>
  <div class="brand">LLM <span>JOBS</span></div><div class="brand-line"></div>
  <h1 class="cover-title" style="bookmark-label:'Обложка'">ВАКАНСИИ<br/>В <span class="grad">AI и LLM</span></h1>
  <div class="cover-sub">Инженерам, аналитикам и продактам</div>
  <div class="cover-period">Подборка с hh.ru · {E(P["label"])}</div>
  <div class="tiles">
    <div class="tile"><b>{n_all}</b><span>{plural(n_all, "вакансия", "вакансии", "вакансий")} в подборке</span></div>
    <div class="tile"><b>{S["total"]}</b><span>LLM-{plural(S["total"], "вакансия", "вакансии", "вакансий")} за период</span></div>
    <div class="tile"><b>{remote_n}</b><span>из {n_all} — с удалёнкой</span></div>
    <div class="tile"><b>{salary_n}</b><span>из {n_all} — с зарплатой</span></div>
  </div>
  <div class="cover-how">Вакансии сгруппированы по ролям, внутри группы — от новых к старым. У каждой — формат работы, зарплата (если указана) и кнопка на hh.ru. Группы и вакансии есть в закладках PDF.</div>
  <div class="pill-wrap cover-pill">{pill(ch["handle"], ch["url"])}</div>
</section>
<section class="market">
  <h1 class="h1" style="bookmark-label:'Рынок за период'">Рынок за период</h1>
  <p class="lead">{E(S["lead"])}</p>
  <div class="facts">{facts}<div class="fact wide"><div class="fk">Зарплаты</div><div class="fv">{S["salary_html"]}</div></div></div>
  <div class="chart">
    <div class="ct">{E(S["chart_title"])}</div>
    <div class="cs">Доля вакансий, где упомянут инструмент или подход, % от {S["total"]}</div>
    {stack_bars(S["stack"], S["total"])}
    <div class="csrc">hh.ru, {S["total"]} LLM-вакансий за {E(P["short"])} · упоминания в описании и ключевых навыках</div>
  </div>
  <p class="body">{E(S["stack_note"])}</p>
  <div class="method"><b>Как собрана подборка.</b> {E(S["method"])}</div>
</section>
<section class="vac">
  <h1 class="h1 vac-h" style="bookmark-label:'Вакансии'">Вакансии</h1>
  {"".join(cards)}
  <div class="outro">
    <div class="brand small">LLM <span>JOBS</span></div>
    <p>Новые подборки и вакансии напрямую от работодателей — в Telegram-канале</p>
    <div class="pill-wrap">{pill(ch["handle"], ch["url"], "small")}</div>
  </div>
</section></body></html>'''
    os.makedirs(out_dir, exist_ok=True)
    name = data.get("filename") or f'LLM_JOBS_vakansii_{P["from"]}_{P["to"]}.pdf'
    open(os.path.join(out_dir, "digest.html"), "w", encoding="utf-8").write(doc)
    HTML(string=doc, base_url=out_dir).write_pdf(os.path.join(out_dir, name))
    print(os.path.join(out_dir, name))

if __name__ == "__main__":
    build(json.load(open(sys.argv[1], encoding="utf-8")), sys.argv[2] if len(sys.argv) > 2 else ".")
