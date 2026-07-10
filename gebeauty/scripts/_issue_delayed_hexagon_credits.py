"""Issue 30% store credit to the 11 customers tagged delayed-hexagon.

Expiry per customer = paid_at + 60 days, BRT end-of-day.
Default = DRY-RUN; pass --execute to actually issue credits.
"""
import json, sys, time, urllib.request

DRY = '--execute' not in sys.argv

TOKEN = [l.split('=', 1)[1].strip().strip('"').strip("'")
         for l in open('gebeauty/.env', encoding='utf-8')
         if l.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN=')][0]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'

EXP_0512 = '2026-07-11T23:59:59-03:00'  # paid 2026-05-12 + 60d
EXP_0513 = '2026-07-12T23:59:59-03:00'  # paid 2026-05-13 + 60d
EXP_0519 = '2026-07-18T23:59:59-03:00'  # paid 2026-05-19 + 60d

CREDITS = [
    # (order, customer_gid, amount, expires_at, label)
    ('80204', 'gid://shopify/Customer/10739634209088', '49.37', EXP_0512, 'Larissa N. Medeiros'),
    ('80219', 'gid://shopify/Customer/10740398326080', '84.09', EXP_0512, 'Monique Rocha Dias'),
    ('80247', 'gid://shopify/Customer/10742686417216', '60.27', EXP_0512, 'Mariana Fadil Romao'),
    ('80250', 'gid://shopify/Customer/10200903909696', '49.87', EXP_0512, 'Maria Fernanda de Paula'),
    ('80288', 'gid://shopify/Customer/9484989628736',  '47.07', EXP_0513, 'Rodrigo Souza'),
    ('80296', 'gid://shopify/Customer/10747133985088', '47.32', EXP_0513, 'Anni A. Moreira Silva'),
    ('80316', 'gid://shopify/Customer/9847982162240',  '47.31', EXP_0513, 'Rafael Cavalcanti'),
    ('80336', 'gid://shopify/Customer/10749042295104', '66.27', EXP_0513, 'Marilia S. Carneiro'),
    ('80351', 'gid://shopify/Customer/10749740187968', '47.49', EXP_0513, 'Lidia A. K. Nunes'),
    ('80943', 'gid://shopify/Customer/10809595101504', '42.17', EXP_0519, 'Patricia F. Garcia'),
    ('80945', 'gid://shopify/Customer/7759105098048',  '91.57', EXP_0519, 'Angelica Vasconcelos'),
]

MUTATION = """
mutation Credit($id: ID!, $input: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $input) {
    storeCreditAccountTransaction {
      id
      amount { amount currencyCode }
      balanceAfterTransaction { amount currencyCode }
      account { id }
    }
    userErrors { field message code }
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

total = sum(float(c[2]) for c in CREDITS)
mode = 'DRY-RUN' if DRY else 'EXECUTING'
print(f'=== {mode} :: {len(CREDITS)} credits, total R${total:.2f} ===')

results = []
for (order, cust_gid, amount, expires_at, label) in CREDITS:
    print(f'#{order} {label}  R${amount}  exp {expires_at[:10]}')
    if DRY:
        continue
    payload = {
        'creditAmount': {'amount': amount, 'currencyCode': 'BRL'},
        'expiresAt': expires_at,
    }
    r = gql(MUTATION, {'id': cust_gid, 'input': payload})
    if r.get('errors'):
        print(f'   GQL ERROR: {r["errors"][0].get("message", r["errors"])}')
        results.append((order, 'gql_error', r['errors']))
        continue
    data = r['data']['storeCreditAccountCredit']
    errs = data['userErrors']
    tx = data.get('storeCreditAccountTransaction')
    if errs or not tx:
        print(f'   FAIL  userErrors={errs}')
        results.append((order, 'fail', errs))
        continue
    bal = tx['balanceAfterTransaction']
    print(f'   OK  tx={tx["id"].rsplit("/",1)[-1]}  new balance R${bal["amount"]}')
    results.append((order, 'ok', tx))
    time.sleep(0.25)

if not DRY:
    print('\n=== SUMMARY ===')
    for order, status, detail in results:
        print(f'  #{order}: {status}')
