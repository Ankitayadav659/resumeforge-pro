/* ResumeForge Pro — Recruiter Lens: scoring, bullet rewriting, JD keyword match */
(function (RC) {
  'use strict';

  RC.ACTION_VERBS = {
    'Leadership': ['Led', 'Directed', 'Spearheaded', 'Orchestrated', 'Mentored', 'Championed', 'Headed', 'Mobilized', 'Oversaw', 'Scaled'],
    'Growth & Impact': ['Increased', 'Boosted', 'Accelerated', 'Grew', 'Expanded', 'Generated', 'Maximized', 'Exceeded', 'Delivered', 'Achieved'],
    'Efficiency': ['Reduced', 'Streamlined', 'Automated', 'Optimized', 'Consolidated', 'Eliminated', 'Cut', 'Simplified', 'Saved', 'Standardized'],
    'Technical': ['Engineered', 'Architected', 'Developed', 'Implemented', 'Designed', 'Deployed', 'Migrated', 'Integrated', 'Built', 'Debugged'],
    'Analysis': ['Analyzed', 'Evaluated', 'Forecasted', 'Identified', 'Modeled', 'Quantified', 'Researched', 'Assessed', 'Audited', 'Diagnosed'],
    'Communication': ['Negotiated', 'Presented', 'Persuaded', 'Authored', 'Partnered', 'Collaborated', 'Influenced', 'Facilitated', 'Advised', 'Trained'],
    'Creation': ['Launched', 'Created', 'Founded', 'Initiated', 'Pioneered', 'Introduced', 'Established', 'Conceptualized', 'Produced', 'Revamped']
  };

  const IRREGULAR = {
    build: 'built', lead: 'led', write: 'wrote', run: 'ran', make: 'made', drive: 'drove', grow: 'grew', sell: 'sold',
    oversee: 'oversaw', set: 'set', cut: 'cut', win: 'won', teach: 'taught', bring: 'brought', speak: 'spoke', begin: 'began',
    hold: 'held', ship: 'shipped', plan: 'planned', program: 'programmed', debug: 'debugged', handle: 'managed', found: 'founded'
  };

  const BASE_VERBS = ('develop create design manage launch improve increase reduce implement organize organise analyze analyse test deliver ' +
    'prepare conduct coordinate maintain support deploy automate optimize optimise train mentor migrate integrate research present negotiate ' +
    'establish streamline execute own resolve collaborate achieve generate define architect engineer direct supervise monitor evaluate identify ' +
    'partner enhance introduce refactor program debug publish secure close acquire recruit hire onboard expand accelerate boost consolidate ' +
    'eliminate simplify save standardize forecast model quantify assess audit diagnose persuade author influence facilitate advise initiate ' +
    'pioneer produce revamp transform restructure exceed champion orchestrate mobilize head build lead write run make grow sell oversee teach ' +
    'plan ship scale spearhead handle win cut set bring speak redesign upgrade measure track coach guide reorganize negotiate earn rank complete').split(/\s+/);
  const BASE_SET = new Set(BASE_VERBS);

  function past(v) {
    const l = v.toLowerCase();
    if (IRREGULAR[l]) return IRREGULAR[l];
    if (l.endsWith('e')) return l + 'd';
    if (/[^aeiou]y$/.test(l)) return l.slice(0, -1) + 'ied';
    return l + 'ed';
  }

  const STRONG = new Set();
  BASE_VERBS.forEach((b) => { if (b !== 'handle') { STRONG.add(b); STRONG.add(past(b)); } });
  Object.values(RC.ACTION_VERBS).flat().forEach((v) => STRONG.add(v.toLowerCase()));
  ['co-founded', 'co-led', 'co-authored', 'drove', 'won', 'ranked', 'earned', 'attained', 'captured', 'served', 'selected', 'awarded', 'received'].forEach((v) => STRONG.add(v));

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const firstWord = (s) => ((s.match(/^[A-Za-z][A-Za-z-]*/) || [''])[0]);
  const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

  function verbFromGerund(word) {
    const l = word.toLowerCase();
    if (!l.endsWith('ing') || l.length < 5) return null;
    const stem = l.slice(0, -3);
    const cands = [stem, stem + 'e', stem.slice(0, -1)];
    return cands.find((c) => BASE_SET.has(c)) || null;
  }

  const WEAK_PHRASES = ['responsible for', 'worked on', 'helped', 'assisted', 'duties included', 'involved in', 'participated in',
    'tasked with', 'in charge of', 'handled', 'was part of', 'various', 'etc.', 'successfully', 'tried to'];
  const CLICHES = ['hardworking', 'hard-working', 'hard working', 'team player', 'go-getter', 'go getter', 'self-motivated', 'highly motivated',
    'detail-oriented', 'results-driven', 'result-oriented', 'think outside the box', 'synergy', 'passionate', 'quick learner', 'fast learner',
    'dedicated', 'dynamic', 'challenging environment', 'challenging position', 'references available', 'excellent communication skills', 'best of my knowledge'];

  const REWRITES = [
    // "responsible for creating X" → strip, gerund rule turns "creating" into "Created"
    [/^(?:was\s+|am\s+)?(?:responsible\s+for|tasked\s+with|in\s+charge\s+of|involved\s+in|duties\s+included)\s+(?=[a-z]+ing\b)/i, '', 'Replaced passive duty phrase with an action verb'],
    [/^(?:was\s+|am\s+)?responsible\s+for\s+/i, 'Owned ', 'Replaced "responsible for" with an ownership verb'],
    [/^(?:was\s+|am\s+)?in\s+charge\s+of\s+/i, 'Led ', 'Replaced "in charge of" with "Led"'],
    [/^(?:was\s+|am\s+)?tasked\s+with\s+/i, 'Delivered ', 'Replaced "tasked with" with a results verb'],
    [/^worked\s+on\s+/i, 'Developed ', 'Replaced vague "worked on"'],
    [/^worked\s+with\s+/i, 'Collaborated with ', 'Replaced vague "worked with"'],
    [/^worked\s+as\s+/i, 'Served as ', 'Replaced "worked as"'],
    [/^helped\s+(?:to\s+)?([a-z]+)/i, (m, w) => (BASE_SET.has(w.toLowerCase()) ? 'Partnered to ' + w.toLowerCase() : 'Supported ' + w), 'Replaced weak "helped"'],
    [/^assisted\s+(?:in|with)\s+/i, 'Supported ', 'Replaced weak "assisted"'],
    [/^(?:was\s+)?(?:involved|participated)\s+in\s+/i, 'Contributed to ', 'Replaced passive participation phrase'],
    [/^(?:was\s+)?part\s+of\s+/i, 'Contributed to ', 'Replaced "part of"'],
    [/^handled\s+/i, 'Managed ', 'Replaced weak "handled"'],
    [/^did\s+/i, 'Executed ', 'Replaced weak "did"']
  ];

  RC.lines = function (t) {
    return String(t || '').split('\n').map((s) => s.replace(/^\s*[-•*·▪●]\s*/, '').trim()).filter(Boolean);
  };

  RC.improveBullet = function (raw, isCurrent) {
    const orig = String(raw).trim().replace(/^[-•*·▪●]\s*/, '');
    let s = orig;
    const notes = [];
    if (/^(i|we)\s+/i.test(s)) { s = s.replace(/^(i|we)\s+/i, ''); notes.push('Removed first-person pronoun'); }
    for (const [re, rep, note] of REWRITES) {
      if (re.test(s)) { s = s.replace(re, rep); notes.push(note); break; }
    }
    const fw = firstWord(s);
    const g = fw && verbFromGerund(fw);
    if (g) {
      s = cap(isCurrent ? g : past(g)) + s.slice(fw.length);
      notes.push('Start with a verb, not an "-ing" word');
    } else if (fw && !isCurrent) {
      const l = fw.toLowerCase();
      if (BASE_SET.has(l) && past(l) !== l && l !== 'handle') {
        s = cap(past(l)) + s.slice(fw.length);
        notes.push('Use past tense for previous roles');
      }
    }
    s = cap(s.replace(/\s+/g, ' ').trim()).replace(/\.\s*$/, '');
    const strong = STRONG.has(firstWord(s).toLowerCase());
    const hasNum = /\d/.test(s);
    const wc = wordCount(s);
    const advice = [];
    if (!strong) advice.push('Start with a strong action verb (Led, Built, Increased, Reduced…)');
    if (!hasNum) advice.push('Add a measurable result: %, ₹/$, time saved, users, team size, rank');
    if (wc < 6) advice.push('Too short — say what you did, how, and the result');
    if (wc > 32) advice.push('Too long — keep it under ~30 words (max 2 lines)');
    const lw = s.toLowerCase();
    CLICHES.concat(WEAK_PHRASES).forEach((c) => { if (lw.includes(c)) advice.push(`Remove filler phrase "${c}"`); });
    return { original: orig, improved: s, changed: s !== orig.replace(/\.\s*$/, ''), notes, advice, strong, hasNum, wc };
  };

  RC.bulletStats = function (text, isCurrent) {
    const ls = RC.lines(text);
    let strong = 0, num = 0;
    ls.forEach((l) => { if (STRONG.has(firstWord(l).toLowerCase())) strong++; if (/\d/.test(l)) num++; });
    return { count: ls.length, strong, num };
  };

  function collectBullets(r) {
    const out = [];
    r.experience.forEach((e) => RC.lines(e.bullets).forEach((t) => out.push({ text: t, current: !!e.current, src: 'experience' })));
    r.projects.forEach((p) => RC.lines(p.bullets).forEach((t) => out.push({ text: t, current: false, src: 'projects' })));
    if (r.mode === 'executive') r.achievements.forEach((a) => a.text.trim() && out.push({ text: a.text.trim(), current: false, src: 'achievements' }));
    return out;
  }
  RC.collectBullets = collectBullets;

  RC.allSkills = function (r) {
    return r.skills.flatMap((s) => String(s.items || '').split(/[,;|•\n]/).map((x) => x.trim()).filter(Boolean));
  };

  RC.yearsOfExperience = function (r) {
    let min = Infinity, max = -Infinity;
    const now = new Date().getFullYear();
    r.experience.forEach((e) => {
      const s = String(e.start).match(/(19|20)\d{2}/);
      const en = e.current ? [String(now)] : String(e.end).match(/(19|20)\d{2}/);
      if (s) min = Math.min(min, +s[0]);
      if (en) max = Math.max(max, +en[0]);
    });
    if (!isFinite(min) || !isFinite(max) || max < min) return 0;
    return max - min;
  };

  RC.fullText = function (r) {
    const p = r.personal;
    const parts = [p.fullName, p.title, r.summary, r.languages];
    r.experience.forEach((e) => parts.push(e.role, e.company, e.location, e.bullets));
    r.education.forEach((e) => parts.push(e.degree, e.institution, e.details, e.score));
    r.projects.forEach((e) => parts.push(e.name, e.tech, e.bullets));
    r.skills.forEach((e) => parts.push(e.category, e.items));
    r.certifications.forEach((e) => parts.push(e.name, e.issuer));
    r.achievements.forEach((e) => parts.push(e.text));
    return parts.filter(Boolean).join('\n');
  };

  /* ---------- Job-description keyword matching ---------- */
  const STOP = new Set(('a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its ' +
    'we you our your they their them he she his her who whom which what when where why how will would should could can may might must shall ' +
    'have has had do does did not no nor so than too very just also such into over under about across within without per via etc ' +
    'experience experiences years year work working team teams ability abilities strong skills skill knowledge good great excellent including ' +
    'role roles responsibilities responsibility requirements requirement required preferred plus candidate candidates job company looking ' +
    'join using use used well help ensure new high based related opportunity environment understanding minimum qualification qualifications ' +
    'apply able day days week other others any all each every some more most least many much both either neither one two three four five ' +
    'like make makes making take takes get gets need needs want wants able across part key based global world best level levels us ' +
    'equivalent field fields area areas preferably ideally desired desirable demonstrated proven solid hands deep wide range variety ' +
    'within across through while whether across around upon basis similar relevant related least including include includes').split(/\s+/));

  const KNOWN = new Set(('python java javascript typescript react angular vue node.js node sql nosql mysql postgresql mongodb aws azure gcp ' +
    'docker kubernetes terraform jenkins git linux excel tableau power powerbi looker sap salesforce hubspot figma jira agile scrum kanban ' +
    'spark hadoop kafka airflow snowflake pandas numpy tensorflow pytorch ml ai nlp llm genai c++ c# go golang rust kotlin swift flutter ' +
    'android ios html css rest graphql microservices devops ci/cd seo sem crm erp gaap ifrs cfa frm acca cpa sox pmp six sigma lean ' +
    'b2b b2c saas fintech ux ui analytics statistics forecasting budgeting stakeholder p&l').split(/\s+/));

  RC.extractKeywords = function (jd) {
    const text = String(jd || '').toLowerCase();
    if (!text.trim()) return [];
    const tokens = (text.match(/[a-z][a-z0-9+#.&\/-]*[a-z0-9+#]|[a-z]/g) || []).map((t) => t.replace(/[.\/-]+$/, ''));
    const freq = new Map(), bi = new Map();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.length < 2 || STOP.has(t)) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
      const n = tokens[i + 1];
      if (n && n.length > 1 && !STOP.has(n)) bi.set(t + ' ' + n, (bi.get(t + ' ' + n) || 0) + 1);
    }
    const cands = [];
    bi.forEach((c, k) => { if (c >= 2) cands.push([k, c * 1.6]); });
    freq.forEach((c, k) => {
      if (k.length >= 3 || /[+#&]/.test(k) || KNOWN.has(k)) cands.push([k, c + (KNOWN.has(k) ? 2 : 0)]);
    });
    cands.sort((a, b) => b[1] - a[1]);
    const out = [];
    for (const [k, w] of cands) {
      if (out.length >= 28) break;
      if (w < 2 && out.length >= 12) continue;
      const parts = k.split(' ');
      if (out.some((o) => o.split(' ').includes(k) || parts.includes(o))) continue;
      out.push(k);
    }
    return out;
  };

  function hasTerm(textLower, kw) {
    const variants = [kw];
    if (kw.endsWith('s') && kw.length > 4) variants.push(kw.slice(0, -1));
    else variants.push(kw + 's');
    return variants.some((v) => {
      const re = new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
      return re.test(textLower);
    });
  }

  RC.matchJD = function (r) {
    const kws = RC.extractKeywords(r.jd);
    if (!kws.length) return null;
    const t = RC.fullText(r).toLowerCase();
    const matched = [], missing = [];
    kws.forEach((k) => (hasTerm(t, k) ? matched : missing).push(k));
    return { keywords: kws, matched, missing, pct: Math.round((matched.length / kws.length) * 100) };
  };

  /* ---------- Summary drafting (rule-based, user edits afterwards) ---------- */
  RC.draftSummary = function (r) {
    const p = r.personal;
    const skills = RC.allSkills(r).slice(0, 4);
    const skillStr = skills.length > 1 ? skills.slice(0, -1).join(', ') + ' and ' + skills[skills.length - 1] : (skills[0] || '[your core skills]');
    const yrs = RC.yearsOfExperience(r);
    const proofB = collectBullets(r).find((b) => /\d/.test(b.text));
    const proof = proofB ? proofB.text.replace(/\.$/, '') : '';
    if (r.mode === 'fresher') {
      const ed = r.education[0] || {};
      const endY = parseInt((String(ed.end).match(/\d{4}/) || [0])[0], 10);
      const status = endY > new Date().getFullYear() ? 'student' : 'graduate';
      const projs = r.projects.filter((x) => x.name.trim());
      return [
        `${ed.degree ? ed.degree + ' ' + status : 'Recent graduate'}${ed.institution ? ' from ' + ed.institution : ''}${ed.score ? ' (' + ed.score + ')' : ''} with hands-on experience in ${skillStr}.`,
        projs.length ? `Built ${projs.length} project${projs.length > 1 ? 's' : ''} including ${projs[0].name.split(/[—–-]/)[0].trim()}${proof ? '; ' + proof.charAt(0).toLowerCase() + proof.slice(1) : ''}.` : (proof ? proof + '.' : ''),
        `Eager to contribute as ${p.title ? 'a ' + p.title : 'an entry-level professional'} in a high-performing team.`
      ].filter(Boolean).join(' ');
    }
    if (r.mode === 'executive') {
      return [
        `${p.title || '[Executive title]'} with ${yrs || 'XX'}+ years of leadership experience across ${skillStr}.`,
        proof ? `Proven record: ${proof.charAt(0).toLowerCase() + proof.slice(1)}.` : 'Proven record of [scaling teams / growing revenue / transforming operations].',
        'Trusted partner to CEOs and boards on [strategy, growth and transformation].'
      ].join(' ');
    }
    return [
      `${p.title || '[Your title]'} with ${yrs || 'X'}+ years of experience in ${skillStr}.`,
      proof ? `Recent impact: ${proof.charAt(0).toLowerCase() + proof.slice(1)}.` : 'Recent impact: [your biggest measurable win].',
      'Known for [2–3 strengths, e.g. stakeholder management, data-driven decisions, delivery under pressure].'
    ].join(' ');
  };

  /* ---------- Cover letter template (used when AI is off) ---------- */
  RC.draftCoverLetter = function (r, c) {
    const p = r.personal;
    const company = (c.company || '').trim() || '[Company]';
    const role = (c.role || p.title || '').trim() || '[Role]';
    const to = (c.manager || '').trim() || 'Hiring Manager';
    const yrs = RC.yearsOfExperience(r);
    const skills = RC.allSkills(r).slice(0, 3);
    const skillStr = skills.length > 1 ? skills.slice(0, -1).join(', ') + ' and ' + skills[skills.length - 1] : (skills[0] || '[your key skills]');
    const wins = collectBullets(r).filter((b) => /\d/.test(b.text)).slice(0, 3).map((b) => b.text.replace(/\.$/, ''));
    const latest = r.experience.find((e) => e.role || e.company);
    const ed = r.education.find((e) => e.degree);

    let intro;
    if (r.mode === 'fresher') {
      intro = `I am writing to apply for the ${role} position at ${company}. As ${ed ? (/^[aeiou]/i.test(ed.degree) ? 'an ' : 'a ') + ed.degree + (ed.institution ? ' graduate from ' + ed.institution : ' graduate') : 'a recent graduate'} with hands-on experience in ${skillStr}, I am excited by the opportunity to contribute to your team from day one.`;
    } else {
      intro = `I am writing to apply for the ${role} position at ${company}. ${latest ? `As ${/^[aeiou]/i.test(latest.role) ? 'an' : 'a'} ${latest.role}${latest.company ? ' at ' + latest.company : ''}` : 'As an experienced professional'}${yrs ? ` with ${yrs}+ years of experience` : ''} in ${skillStr}, I bring a track record of measurable results that I believe would add real value to ${company}.`;
    }
    const proof = wins.length
      ? `In my recent work, I have:\n${wins.map((w) => '• ' + w).join('\n')}`
      : 'In my recent work, I have [describe 2–3 achievements with numbers that are relevant to this role].';
    const why = `What draws me to ${company} is [something specific about the company — its products, mission, growth or culture]. I am confident that my experience in ${skillStr} would help your team [the outcome this role is responsible for].`;
    const close = `I would welcome the opportunity to discuss how I can contribute to ${company}. Thank you for your time and consideration.`;
    return `Dear ${to},\n\n${intro}\n\n${proof}\n\n${why}\n\n${close}\n\nSincerely,\n${p.fullName || '[Your name]'}`;
  };

  /* ---------- The scorecard ---------- */
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const MONEY = /(₹|\$|€|£|\brs\.?|\binr\b|\busd\b|\bcr\b|crore|lakh|\blac\b|million|\bmn\b|billion|\bbn\b|\bk\b)/i;
  const SCOPE = /(team of|\d+\+?\s*(engineers|people|employees|reports|members|staff|countries|markets|offices)|budget|p&l|revenue|arr|valuation|board)/i;

  RC.analyze = function (r, ctx) {
    ctx = ctx || {};
    const checks = [];
    const add = (id, label, weight, status, detail, tips) => checks.push({ id, label, weight, status, detail, tips: tips || [] });
    const p = r.personal, mode = r.mode;
    const bullets = collectBullets(r);
    const years = RC.yearsOfExperience(r);

    // 1. Contact
    const miss = [];
    if (!p.fullName.trim()) miss.push('full name');
    if (!EMAIL.test(p.email.trim())) miss.push('valid email');
    if (p.phone.replace(/\D/g, '').length < 8) miss.push('phone');
    if (!p.location.trim()) miss.push('city');
    if (!/linkedin\.com\//i.test(p.linkedin)) miss.push('LinkedIn URL');
    const ctips = [];
    const local = p.email.split('@')[0] || '';
    if (/(cool|cute|king|queen|rock|love|baby|angel|devil|smart|boss|sexy|hot)/i.test(local)) ctips.push('Use a professional email such as firstname.lastname@gmail.com');
    if (/,.*,/.test(p.location)) ctips.push('City + country is enough — recruiters do not need your full street address');
    add('contact', 'Contact details', 10, miss.length === 0 ? (ctips.length ? 'warn' : 'pass') : miss.length === 1 ? 'warn' : 'fail',
      miss.length ? 'Missing: ' + miss.join(', ') + '.' : 'Name, email, phone, city and LinkedIn are present.', ctips);

    // 2. Headline
    add('headline', 'Target job title (headline)', 5, p.title.trim() ? 'pass' : 'fail',
      p.title.trim() ? `"${p.title.trim()}" — make sure it mirrors the job you apply to.` : 'Add the exact job title you are targeting. ATS search and recruiters match on it first.');

    // 3. Summary
    const sw = wordCount(r.summary);
    const [minW, maxW] = mode === 'executive' ? [40, 110] : mode === 'fresher' ? [25, 75] : [35, 90];
    const sIssues = [];
    if (sw && (sw < minW || sw > maxW)) sIssues.push(`Aim for ${minW}–${maxW} words (now ${sw}).`);
    if (/\b(i|me|my|myself)\b/i.test(r.summary)) sIssues.push('Drop "I / my" — resumes use implied first person.');
    const sCl = CLICHES.filter((c) => r.summary.toLowerCase().includes(c));
    if (sCl.length) sIssues.push('Replace clichés with proof: ' + sCl.map((c) => `"${c}"`).join(', ') + '.');
    if (sw && !/\d/.test(r.summary)) sIssues.push('Add at least one number (years, team size, revenue, users, CGPA).');
    add('summary', mode === 'executive' ? 'Executive profile' : 'Professional summary', 10, !sw ? 'fail' : sIssues.length ? 'warn' : 'pass',
      !sw ? 'No summary yet. It is the first thing a recruiter reads — use "Draft from my resume" in the Summary tab.' : sIssues.length ? sIssues[0] : 'Concise, specific and quantified.', sIssues.slice(1));

    // 4. Action verbs
    if (!bullets.length) {
      add('verbs', 'Action-verb bullet points', 15, 'fail', 'No bullet points yet. Add 3–5 achievement bullets per role / project.');
    } else {
      const weak = bullets.filter((b) => !STRONG.has(firstWord(b.text).toLowerCase()));
      const pct = 1 - weak.length / bullets.length;
      add('verbs', 'Action-verb bullet points', 15, pct >= 0.8 ? 'pass' : pct >= 0.5 ? 'warn' : 'fail',
        `${bullets.length - weak.length} of ${bullets.length} bullets start with a strong action verb.`,
        weak.slice(0, 3).map((b) => `Rewrite: "${b.text.split(/\s+/).slice(0, 7).join(' ')}…" — use ✨ Recruiter Review`));
    }

    // 5. Quantified impact
    if (bullets.length) {
      const q = bullets.filter((b) => /\d/.test(b.text)).length;
      const target = mode === 'fresher' ? 0.4 : 0.6;
      const pct = q / bullets.length;
      add('metrics', 'Quantified impact', 15, pct >= target ? 'pass' : pct >= target / 2 ? 'warn' : 'fail',
        `${q} of ${bullets.length} bullets (${Math.round(pct * 100)}%) contain numbers. Top recruiters look for ${Math.round(target * 100)}%+.`,
        pct >= target ? [] : ['Quantify with: % growth, ₹/$ revenue or savings, time saved, users served, team size, ranking.', 'Use the Impact Builder: Verb + What + Result + How.']);
    } else {
      add('metrics', 'Quantified impact', 15, 'fail', 'Add bullets with measurable results.');
    }

    // 6. Bullet length
    if (bullets.length) {
      const longB = bullets.filter((b) => wordCount(b.text) > 32), shortB = bullets.filter((b) => wordCount(b.text) < 6);
      const bad = longB.length + shortB.length;
      add('length-bullets', 'Bullet length (1–2 lines)', 5, bad === 0 ? 'pass' : bad <= 2 ? 'warn' : 'fail',
        bad === 0 ? 'All bullets are scannable.' : `${longB.length} too long, ${shortB.length} too short.`,
        longB.slice(0, 2).map((b) => `Shorten: "${b.text.slice(0, 60)}…"`));
    }

    // 7. Weak phrases & clichés
    const all = RC.fullText(r).toLowerCase();
    const foundWeak = WEAK_PHRASES.filter((w) => all.includes(w));
    const foundCl = CLICHES.filter((w) => all.includes(w));
    const nBad = foundWeak.length + foundCl.length;
    add('weak', 'No weak phrases or clichés', 10, nBad === 0 ? 'pass' : nBad <= 2 ? 'warn' : 'fail',
      nBad === 0 ? 'Language is direct and specific.' : 'Found: ' + foundWeak.concat(foundCl).map((w) => `"${w}"`).join(', ') + '.',
      nBad ? ['Recruiters skim past soft claims. Replace them with evidence (what you did + result).'] : []);

    // 8. Pronouns in bullets
    const pron = bullets.filter((b) => /\b(i|my|me|we|our)\b/i.test(b.text)).length;
    add('pronouns', 'No personal pronouns in bullets', 5, pron === 0 ? 'pass' : 'warn',
      pron === 0 ? 'Bullets use implied first person.' : `${pron} bullet(s) use I / my / we.`);

    // 9. Bullets per role
    const roles = r.experience.filter((e) => e.role.trim() || e.company.trim());
    if (roles.length) {
      const issues = [];
      const recentN = RC.lines(roles[0].bullets).length;
      const minRecent = mode === 'fresher' ? 2 : 3;
      if (recentN < minRecent) issues.push(`Most recent role has ${recentN} bullet(s); aim for ${minRecent}–${mode === 'fresher' ? 4 : 6}.`);
      roles.forEach((e) => { const n = RC.lines(e.bullets).length; if (n > 7) issues.push(`"${e.role || e.company}" has ${n} bullets — keep the best 5–6.`); });
      roles.slice(1).forEach((e) => { if (!RC.lines(e.bullets).length) issues.push(`"${e.role || e.company}" has no bullets.`); });
      add('roles', 'Bullets per role', 5, issues.length === 0 ? 'pass' : 'warn', issues.length ? issues[0] : 'Good depth on recent roles, lighter on older ones.', issues.slice(1));
    } else if (mode !== 'fresher') {
      add('roles', 'Work experience', 10, 'fail', 'Add your work experience, most recent first.');
    }

    // 10. Dates
    const noDates = roles.filter((e) => !e.start.trim() || (!e.end.trim() && !e.current)).length;
    if (roles.length) add('dates', 'Complete dates', 5, noDates ? 'warn' : 'pass',
      noDates ? `${noDates} role(s) missing start or end dates. Missing dates look like hidden gaps.` : 'All roles have start and end dates.');

    // 11. Skills
    const sc = RC.allSkills(r).length;
    const [sMin, sMax] = mode === 'executive' ? [6, 25] : [8, 30];
    add('skills', mode === 'executive' ? 'Core competencies' : 'Skills section', 10, sc === 0 ? 'fail' : sc >= sMin && sc <= sMax ? 'pass' : 'warn',
      sc === 0 ? 'No skills listed — ATS filters rely heavily on this section.' : `${sc} skills listed (ideal ${sMin}–${sMax}).`,
      sc > sMax ? ['Trim to the skills that match the job; long lists dilute relevance.'] : sc && sc < sMin ? ['Group skills by category (Languages, Tools, Domain…) and add what the job asks for.'] : []);

    // 12. Length
    const pages = ctx.pages || 1;
    const limit = mode === 'fresher' ? 1 : mode === 'executive' ? 3 : (years >= 10 ? 2 : (years <= 4 ? 1 : 2));
    add('pages', 'Resume length', 5, pages <= limit ? 'pass' : pages === limit + 1 ? 'warn' : 'fail',
      `${pages} page${pages > 1 ? 's' : ''} — recommended max for your profile: ${limit}.`,
      pages > limit ? ['Reduce font size in Design, cut older or less relevant bullets, merge small sections.'] : []);

    // 13. Profile-specific expectations
    if (mode === 'fresher') {
      const iss = [];
      if (!r.education.some((e) => e.score.trim())) iss.push('Add CGPA / percentage — campus recruiters screen on it.');
      const goodProj = r.projects.filter((x) => x.name.trim() && RC.lines(x.bullets).length);
      if (goodProj.length < 2) iss.push('Add at least 2 projects with outcome bullets.');
      if (!roles.length) iss.push('Add internships, freelance or volunteer work if you have any.');
      if (!r.achievements.some((a) => a.text.trim()) && !r.certifications.some((c) => c.name.trim())) iss.push('Add achievements (hackathons, ranks, leadership) or certifications.');
      add('profile', 'Fresher essentials', 10, iss.length === 0 ? 'pass' : iss.length <= 1 ? 'warn' : 'fail', iss[0] || 'Education score, projects, internship and achievements are covered.', iss.slice(1));
    } else if (mode === 'experienced') {
      const recentNum = roles[0] ? RC.lines(roles[0].bullets).filter((l) => /\d/.test(l)).length : 0;
      const iss = [];
      if (recentNum < 2) iss.push('Your most recent role needs at least 2 quantified wins — recruiters weigh it most.');
      if (roles.length && roles.some((e) => !e.company.trim())) iss.push('Every role needs a company name.');
      add('profile', 'Experienced-hire expectations', 10, iss.length ? 'warn' : 'pass', iss[0] || 'Recent role shows measurable impact.', iss.slice(1));
    } else {
      const hl = r.achievements.filter((a) => a.text.trim());
      const iss = [];
      if (hl.length < 3) iss.push('Add 3–5 Career Highlights at the top — boards and CXO search firms read these first.');
      if (hl.length && hl.filter((a) => /\d/.test(a.text)).length < hl.length) iss.push('Every career highlight should carry a number.');
      if (!SCOPE.test(RC.fullText(r))) iss.push('Show scope: team size, budget / P&L, revenue, geographies.');
      add('profile', 'Executive expectations', 10, iss.length === 0 ? 'pass' : iss.length === 1 ? 'warn' : 'fail', iss[0] || 'Highlights, scope and outcomes are clear.', iss.slice(1));
    }

    // 14. Industry fit
    const iss = [];
    const tgt = r.target;
    if (tgt === 'tech') {
      if (mode !== 'executive' && !p.github.trim() && !p.website.trim()) iss.push('Add a GitHub or portfolio link — tech recruiters click it.');
      if (mode === 'fresher' && r.projects.filter((x) => x.tech.trim()).length < 2) iss.push('List the tech stack on each project.');
      if (r.template !== 'modern' && r.template !== 'classic' && mode !== 'executive') iss.push('Classic or Modern templates parse best in tech ATS (Workday, Greenhouse, Lever).');
    } else if (tgt === 'consulting') {
      if (pages > (mode === 'executive' ? 2 : 1)) iss.push('Consulting firms strongly prefer a one-page resume.');
      if (mode !== 'executive' && !r.education.some((e) => e.score.trim())) iss.push('Show grades / ranks — consulting screens on academics.');
      if (!r.achievements.some((a) => a.text.trim())) iss.push('Add leadership & achievements (ranks, competitions, initiatives).');
    } else if (tgt === 'finance') {
      if (!r.certifications.some((c) => c.name.trim()) && mode !== 'fresher') iss.push('Add certifications (CFA, FRM, CA, NISM) if you hold them.');
      if (!bullets.some((b) => MONEY.test(b.text))) iss.push('Express impact in money terms (₹ Cr / $M, AUM, cost saved).');
    } else {
      if (!r.summary.trim()) iss.push('Add a summary tailored to the role.');
      if (!/linkedin\.com\//i.test(p.linkedin)) iss.push('Add your LinkedIn URL — most corporate recruiters verify it.');
    }
    add('industry', 'Fit for ' + RC.TARGETS[tgt].label, 8, iss.length === 0 ? 'pass' : iss.length === 1 ? 'warn' : 'fail', iss[0] || 'Matches common expectations for this industry.', iss.slice(1));

    const val = { pass: 1, warn: 0.5, fail: 0 };
    const tw = checks.reduce((a, c) => a + c.weight, 0);
    const got = checks.reduce((a, c) => a + c.weight * val[c.status], 0);
    const score = Math.round((got / tw) * 100);
    return { score, checks, bullets, years, jd: RC.matchJD(r) };
  };
})(window.RC);
