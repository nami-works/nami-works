# -*- coding: utf-8 -*-
"""
Per-page content for the 5 educational-post landing pages.
Campaign: lp-educacional-2026-08

EVERY fact here is traceable:
  prices/actives  -> live Shopify catalog + gebeauty/growth/cost-basis.json (read 2026-07-31)
  proof quotes    -> real comments on the 5 organic posts (handles kept verbatim)
  faq questions   -> real questions asked in those comment threads
  free shipping   -> params.json free_shipping_threshold_brl = 299

Voice rules enforced from brand-context.md:
  banned: em-dash, invented numbers, deep discounting as product endorsement
  register: benefit-led; ingredient-as-proof (name an active only bound to its benefit)
  language: pt-BR, idiomatic, no calques. tagline "no seu tempo, do seu jeito."
NO invented statistics, ratings or review counts appear anywhere below.
"""

CDN = "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/"
STORE = "https://www.gebeauty.com.br"

# ---------------------------------------------------------------- shared offer
# The conversion unit for every page. Live product, verified against the 10% net
# floor after media at the R$68 CAC ceiling (offer_margin_check.py -> 23.7% PASS).
ROTINA_FRESCOR = {
    "handle": "primeira-rotina-shampoo-a-seco",
    "name": "rotina com frescor prolongado",
    "price": 259.00,
    "image": CDN + "primeira-rotina_shampoo-a-seco.png?v=1784931174",
    "steps": [
        ("limpa", "shampoo sem sulfato", "purifica sem agredir. a manteiga de murumuru repõe a maciez e o pantenol hidrata sem pesar."),
        ("nutre", "máscara condicionadora", "sela as cutículas com óleo de abacate, que hidrata em profundidade, e crambe, que reduz o frizz."),
        ("refresca", "shampoo a seco", "nos dias sem chuveiro, o H-Vit Plus controla a oleosidade e o pantenol traz sensação de frescor."),
    ],
}

ROTINA_TERMICA = {
    "handle": "primeira-rotina-leave-in-travel-size",
    "name": "rotina com proteção térmica",
    "price": 237.00,
    "image": CDN + "primeira-rotina_leave-in-travel.png?v=1784931207",
    "steps": [
        ("limpa", "shampoo sem sulfato", "purifica sem agredir. a manteiga de murumuru repõe a maciez e o pantenol hidrata sem pesar."),
        ("nutre", "máscara condicionadora", "sela as cutículas com óleo de abacate, que hidrata em profundidade, e crambe, que reduz o frizz."),
        ("protege", "leave-in travel size", "proteção térmica até 230°C. a chia forma um filme que controla o frizz e a trealose preserva a umidade no fio."),
    ],
}

BOOSTER_FORT = {
    "handle": "booster-fortificante",
    "name": "booster fortificante",
    "price": 75.00,
    "image": CDN + "flat_booster-fortificante.png?v=1783534206",
    "why": "biotina e algas vermelhas fortalecem o fio e ajudam a controlar a queda. misture no shampoo ou na máscara.",
}

SHAMPOO = {"handle": "shampoo-sem-sulfato", "name": "shampoo sem sulfato", "price": 95.00,
           "image": CDN + "shampoo-sem-sulfato.png?v=1782919190"}
MASCARA = {"handle": "mascara-condicionadora", "name": "máscara condicionadora", "price": 95.00,
           "image": CDN + "mascara-condicionadora.png?v=1782919061"}

FINALIZADORES = [
    {"handle": "primer-liso-intacto", "name": "primer liso intacto", "price": 139.00,
     "image": CDN + "primer-liso-intacto.png?v=1782919150",
     "para": "liso e escova", "promise": "escova intacta por até 24h",
     "detail": "proteção térmica até 230°C e blindagem contra a umidade, para fios alinhados e sem frizz.",
     "tags": ["liso", "ondulado"]},
    {"handle": "primer-cachos-definidos", "name": "primer cachos definidos", "price": 149.00,
     "image": CDN + "primer-cachos-definidos.png?v=1782919142",
     "para": "cachos e ondas", "promise": "cachos definidos por até 24h",
     "detail": "protege do calor, hidrata e mantém a forma natural, sem frizz e sem pesar.",
     "tags": ["cacheado", "ondulado"]},
    {"handle": "leave-in-pluma", "name": "leave-in pluma", "price": 149.00,
     "image": CDN + "leave-in-pluma.png?v=1782919053",
     "para": "fios finos", "promise": "5 benefícios em um só produto",
     "detail": "hidrata, nutre, repara, protege do calor e realça o brilho, com toque leve.",
     "tags": ["fino", "liso"]},
    {"handle": "leave-in-com-protecao-termica", "name": "leave-in clássico", "price": 99.00,
     "image": CDN + "leave-in-com-protecao-termica.png?v=1782919036",
     "para": "todo dia", "promise": "proteção térmica até 230°C",
     "detail": "nutre, sela e protege contra o calor, deixando o cabelo macio e com brilho natural.",
     "tags": ["liso", "ondulado", "cacheado", "fino"]},
]

# ------------------------------------------------------------------- the pages
PAGES = [
    {
        "slug": "rotina-5-passos",
        "ad_post": "https://www.instagram.com/p/DY0RXePlLdU",
        "ad_hook": "5 passos para o cabelo mais saudável da vida",
        "accent": "sand",
        "eyebrow": "os 5 passos, na prática",
        "h1": "cabelo saudável não é sorte, é rotina",
        "sub": "você viu os 5 hábitos que mudam a saúde de qualquer cabelo. os três primeiros dependem de uma coisa só: o que você usa no banho.",
        "answer_title": "os 5 passos",
        "answer_items": [
            ("lave com o que respeita o fio", "shampoo sem sulfato limpa sem tirar a proteção natural do cabelo."),
            ("nutra toda semana", "máscara com óleo de abacate devolve o que o calor e a poluição tiram."),
            ("espace as lavagens", "shampoo a seco absorve a oleosidade e segura o visual até o próximo banho."),
            ("proteja do calor", "nunca use secador ou chapinha sem proteção térmica."),
            ("seja constante", "cabelo responde a repetição, não a produto milagroso."),
        ],
        "mech_title": "por que a rotina ganha do produto isolado",
        "mech": [
            ("um produto resolve um passo", "shampoo limpa. máscara nutre. nenhum dos dois faz o trabalho do outro."),
            ("os passos se somam", "limpar sem ressecar faz a nutrição render mais. nutrir bem deixa a finalização mais leve."),
            ("constância é o ativo", "a diferença aparece nas semanas, não na primeira lavagem."),
        ],
        "offer": ROTINA_FRESCOR,
        "offer_kicker": "os três primeiros passos, em um ritual só",
        "upsell": BOOSTER_FORT,
        "proof": [
            ("natferreiram", "o cabelo fica super macio e leve, do jeito que eu queria."),
            ("todaeleonora", "amei as explicações."),
        ],
        "faq": [
            ("posso usar os três produtos na mesma lavagem?",
             "sim. shampoo e máscara são a dupla do banho. o shampoo a seco entra nos dias em que você não lava."),
            ("preciso comprar tudo de uma vez?",
             "não. mas a rotina completa é o que faz os passos se somarem, e é por isso que ela vem junta."),
            ("os produtos são livres de crueldade animal?",
             "sim. toda a linha GE Beauty tem fórmula limpa e é livre de crueldade animal."),
        ],
    },
    {
        "slug": "couro-cabeludo",
        "ad_post": "https://www.instagram.com/p/DbB2x8JFOPO",
        "ad_hook": "scalp care é o novo skincare",
        "accent": "red",
        "eyebrow": "scalp care é o novo skincare",
        "h1": "seu haircare começa na raiz",
        "sub": "você hidrata, nutre e reconstrói os fios. mas o couro cabeludo é a pele de onde eles nascem, e ele também pede cuidado.",
        "answer_title": "por que a raiz vem primeiro",
        "answer_items": [
            ("o couro cabeludo é pele", "e reage como pele: desequilibra, sensibiliza, oleosifica."),
            ("o fio nasce ali", "raiz sem equilíbrio entrega fio sem força, por mais máscara que você passe."),
            ("sulfato agride quem já está sensível", "limpar forte não é limpar bem."),
            ("equilíbrio, não decapagem", "a meta é tirar o resíduo e manter a barreira natural."),
        ],
        "mech_title": "o que faz diferença na raiz",
        "mech": [
            ("limpeza sem sulfato", "purifica e mantém o equilíbrio do couro cabeludo, em vez de raspar a proteção dele."),
            ("murumuru e pantenol", "a manteiga de murumuru repõe a maciez e o pantenol hidrata sem pesar na raiz."),
            ("biotina e algas vermelhas", "no booster fortificante, atuam na força do fio e no controle da queda."),
        ],
        "offer": ROTINA_FRESCOR,
        "offer_kicker": "cuidado que começa onde o fio nasce",
        "upsell": BOOSTER_FORT,
        "proof": [
            ("familiatiff", "é perfeito."),
            ("lucas_sg", "o meu não cai nada porque eu uso GE Beauty todo dia."),
        ],
        "faq": [
            ("vocês têm algum produto para esfoliação do couro cabeludo?",
             "esfoliante próprio ainda não faz parte da linha. o caminho hoje é o shampoo sem sulfato, que limpa o resíduo sem agredir a barreira, com o booster fortificante misturado quando a queixa é força e queda."),
            ("serve para couro cabeludo sensível?",
             "sim. a fórmula é sem sulfato e foi pensada para limpar sem tirar a proteção natural da pele da cabeça."),
            ("com que frequência devo lavar?",
             "no seu tempo, do seu jeito. nos dias sem chuveiro, o shampoo a seco segura a oleosidade."),
        ],
    },
    {
        "slug": "efeito-build-up",
        "ad_post": "https://www.instagram.com/p/DaQ7urilIo1",
        "ad_hook": "seu cabelo acostumou com o hair care de todo dia",
        "accent": "sage",
        "eyebrow": "efeito build-up",
        "h1": "seu cabelo não acostumou. ele acumulou.",
        "sub": "aquele produto incrível que parecia ter perdido o efeito não perdeu nada. o que mudou foi o que ficou depositado no fio.",
        "answer_title": "o que é efeito build-up",
        "answer_items": [
            ("resíduo se acumula camada por camada", "silicones, oleosidade e resto de finalizador ficam no fio."),
            ("a camada bloqueia a hidratação", "a máscara passa a agir sobre o resíduo, não sobre o cabelo."),
            ("o fio fica pesado e opaco", "sem balanço, sem brilho, com aquela sensação de sujo mesmo limpo."),
            ("parece que o produto parou de funcionar", "ele não parou. ele não está mais chegando no fio."),
        ],
        "mech_title": "como sair do acúmulo",
        "mech": [
            ("limpe de verdade, sem agredir", "o shampoo sem sulfato purifica o resíduo mantendo o equilíbrio do couro cabeludo."),
            ("devolva o que faltou", "com o fio limpo, o óleo de abacate e o crambe da máscara finalmente agem onde precisam."),
            ("evite recomeçar o acúmulo", "fórmula limpa, sem depósito que pesa lavagem após lavagem."),
        ],
        "offer": ROTINA_FRESCOR,
        "offer_kicker": "o reset do fio, em três passos",
        "upsell": BOOSTER_FORT,
        "proof": [
            ("suzanetrevizann", "eu amo."),
            ("familiatiff", "é perfeito."),
        ],
        "faq": [
            ("o shampoo GE pode ser considerado detox?",
             "ele faz limpeza profunda sem sulfato: tira o resíduo acumulado e mantém o equilíbrio do couro cabeludo. é esse o efeito que as pessoas procuram quando falam em detox, sem a agressão de um shampoo anti-resíduo tradicional."),
            ("em quanto tempo o cabelo volta a responder?",
             "o toque muda já na primeira lavagem com o fio limpo. a leveza e o balanço voltam com a constância da rotina."),
            ("preciso parar de usar meus finalizadores?",
             "não. o ponto é a base: com limpeza e nutrição certas, o finalizador rende mais em vez de virar camada."),
        ],
    },
    {
        "slug": "queda-inverno",
        "ad_post": "https://www.instagram.com/p/DYiKFSIlObI",
        "ad_hook": "por que o cabelo cai tanto no inverno",
        "accent": "red",
        "eyebrow": "queda sazonal",
        "h1": "por que o cabelo cai tanto no inverno?",
        "sub": "não é só impressão sua, e não é culpa sua. a queda tem um ritmo sazonal, e dá para atravessar a estação com o fio mais forte.",
        "answer_title": "o que acontece na estação",
        "answer_items": [
            ("o ciclo do fio tem estações", "uma parte dos fios entra em fase de repouso ao mesmo tempo, e cai junto."),
            ("ar seco e banho quente", "desidratam a fibra e deixam o fio mais quebradiço."),
            ("gorro, atrito e fio seco", "somam quebra ao que já estava caindo."),
            ("raiz desequilibrada agrava", "couro cabeludo sem cuidado entrega fio com menos ancoragem."),
        ],
        "mech_title": "como atravessar a estação com fios mais fortes",
        "mech": [
            ("força na raiz", "biotina e algas vermelhas, no booster fortificante, atuam na força do fio e no controle da queda."),
            ("nutrição contra a quebra", "óleo de abacate e crambe devolvem maciez e reduzem o frizz que vira quebra."),
            ("limpeza que não agride", "sem sulfato, para não somar agressão a um couro cabeludo já sensibilizado."),
        ],
        "offer": ROTINA_FRESCOR,
        "offer_kicker": "a base da rotina, com força na raiz",
        "upsell": BOOSTER_FORT,
        "medical_note": "queda capilar tem várias causas. para garantir o tratamento adequado para o seu caso, consulte um dermatologista.",
        "proof": [
            ("todaeleonora", "todo começo de inverno é isso, e eu achando que o problema era comigo."),
            ("brunafilgueiras", "amo esse booster."),
            ("lucas_sg", "o meu não cai nada porque eu uso GE Beauty todo dia."),
        ],
        "faq": [
            ("o booster fortificante substitui um tratamento médico?",
             "não. ele cuida da força do fio e do controle da queda na sua rotina. queda persistente pede avaliação de um dermatologista."),
            ("como uso o booster?",
             "misture no shampoo ou na máscara, na etapa que você preferir. a dose entra na rotina que você já tem."),
            ("quando começo a ver diferença?",
             "força e quebra respondem à constância. use na rotina completa e acompanhe ao longo das semanas, não em uma lavagem."),
        ],
    },
    {
        "slug": "qual-finalizador",
        "ad_post": "https://www.instagram.com/p/DXIF2p-lJC2",
        "ad_hook": "não sei qual finalizador escolher",
        "accent": "sage",
        "eyebrow": "primer liso, pluma, primer cachos ou clássico",
        "h1": "não sei qual finalizador escolher. e agora?",
        "sub": "são quatro, e cada um resolve uma coisa diferente. escolha pelo seu cabelo e pelo resultado que você quer.",
        "chooser": True,
        "answer_title": None,
        "answer_items": [],
        "mech_title": "a parte que quase todo mundo pula",
        "mech": [
            ("finalizador não conserta base", "ele entrega acabamento. maciez e força vêm da lavagem e da nutrição."),
            ("fio limpo, finalizador rende mais", "sem resíduo acumulado, você usa menos produto e o efeito dura mais."),
            ("por isso a rotina vem antes", "limpar sem ressecar, nutrir de verdade, e só então finalizar."),
        ],
        "offer": ROTINA_TERMICA,
        "offer_kicker": "a base pronta, com finalizador incluído",
        "upsell": None,
        "proof": [
            ("camilacoutinho", "eu uso todos, um para cada momento. mas o que mais uso é o leave-in clássico."),
            ("fagarciafg", "meu preferido é o primer liso intacto. uso várias vezes na semana."),
            ("lezinhas.amesa", "chegou hoje meu primer cachos e já estou apaixonada."),
        ],
        "faq": [
            ("qual a diferença entre o pluma e o leave-in clássico?",
             "são fórmulas diferentes, não uma versão mais diluída da outra. o clássico é o leave-in de proteção térmica do dia a dia. o pluma reúne cinco benefícios com toque mais leve, pensado para quem sente peso com facilidade. em fio muito fino, agite bem e comece com pouco produto."),
            ("posso usar mais de um finalizador?",
             "sim. muita gente usa um para escova e outro para o cabelo ao natural."),
            ("o primer substitui o leave-in?",
             "o primer prepara e blinda a finalização por até 24h. o leave-in é o cuidado de todo dia. eles trabalham em momentos diferentes."),
        ],
    },
]
