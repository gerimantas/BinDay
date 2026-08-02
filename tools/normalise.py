#!/usr/bin/env python3
"""Parse both operators' address strings into one comparable key.

    (locality, street, house, flat)

**All four parts are required.** Each was verified against fetched pickup dates,
not against match rates — an overlap percentage cannot tell a merged duplicate
from a wrong schedule, which is why a rule that looked like a tuning parameter
survived three sessions as a defect. See DECISIONS.md, entry S4.

Locality: of 1 442 street+house keys present in more than one locality, 1 406
(97.5%) have different pickup dates; Švara agrees 12 of 12. Dropping it does not
merge duplicates, it hands the user another village's schedule.

Flat: every one of the 3 746 multi-flat buildings gives each flat its own
container id, at both operators. 60% of Švara multi-flat buildings have
different dates per flat (Ekonovus 0.4%) — `Vėjo g. 12` flat 1 is weekly against
flat 2 fortnightly. Collapsing them shows a resident the neighbour's schedule.

The two operators write the same property differently:

    Švara     "Žalgirio g. 8A, Juragių k., Garliavos apylinkių sen. Kauno r. sav."
    Ekonovus  "Juragių k. Žalgirio g. 8A"
"""

import re
import unicodedata

STREET_WORD = r"(?:g|pr|al|tak|skg|kel|a)"
STREET_TOKEN = re.compile(r"^(.*?\b" + STREET_WORD + r")\.?\s+(\S+)$")
EK_SPLIT = re.compile(
    r"^(.*?\b(?:k|mstl|mst|m|vs|kaimas|kaimelė|kaimele))\.\s+"
    r"(.*?\b" + STREET_WORD + r")\.?\s+(\S+)$")

# Locality type suffixes, stripped before comparing. "Antagynė" == "Antagynės k."
TYPE_SUFFIX = re.compile(
    r"\b(k|kaimas|kaimele|kaimeles|m|mstl|mst|vs|sen|sav|r|sodyba)\b")
# Case endings, stripped repeatedly: "Antagynės" -> "antagyn"
CASE_ENDING = re.compile(r"(ies|ios|iai|iu|es|is|io|ai|ei|os|us|as|e|a|u|i|o)$")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def loc_stem(s):
    """Locality stem. Matches 266 of Ekonovus's 267 locality spellings."""
    s = strip_accents((s or "").lower().strip())
    s = re.sub(r"[.,]", " ", s)
    s = TYPE_SUFFIX.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:
        prev = s
        s = CASE_ENDING.sub("", s)
    return s


def street_stem(s):
    """Street stem: accents, operator-specific abbreviations, first-name initial."""
    s = strip_accents((s or "").lower().strip())
    s = re.sub(r"[.,]", " ", s)
    s = re.sub(r"\bskrg\b", "skg", s)
    s = re.sub(r"\btakas\b", "tak", s)
    s = re.sub(r"\bgatve\b", "g", s)
    s = re.sub(r"\baleja\b", "al", s)
    s = re.sub(r"\bprospektas\b", "pr", s)
    parts = s.split()
    # "Povilo Matulionio g." == "P. Matulionio g."
    if len(parts) >= 3 and len(parts[0]) > 2 and parts[0][-1] in "oiseu":
        parts[0] = parts[0][0]
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def split_house(h):
    """'29A-2' -> ('29a', '2'). Returns (None, None) without a digit.

    A house number must contain a digit: without that check `Slėnio g.` parses
    as street `slėnio` with house `g.`.
    """
    h = strip_accents((h or "").lower().strip())
    h = re.sub(r"[.,\s]", "", h).replace("/", "-")
    if not re.search(r"\d", h):
        return None, None
    base, _, flat = h.partition("-")
    return (base or None), (flat or None)


def parse_svara(addr):
    """-> (locality, street, house, flat) or None."""
    parts = [p.strip() for p in str(addr).split(",") if p.strip()]
    if len(parts) < 2:
        return None
    m = STREET_TOKEN.match(parts[0])
    if not m:
        return None
    house, flat = split_house(m.group(2))
    if not house:
        return None
    loc, street = loc_stem(parts[1]), street_stem(m.group(1))
    return (loc, street, house, flat) if loc and street else None


def parse_ekonovus(addr):
    """-> (locality, street, house, flat) or None."""
    m = EK_SPLIT.match(str(addr).strip())
    if not m:
        return None
    house, flat = split_house(m.group(3))
    if not house:
        return None
    loc, street = loc_stem(m.group(1)), street_stem(m.group(2))
    return (loc, street, house, flat) if loc and street else None


PARSERS = {"svara": parse_svara, "ekonovus": parse_ekonovus}


def key_str(key):
    """Stable string form of a key, for use as a dict/JSON key."""
    loc, street, house, flat = key
    return "|".join([loc, street, house, flat or ""])
