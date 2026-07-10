"""Flip stuck Hexagon orders to correct fulfillment locations.

Per Lucas's 2026-05-21 direction:
- RioSul-stranded orders bound for SP/Santo André -> Shops Jardins
- RioSul-stranded order bound for Recife -> Shopping Recife
- RioSul-stranded orders bound elsewhere -> CD Extrema
- CD Extrema orders bound for SP/Santo André -> Shops Jardins

Default = DRY-RUN (prints intended moves, no mutations).
Pass --execute to actually perform fulfillmentOrderMove.
"""
import json, sys, time, urllib.request

DRY = '--execute' not in sys.argv

TOKEN = [l.split('=', 1)[1].strip().strip('"').strip("'")
         for l in open('sandbox/gebeauty/.env', encoding='utf-8')
         if l.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN=')][0]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'

SHOPS_JARDINS   = 'gid://shopify/Location/97784398144'
SHOPPING_RECIFE = 'gid://shopify/Location/97397014848'
CD_EXTREMA      = 'gid://shopify/Location/105538257216'

MOVES = [
    # (order, fo_gid, target_loc_gid, target_name, note)
    ('80204', 'gid://shopify/FulfillmentOrder/8180290126144', CD_EXTREMA,      'CD Extrema',      'RioSul -> CD Extrema (Sao Luis/MA)'),
    ('80219', 'gid://shopify/FulfillmentOrder/8180594704704', CD_EXTREMA,      'CD Extrema',      'RioSul -> CD Extrema (Fortaleza/CE)'),
    ('80250', 'gid://shopify/FulfillmentOrder/8181127545152', SHOPS_JARDINS,   'Shops Jardins',   'RioSul -> Shops Jardins (Sao Paulo/SP)'),
    ('80273', 'gid://shopify/FulfillmentOrder/8207297773888', SHOPS_JARDINS,   'Shops Jardins',   'CD Extrema -> Shops Jardins (Campinas/SP)'),
    ('80288', 'gid://shopify/FulfillmentOrder/8183332405568', SHOPS_JARDINS,   'Shops Jardins',   'RioSul -> Shops Jardins (Cotia/SP)'),
    ('80296', 'gid://shopify/FulfillmentOrder/8183455449408', CD_EXTREMA,      'CD Extrema',      'RioSul -> CD Extrema (Brasilia/DF)'),
    ('80316', 'gid://shopify/FulfillmentOrder/8185655853376', SHOPPING_RECIFE, 'Shopping Recife', 'RioSul -> Shopping Recife (Recife/PE) [IN_PROGRESS, may reject]'),
    ('80336', 'gid://shopify/FulfillmentOrder/8186061979968', CD_EXTREMA,      'CD Extrema',      'RioSul -> CD Extrema (Fortaleza/CE)'),
    ('80351', 'gid://shopify/FulfillmentOrder/8186308624704', CD_EXTREMA,      'CD Extrema',      'RioSul -> CD Extrema (Umuarama/PR)'),
    ('80945', 'gid://shopify/FulfillmentOrder/8207479210304', SHOPS_JARDINS,   'Shops Jardins',   'CD Extrema -> Shops Jardins (Santo Andre/SP)'),
]

MOVE = """
mutation Move($id: ID!, $loc: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $loc) {
    movedFulfillmentOrder {
      id
      status
      assignedLocation { location { id name } }
    }
    userErrors { field message }
  }
}
"""

def gql(query, variables):
    body = json.dumps({'query': query, 'variables': variables}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())

mode = 'DRY-RUN' if DRY else 'EXECUTING'
print(f'=== {mode} :: {len(MOVES)} moves ===')
results = []
for (order, fo_id, target_loc, target_name, note) in MOVES:
    print(f'#{order}  {note}')
    if DRY:
        print(f'   would call fulfillmentOrderMove(id={fo_id[-15:]}, loc={target_loc[-15:]})')
        continue
    r = gql(MOVE, {'id': fo_id, 'loc': target_loc})
    if r.get('errors'):
        print(f'   GQL ERROR: {r["errors"]}')
        results.append((order, 'gql_error', r['errors']))
        continue
    payload = r['data']['fulfillmentOrderMove']
    errs = payload['userErrors']
    moved = payload.get('movedFulfillmentOrder') or {}
    landed_loc = ((moved.get('assignedLocation') or {}).get('location') or {}).get('name')
    landed_id  = ((moved.get('assignedLocation') or {}).get('location') or {}).get('id')
    ok = (landed_id == target_loc) and not errs
    status_word = 'OK' if ok else 'FAIL'
    print(f'   -> {status_word}  landed at {landed_loc} (status={moved.get("status")}) userErrors={errs}')
    results.append((order, status_word, {'landed': landed_loc, 'errs': errs}))
    time.sleep(0.25)  # rate-limit cushion

if not DRY:
    print('\n=== SUMMARY ===')
    for order, status, detail in results:
        print(f'  #{order}: {status}  {detail}')
