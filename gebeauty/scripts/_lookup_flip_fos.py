"""Quick lookup of open FulfillmentOrders for the 6 flip candidates. Read-only."""
import json, urllib.request

TOKEN = [l.split('=',1)[1].strip().strip('"').strip("'")
         for l in open('gebeauty/.env', encoding='utf-8')
         if l.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN=')][0]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'

Q = """
query($q: String!) {
  orders(query: $q, first: 5) {
    nodes {
      name
      tags
      fulfillmentOrders(first: 50) {
        nodes {
          id status
          assignedLocation { location { id name } }
          deliveryMethod { methodType }
        }
      }
    }
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

for name in ['80250', '80288', '80273', '80945', '80316', '80247']:
    r = gql(Q, {'q': f'name:{name}'})
    if r.get('errors'):
        print(f'#{name} ERRORS: {r["errors"]}')
        continue
    nodes = r['data']['orders']['nodes']
    if not nodes:
        print(f'#{name} NOT FOUND')
        continue
    o = nodes[0]
    print(f'#{name} tags: {sorted(o["tags"])}')
    fos = o['fulfillmentOrders']['nodes']
    if not fos:
        print(f'  (no fulfillment orders returned)')
    for fo in fos:
        loc = (fo.get('assignedLocation') or {}).get('location') or {}
        dm = fo.get('deliveryMethod') or {}
        print(f'  fo={fo["id"][-15:]} status={fo["status"]:<10} loc={loc.get("name"):<25} methodType={dm.get("methodType")}')
    print()
