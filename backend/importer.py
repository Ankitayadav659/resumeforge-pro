"""
Import an existing resume (PDF / DOCX / TXT) into ResumeForge's data model.

* DOCX text is extracted here (it is a zip of XML).
* PDF text is extracted in the browser with PDF.js and sent as text; when AI is
  available the original PDF is sent to Claude instead, which handles complex layouts.
* Without AI, a heuristic parser maps the text to sections. It is best-effort, and the
  user is always asked to review the result.
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MAX_XML_BYTES = 25 * 1024 * 1024


class ImportError_(Exception):
    def __init__(self, msg):
        super().__init__(msg)
        self.msg = msg


# ----------------------------------------------------------------------------- DOCX

def docx_to_text(raw):
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
        info = zf.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise ImportError_("This does not look like a valid .docx file. Save it from Word as .docx or PDF and try again.")
    if info.file_size > MAX_XML_BYTES:
        raise ImportError_("This document is too large to import.")
    root = ET.fromstring(zf.read(info))
    lines = []
    body = root.find(f"{W}body")
    if body is None:
        return ""
    for el in body.iter():
        if el.tag == f"{W}p":
            parts = []
            for node in el.iter():
                if node.tag == f"{W}t" and node.text:
                    parts.append(node.text)
                elif node.tag == f"{W}tab":
                    parts.append("\t")
                elif node.tag in (f"{W}br", f"{W}cr"):
                    parts.append("\n")
            text = "".join(parts).strip()
            if not text:
                continue
            is_list = el.find(f"{W}pPr/{W}numPr") is not None
            for i, chunk in enumerate(text.split("\n")):
                chunk = chunk.strip()
                if chunk:
                    lines.append(("• " if is_list and i == 0 else "") + chunk)
    return "\n".join(lines)


# ----------------------------------------------------------------------------- heuristics

SECTION_PATTERNS = [
    ("summary", r"(professional\s+|career\s+|executive\s+)?(summary|profile|objective|about\s+me|overview)"),
    ("experience", r"(work\s+|professional\s+|employment\s+|relevant\s+|leadership\s+)?(experience|employment|work\s+history|career\s+history|internships?(\s*&\s*experience)?)"),
    ("education", r"education(al)?(\s+(background|qualifications?))?|academics?|academic\s+(background|qualifications?)|qualifications?"),
    ("projects", r"(academic\s+|key\s+|personal\s+|major\s+)?projects?"),
    ("skills", r"(technical\s+|key\s+|core\s+)?(skills|competencies|expertise|technologies|tech\s+stack)(\s*&\s*\w+)?"),
    ("certifications", r"certifications?|licen[sc]es?(\s*&\s*certifications?)?|courses?|trainings?"),
    ("achievements", r"achievements?|awards?(\s*&\s*\w+)?|honou?rs?|accomplishments?|career\s+highlights|extra[-\s]?curricular(\s+activities)?|activities|leadership|positions?\s+of\s+responsibility"),
    ("languages", r"languages?(\s+known)?"),
    ("skip", r"(personal\s+(details|information)|declaration|references?|hobbies|interests)"),
]
SECTION_RES = [(k, re.compile(rf"^\s*({p})\s*:?\s*$", re.I)) for k, p in SECTION_PATTERNS]

MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE = rf"(?:{MONTH}\s*'?\d{{2,4}}|\d{{1,2}}[/\-.]\d{{2,4}}|(?:19|20)\d{{2}})"
RANGE_RE = re.compile(rf"({DATE})\s*(?:-|–|—|to|till|until)\s*({DATE}|present|current|now|ongoing|till\s+date|date)", re.I)
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(\+?\d[\d\s().-]{7,}\d)")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/[^\s|,]+", re.I)
GITHUB_RE = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[^\s|,]+", re.I)
URL_RE = re.compile(r"(?:https?://)?(?:www\.)?[a-z0-9-]+\.(?:dev|io|me|com|in|net|org|site|app)(?:/[^\s|,]*)?", re.I)
SCORE_RE = re.compile(r"((?:c?gpa|cpi|sgpa)\s*[:\-]?\s*\d+(?:\.\d+)?(?:\s*/\s*\d+)?|\d{2,3}(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*/\s*10(?:\s*c?gpa)?)", re.I)
BULLET_RE = re.compile(r"^\s*(?:[•●▪◦○■□➢➤►✓✔\-*–]|\d+[.)])\s+")
DEGREE_RE = re.compile(r"\b(b\.?\s?tech|m\.?\s?tech|b\.?e\b|m\.?e\b|b\.?sc|m\.?sc|b\.?com|m\.?com|bca|mca|bba|mba|pgdm|ph\.?d|bachelor|master|diploma|class\s+(x|xii|10|12)|hsc|ssc|cbse|icse|b\.?a\b|m\.?a\b|ca\b|llb)", re.I)


def _clean(s):
    return re.sub(r"\s+", " ", s).strip(" |,;-–—\t")


def _detect_section(line):
    if len(line) > 50:
        return None
    for key, rx in SECTION_RES:
        if rx.match(line):
            return key
    return None


def _split_dates(line):
    m = RANGE_RE.search(line)
    if m:
        start, end = m.group(1), m.group(2)
        rest = _clean(line[:m.start()] + " " + line[m.end():])
        return start.strip().title() if not start[0].isdigit() else start.strip(), end.strip(), rest
    return None, None, line


def _split_role_company(text):
    for sep in (" | ", " at ", " @ ", " — ", " – ", " - ", ", "):
        if sep in text:
            a, b = text.split(sep, 1)
            return _clean(a), _clean(b)
    return _clean(text), ""


def heuristic_parse(text):
    raw_lines = [l.rstrip() for l in text.replace("\r", "").split("\n")]
    lines = [l for l in raw_lines if l.strip()]
    if not lines:
        raise ImportError_("No text could be read from this file. If it is a scanned image, enable AI import or upload a .docx version.")

    personal = {k: "" for k in ("fullName", "title", "email", "phone", "location", "linkedin", "github", "website")}
    blob = "\n".join(lines[:15])
    if m := EMAIL_RE.search(blob):
        personal["email"] = m.group(0)
    if m := LINKEDIN_RE.search(blob):
        personal["linkedin"] = m.group(0)
    if m := GITHUB_RE.search(blob):
        personal["github"] = m.group(0)
    for m in PHONE_RE.finditer(blob):
        digits = re.sub(r"\D", "", m.group(1))
        if 10 <= len(digits) <= 13 and not RANGE_RE.search(m.group(1)):
            personal["phone"] = _clean(m.group(1))
            break

    sections = {"header": []}
    current = "header"
    for line in lines:
        key = _detect_section(_clean(line))
        if key:
            current = key
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    # Header: name + headline + location
    header = sections.get("header", [])
    contact_bits = set(filter(None, [personal["email"], personal["phone"], personal["linkedin"], personal["github"]]))
    for line in header:
        c = _clean(line)
        if any(b and b in c for b in contact_bits) or EMAIL_RE.search(c):
            for part in re.split(r"[|•·,]\s*", c):
                part = part.strip()
                if part and not personal["location"] and not any(ch.isdigit() for ch in part) and "@" not in part \
                        and "." not in part and 2 < len(part) < 40 and len(part.split()) <= 4:
                    personal["location"] = part
            continue
        if not personal["fullName"] and 1 < len(c.split()) <= 5 and not any(ch.isdigit() for ch in c):
            personal["fullName"] = c.title() if c.isupper() else c
        elif personal["fullName"] and not personal["title"] and len(c) < 90:
            personal["title"] = c
    if not personal["website"]:
        for m in URL_RE.finditer(blob):
            u = m.group(0)
            preceded_by_at = m.start() > 0 and blob[m.start() - 1] in "@.-_"
            if not preceded_by_at and "linkedin" not in u and "github" not in u and "@" not in u:
                personal["website"] = u
                break

    result = {
        "personal": personal,
        "summary": " ".join(_clean(l) for l in sections.get("summary", [])),
        "experience": _parse_entries(sections.get("experience", []), "experience"),
        "education": _parse_education(sections.get("education", [])),
        "projects": _parse_entries(sections.get("projects", []), "projects"),
        "skills": _parse_skills(sections.get("skills", [])),
        "certifications": [_parse_cert(l) for l in sections.get("certifications", []) if _clean(BULLET_RE.sub("", l))],
        "achievements": [_clean(BULLET_RE.sub("", l)) for l in sections.get("achievements", []) if _clean(BULLET_RE.sub("", l))],
        "languages": ", ".join(_clean(BULLET_RE.sub("", l)) for l in sections.get("languages", [])),
    }
    result["mode"] = _guess_mode(result)
    return result


def _parse_entries(lines, kind):
    entries, cur = [], None

    def new_entry():
        if kind == "experience":
            return {"role": "", "company": "", "location": "", "start": "", "end": "", "current": False, "bullets": []}
        return {"name": "", "tech": "", "link": "", "date": "", "bullets": []}

    for line in lines:
        is_bullet = bool(BULLET_RE.match(line))
        text = _clean(BULLET_RE.sub("", line))
        if not text:
            continue
        start, end, rest = _split_dates(text)
        words = len(text.split())
        looks_header = not is_bullet and (start or (words <= 12 and not text.endswith(".") and text[:1].isupper()))
        if looks_header and (start or cur is None or cur["bullets"] or (kind == "projects")):
            if cur is None or start or cur["bullets"] or (kind == "projects" and (cur["name"] and cur["bullets"])):
                cur = new_entry()
                entries.append(cur)
            if kind == "experience":
                if start:
                    cur["start"] = start
                    if re.match(r"present|current|now|ongoing|till", end, re.I):
                        cur["current"] = True
                    else:
                        cur["end"] = end
                if rest:
                    if not cur["role"]:
                        cur["role"], cur["company"] = _split_role_company(rest)
                    elif not cur["company"]:
                        cur["company"] = rest
                    elif not cur["location"]:
                        cur["location"] = rest
            else:
                if start:
                    cur["date"] = f"{start} – {end}"
                if rest and not cur["name"]:
                    name, tech = _split_role_company(rest)
                    cur["name"], cur["tech"] = name, tech
                elif rest and not cur["tech"]:
                    cur["tech"] = rest
            continue
        if not start and kind == "experience" and cur is not None and not cur["bullets"] and not is_bullet and words <= 8:
            if not cur["company"]:
                cur["company"] = text
                continue
            if not cur["location"] and words <= 4:
                cur["location"] = text
                continue
        if cur is None:
            cur = new_entry()
            entries.append(cur)
        if is_bullet or not cur["bullets"] or words > 6:
            cur["bullets"].append(text)
        else:
            cur["bullets"][-1] += " " + text
    for e in entries:
        if kind == "projects":
            m = re.search(r"(github\.com/\S+|https?://\S+)", " ".join(e["bullets"]) + " " + e["name"] + " " + e["tech"])
            if m and not e["link"]:
                e["link"] = m.group(1)
    return entries


def _parse_education(lines):
    entries, cur = [], None
    for line in lines:
        text = _clean(BULLET_RE.sub("", line))
        if not text:
            continue
        start, end, rest = _split_dates(text)
        years = YEAR_RE.findall(text) if not start else []
        score = SCORE_RE.search(text)
        if DEGREE_RE.search(text) or cur is None:
            cur = {"degree": "", "institution": "", "location": "", "start": "", "end": "", "score": "", "details": ""}
            entries.append(cur)
            if start:
                cur["start"], cur["end"] = start, end
            elif years:
                cur["end"] = years[-1]
                if len(years) > 1:
                    cur["start"] = years[0]
            body = rest if start else YEAR_RE.sub("", text)
            if score:
                cur["score"] = score.group(1).strip()
                body = body.replace(score.group(1), "")
            a, b = _split_role_company(_clean(body))
            cur["degree"], cur["institution"] = a, b
            continue
        if score and not cur["score"]:
            cur["score"] = score.group(1).strip()
            text = _clean(text.replace(score.group(1), ""))
        if start or years:
            if not cur["end"]:
                cur["start"], cur["end"] = (start, end) if start else ((years[0] if len(years) > 1 else ""), years[-1])
            text = _clean(rest if start else YEAR_RE.sub("", text))
        if not text:
            continue
        if not cur["institution"]:
            cur["institution"] = text
        else:
            cur["details"] = _clean(cur["details"] + " " + text)
    return entries


def _parse_skills(lines):
    rows, loose = [], []
    for line in lines:
        text = _clean(BULLET_RE.sub("", line))
        if not text:
            continue
        if ":" in text and len(text.split(":", 1)[0]) < 40:
            cat, items = text.split(":", 1)
            rows.append({"category": _clean(cat), "items": _clean(items.replace("|", ",").replace("•", ","))})
        else:
            loose.append(text.replace("|", ",").replace("•", ","))
    if loose:
        rows.append({"category": "", "items": ", ".join(_clean(x) for x in loose)})
    return rows


def _parse_cert(line):
    text = _clean(BULLET_RE.sub("", line))
    year = ""
    if m := YEAR_RE.search(text):
        year = m.group(0)
        text = _clean(text.replace(year, "").replace("()", ""))
    name, issuer = _split_role_company(text)
    return {"name": name, "issuer": issuer, "year": year}


def _guess_mode(r):
    years = []
    for e in r["experience"]:
        ys = YEAR_RE.findall(f"{e['start']} {e['end']}")
        years += [int(y) for y in ys]
    title = (r["personal"].get("title") or "") + " " + " ".join(e["role"] for e in r["experience"][:1])
    if re.search(r"\b(vp|vice president|director|chief|cxo|ceo|cto|cfo|coo|head of|president|partner)\b", title, re.I):
        return "executive"
    span = (max(years) - min(years)) if years else 0
    has_current = any(e["current"] for e in r["experience"])
    if not r["experience"] or (span < 2 and not has_current) or re.search(r"\b(intern|student|fresher|graduate)\b", title, re.I):
        return "fresher"
    return "experienced"


# ----------------------------------------------------------------------------- normalisation

def to_resume_fields(parsed):
    """Maps parser / AI output to the frontend's resume shape (bullets as newline text)."""
    def s(v):
        return str(v or "").strip()

    out = {
        "mode": parsed.get("mode") if parsed.get("mode") in ("fresher", "experienced", "executive") else "experienced",
        "personal": {k: s((parsed.get("personal") or {}).get(k)) for k in
                     ("fullName", "title", "email", "phone", "location", "linkedin", "github", "website")},
        "summary": s(parsed.get("summary")),
        "experience": [{
            "role": s(e.get("role")), "company": s(e.get("company")), "location": s(e.get("location")),
            "start": s(e.get("start")), "end": "" if e.get("current") else s(e.get("end")),
            "current": bool(e.get("current")), "bullets": "\n".join(s(b) for b in e.get("bullets") or [] if s(b)),
        } for e in parsed.get("experience") or []],
        "education": [{k: s(e.get(k)) for k in ("degree", "institution", "location", "start", "end", "score", "details")}
                      for e in parsed.get("education") or []],
        "projects": [{
            "name": s(p.get("name")), "tech": s(p.get("tech")), "link": s(p.get("link")), "date": s(p.get("date")),
            "bullets": "\n".join(s(b) for b in p.get("bullets") or [] if s(b)),
        } for p in parsed.get("projects") or []],
        "skills": [{"category": s(x.get("category")), "items": s(x.get("items"))} for x in parsed.get("skills") or [] if s(x.get("items"))],
        "certifications": [{k: s(c.get(k)) for k in ("name", "issuer", "year")} for c in parsed.get("certifications") or [] if s(c.get("name"))],
        "achievements": [{"text": s(a)} for a in parsed.get("achievements") or [] if s(a)],
        "languages": s(parsed.get("languages")),
    }
    return out
