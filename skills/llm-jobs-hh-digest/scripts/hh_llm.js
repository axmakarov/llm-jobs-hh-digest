// LLMD — сбор LLM-вакансий на hh.ru из вкладки браузера (выполнять на странице https://hh.ru/...)
window.LLMD = window.LLMD || {};
Object.assign(window.LLMD, {
  NAME_QUERIES: ['LLM','GenAI','генеративн','RAG','NLP','промпт','prompt','AI engineer','AI-инженер','ИИ-инженер','AI-агент','агент ИИ',
    'LLMOps','AI developer','AI-разработчик','ИИ-разработчик','ML engineer','ML-инженер','data scientist','AI architect','AI-архитектор','AI lead','AI product'],
  TITLE_RE: /llm|gen ?ai|генератив|\brag\b|nlp|prompt|промпт|(^|[^a-zа-яё])(ai|ии|ml|cv)([^a-zа-яё]|$)|искусствен|нейро|neural|machine learning|машинн|data scien|deep learning|agent|агент|r&d|research|исследоват|mlops|llmops|transformer|гигачат|gigachat|kandinsky|вайбкод|vibe|aiaas|yandexgpt|cuda/i,
  CORE_TITLE_RE: /llm|gen ?ai|генератив|\brag\b|nlp|prompt|промпт|агент|agent|gigachat|гигачат|языков/i,
  TERM_RE: /(^|[^a-zа-яё])(llms?|large language|gpt|gigachat|гигачат|yandexgpt|langchain|langgraph|llamaindex|rag|fine-?tun\w*|файнтюн\w*|дообуч\w*|промпт\w*|prompt\w*|vllm|sglang|ollama|hugging ?face|трансформер\w*|transformers?|ai-агент\w*|ии-агент\w*|агентн\w*|mcp|embeddings?|эмбеддинг\w*|векторн\w*|qwen|llama|mistral|claude|openai|anthropic|genai|генеративн\w*|языков\w* модел\w*|sft|rlhf|dpo|lora)(?=[^a-zа-яё]|$)/gi,
  log: [],
  save(k, v) { try { localStorage.setItem('llmd_' + k, JSON.stringify(v)); } catch (e) {} },
  load(k) { try { return JSON.parse(localStorage.getItem('llmd_' + k) || 'null'); } catch (e) { return null; } },
  cleanup() { ['jobs', 'det'].forEach(k => localStorage.removeItem('llmd_' + k)); return 'cleaned'; },
  sleep: ms => new Promise(r => setTimeout(r, ms)),

  // 1) Поиск: страницы выдачи грузятся в скрытых iframe (выдача дорисовывается скриптом, fetch отдаёт только 20 карточек)
  frame(u) {
    return new Promise(res => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-5000px;width:1200px;height:900px'; f.src = u; document.body.appendChild(f);
      let t = 0; const iv = setInterval(() => {
        t += 500; let n = 0, h = null;
        try { n = f.contentDocument.querySelectorAll('[data-qa="vacancy-serp__vacancy"]').length; h = f.contentDocument.querySelector('[data-qa="title"], h1'); } catch (e) {}
        if ((h && (n >= 100 || (t > 4000 && n > 0) || /ничего не найдено/.test(h.textContent))) || t > 15000) { clearInterval(iv); setTimeout(() => res(f), 300); }
      }, 500);
    });
  },
  async grab(text, field, period) {
    let page = 0, got = 0, total = '';
    while (page < 20) {
      const u = `/search/vacancy?text=${encodeURIComponent(text)}&search_period=${period}&order_by=publication_time&items_on_page=100&page=${page}` + (field ? `&search_field=${field}` : '');
      const f = await this.frame(u), d = f.contentDocument;
      if (/captcha/.test(f.contentWindow.location.href)) { this.captcha = true; f.remove(); break; }
      total = (d.querySelector('[data-qa="title"], h1') || {}).textContent || '';
      const cards = [...d.querySelectorAll('[data-qa="vacancy-serp__vacancy"]')];
      for (const c of cards) {
        const a = c.querySelector('a[data-qa="serp-item__title"]'); if (!a) continue;
        const id = (a.href.match(/vacancy\/(\d+)/) || [])[1]; if (!id) continue;
        if (!this.jobs[id]) this.jobs[id] = { id, title: a.textContent.trim(), queries: [] };
        this.jobs[id].queries.push(text + (field ? '@name' : '@text')); got++;
      }
      f.remove();
      if (cards.length < 100) break; page++;
    }
    this.log.push(`${text}${field ? ' (название)' : ' (полный текст)'}: ${got} / ${total}`);
  },
  async collect(period) {           // period: 1 | 3 | 7 | 30 — наименьшее окно hh, покрывающее диапазон
    this.jobs = this.load('jobs') || {}; this.collectDone = false; this.captcha = false;
    for (const q of this.NAME_QUERIES) { if (this.captcha) break; await this.grab(q, 'name', period); }
    if (!this.captcha) await this.grab('LLM', null, period);
    this.save('jobs', this.jobs); this.collectDone = true;
  },

  // 2) Детали: по одной вакансии, пауза 1,2–2 с; при капче — стоп (пройти её должен человек), затем вызвать details() снова
  decode(s) { const y = document.createElement('div'); y.innerHTML = (s || '').replace(/<\/(p|li|ul|h\d)>/g, '\n').replace(/<br\s*\/?>/g, '\n'); return y.textContent.replace(/\n{2,}/g, '\n').trim(); },
  async details() {
    this.jobs = this.jobs || this.load('jobs') || {}; this.det = this.det || this.load('det') || {};
    this.captcha = false; this.detDone = false; this.detErr = [];
    const ids = Object.values(this.jobs).filter(j => j.queries.some(q => q.endsWith('@text')) || this.TITLE_RE.test(j.title)).map(j => j.id);
    this.queue = ids.length; let k = 0;
    for (const id of ids) {
      if (this.stop) break; if (this.det[id]) continue;
      try {
        const r = await fetch('/vacancy/' + id, { credentials: 'include' });
        if (/captcha/.test(r.url)) { this.captcha = true; break; }
        if (r.status !== 200) { this.detErr.push(id + ' ' + r.status); continue; }
        const d = new DOMParser().parseFromString(await r.text(), 'text/html');
        const t = d.querySelector('#HH-Lux-InitialState'); const j = JSON.parse(t.innerHTML);   // innerHTML: у <template> textContent пуст
        const v = j.vacancyView.vacancyFull.vacancy;
        this.det[id] = { name: v.name, company: (v.company || {}).name, area: (v.area || {}).name, country: (v.area || {}).countryIsoCode,
          pub: v.publicationTimeIso, exp: v.workExperience, formats: v.workFormats, comp: v.compensation, skills: v.keySkills,
          archived: (v.status || {}).archived, desc: this.decode(v.description).slice(0, 6000) };
      } catch (e) { this.detErr.push(id + ' ' + e.message); }
      if (++k % 20 === 0) this.save('det', this.det);
      await this.sleep(1200 + Math.random() * 800);
    }
    this.save('det', this.det); this.detDone = !this.captcha;
  },
  progress() { return { found: Object.keys(this.jobs || {}).length, queue: this.queue, fetched: Object.keys(this.det || {}).length, captcha: !!this.captcha, collectDone: !!this.collectDone, detDone: !!this.detDone, errors: (this.detErr || []).length, log: this.log }; },

  // 3) Отбор и статистика за диапазон [from, to] (YYYY-MM-DD, включительно)
  score(d) {
    const txt = d.name + '\n' + (d.skills || []).join(', ') + '\n' + d.desc;
    const m = [...txt.matchAll(this.TERM_RE)].map(x => x[2].toLowerCase());
    return { hits: m.length, distinct: [...new Set(m)].length, terms: [...new Set(m)] };
  },
  canon(t) {
    if (/^llms?$|large language|языков/.test(t)) return 'LLM';
    if (/^(prompt|промпт)/.test(t)) return 'Промпты';
    if (/fine-?tun|файнтюн|дообуч/.test(t)) return 'Fine-tuning';
    if (/gigachat|гигачат/.test(t)) return 'GigaChat';
    if (/embedding|эмбеддинг/.test(t)) return 'Эмбеддинги';
    if (/^openai$/.test(t)) return 'OpenAI API';
    if (/hugging/.test(t)) return 'Hugging Face';
    if (/агент/.test(t)) return 'AI-агенты';
    const map = { rag: 'RAG', mcp: 'MCP', vllm: 'vLLM', sglang: 'SGLang', ollama: 'Ollama', langchain: 'LangChain', langgraph: 'LangGraph', llamaindex: 'LlamaIndex',
      claude: 'Claude', qwen: 'Qwen', llama: 'Llama', mistral: 'Mistral', lora: 'LoRA', sft: 'SFT', rlhf: 'RLHF', dpo: 'DPO', genai: 'GenAI', anthropic: 'Anthropic', gpt: 'GPT', yandexgpt: 'YandexGPT' };
    return map[t] || null;
  },
  analyze(from, to) {
    this.det = this.det || this.load('det') || {};
    const lo = new Date(from + 'T00:00:00+03:00'), hi = new Date(to + 'T23:59:59+03:00');
    const groups = {};
    for (const [id, d] of Object.entries(this.det)) {
      if (d.archived) continue;
      const p = new Date(d.pub); if (p < lo || p > hi) continue;
      const s = this.score(d);
      if (!((s.hits >= 5 && s.distinct >= 3) || (this.CORE_TITLE_RE.test(d.name) && s.hits >= 2))) continue;
      const key = (d.name + '|' + d.company).toLowerCase().replace(/\s+/g, ' ');
      (groups[key] = groups[key] || []).push({ id, d, s });
    }
    const reps = Object.values(groups).map(g => { g.sort((a, b) => b.d.pub.localeCompare(a.d.pub)); return { ...g[0], cities: g.map(x => x.d.area) }; });
    this.reps = reps;
    const cnt = a => { const m = {}; a.forEach(x => m[x] = (m[x] || 0) + 1); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const fmt = f => (f || []).includes('REMOTE') ? 'remote' : (f || []).includes('HYBRID') ? 'hybrid' : (f || []).includes('ON_SITE') ? 'office' : 'unknown';
    const rub = reps.map(r => r.d.comp).filter(c => c && c.currencyCode === 'RUR' && (c.mode || 'MONTH') === 'MONTH')
      .map(c => { const k = c.gross ? 0.87 : 1, a = c.from ? c.from * k : null, b = c.to ? c.to * k : null; return a && b ? (a + b) / 2 : (a || b); }).sort((a, b) => a - b);
    const q = p => rub.length ? Math.round(rub[Math.floor(rub.length * p)]) : null;
    const terms = {}; reps.forEach(r => new Set(r.s.terms.map(t => this.canon(t)).filter(Boolean)).forEach(t => terms[t] = (terms[t] || 0) + 1));
    // примерные курсы к рублю — только чтобы найти «потолок» вилок; в тексте зарплаты пишутся в исходной валюте
    const FX = { RUR: 1, USD: 90, EUR: 100, KZT: 0.18, UZS: 0.007, BYR: 28, GEL: 33, AZN: 53, AMD: 0.23, KGS: 1.05 };
    const rubEq = c => (c.to || c.from) * (FX[c.currencyCode] || 0) * (c.gross ? 0.87 : 1);
    const top = [...reps].filter(r => r.d.comp && r.d.comp.currencyCode && (r.d.comp.mode || 'MONTH') === 'MONTH')
      .sort((a, b) => rubEq(b.d.comp) - rubEq(a.d.comp)).slice(0, 3)
      .map(r => ({ id: r.id, company: r.d.company, comp: r.d.comp }));
    return {
      scanned: Object.keys(this.det).length, total: reps.length,
      byCountry: cnt(reps.map(r => r.d.country || '?')), topCompanies: cnt(reps.map(r => r.d.company)).slice(0, 8),
      exp: cnt(reps.map(r => r.d.exp)), formats: cnt(reps.map(r => fmt(r.d.formats))),
      salary: { withSalary: reps.filter(r => r.d.comp && r.d.comp.currencyCode).length, rubMonthly: rub.length, median: q(0.5), p25: q(0.25), p75: q(0.75), top },
      stack: Object.entries(terms).filter(([t]) => t !== 'LLM').sort((a, b) => b[1] - a[1]).slice(0, 13),
      byDay: cnt(reps.map(r => r.d.pub.slice(0, 10))).sort(),
      shortlist: [...reps].sort((a, b) => b.s.hits - a.s.hits).map(r => `${r.id} ${r.s.hits}/${r.s.distinct} ${r.d.name} — ${r.d.company}${r.cities.length > 1 ? ' ×' + r.cities.length : ''} | ${r.d.pub.slice(0, 10)}`)
    };
  },

  // 4) Выгрузка выбранных вакансий для пересказа (по 12–13 за вызов, чтобы ответ не обрезался)
  export(ids, chars = 1400) {
    return ids.map(id => {
      const d = this.det[id], r = (this.reps || []).find(x => x.id === id);
      return { id, name: d.name, company: d.company, area: d.area, cities: r ? r.cities.length : 1, pub: d.pub.slice(0, 10), exp: d.exp,
        formats: d.formats, comp: d.comp && d.comp.currencyCode ? [d.comp.from, d.comp.to, d.comp.currencyCode, d.comp.gross ? 'gross' : 'net', d.comp.mode] : null,
        desc: this.decode(d.desc).slice(0, chars) };
    });
  }
});
'LLMD ready';
