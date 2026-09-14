"""Decode Power BI DSR rows into flat tuples.

DM0 rows are delta-encoded against the previous row:
  R (repeat bitmask)  bit i set  -> field i is unchanged, not present in C
  C (values)          supplies every field whose R bit is clear, in order
  Ø (null bitmask)    bit i set  -> field i is null
A value is either a literal or an index into ValueDicts[DN] named by S[i].
"""
import json, io, sys
sys.stdout.reconfigure(encoding='utf-8')

def decode(ds):
    ph = ds.get('PH', [{}])[0]
    rows = ph.get('DM0', [])
    dicts = ds.get('ValueDicts', {})
    schema, out, prev = None, [], []
    for r in rows:
        if 'S' in r:                      # first row carries the schema
            schema = r['S']
            prev = [None] * len(schema)
        n = len(schema)
        R, O = r.get('R', 0), r.get('Ø', 0)
        vals, ci, C = list(prev), 0, r.get('C', [])
        for i in range(n):
            if O >> i & 1:                # explicit null
                vals[i] = None
            elif R >> i & 1:              # repeat previous
                pass
            else:
                vals[i] = C[ci] if ci < len(C) else None
                ci += 1
        prev = vals
        resolved = []
        for i, v in enumerate(vals):
            dn = schema[i].get('DN')
            if dn and isinstance(v, int) and v < len(dicts.get(dn, [])):
                resolved.append(dicts[dn][v])
            else:
                resolved.append(v)
        out.append(tuple(resolved))
    return out

def decode_response(body):
    """Decode a full querydata response. Returns [(field, ...), ...] per dataset."""
    out = []
    for res in body.get('results', []):
        for ds in res.get('result', {}).get('data', {}).get('dsr', {}).get('DS', []):
            out.append((decode(ds), ds.get('RT')))
    return out


if __name__ == '__main__':
    # Usage: pbi_decode.py <querydata-response.json>
    #        (the response must already be gunzipped)
    path = sys.argv[1] if len(sys.argv) > 1 else 'sample.json'
    body = json.load(io.open(path, encoding='utf-8'))
    datasets = decode_response(body) if 'results' in body else [(decode(body), body.get('RT'))]
    for rows, rt in datasets:
        print(f'{len(rows)} rows, more pages: {bool(rt)}')
        for r in rows[:10]:
            print('  ', ' | '.join(str(x) for x in r))
        missing = sum(1 for r in rows if any(v is None for v in r))
        if missing:
            print(f'  WARNING: {missing} rows have a null field')
