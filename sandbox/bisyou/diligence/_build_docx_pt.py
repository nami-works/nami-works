# -*- coding: utf-8 -*-
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

NAVY = RGBColor(0x11, 0x24, 0x3f); GREY = RGBColor(0x5b, 0x66, 0x77)
doc = Document(); st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)


def shade(cell, hexfill):
    tcPr = cell._tc.get_or_add_tcPr(); sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), hexfill); tcPr.append(sh)


def box(kind, runs):
    colors = {'verdict': ('11243f', 'EAF1FA'), 'gold': ('c79a3a', 'FDF8EE'),
              'risk': ('b23b3b', 'FCF1F1'), 'good': ('1f7a3f', 'F0F8F2')}
    bar, fill = colors[kind]
    t = doc.add_table(rows=1, cols=1); t.style = 'Table Grid'
    c = t.rows[0].cells[0]; shade(c, fill); p = c.paragraphs[0]
    for text, bold in runs:
        r = p.add_run(text); r.bold = bold; r.font.size = Pt(10)
    tcPr = c._tc.get_or_add_tcPr(); borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'bottom', 'right'):
        e = OxmlElement('w:' + edge); e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), '4'); e.set(qn('w:color'), 'D4DAE3'); borders.append(e)
    el = OxmlElement('w:left'); el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '24'); el.set(qn('w:color'), bar); borders.append(el)
    tcPr.append(borders); doc.add_paragraph()


def h1(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(22); r.font.color.rgb = NAVY
def h2(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(14); r.font.color.rgb = RGBColor(255, 255, 255)
    pPr = p._p.get_or_add_pPr(); sh = OxmlElement('w:shd'); sh.set(qn('w:val'), 'clear'); sh.set(qn('w:fill'), '11243F'); pPr.append(sh)
def h3(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = NAVY
def para(t): doc.add_paragraph(t)
def meta(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.font.size = Pt(9); r.font.color.rgb = GREY
def bullets(items, ordered=False):
    for it in items: doc.add_paragraph(it, style='List Number' if ordered else 'List Bullet')
def table(rows, numcols=()):
    t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = 'Table Grid'
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.rows[ri].cells[ci]; cell.text = ''; p = cell.paragraphs[0]; r = p.add_run(str(val)); r.font.size = Pt(9)
            if ri == 0: r.bold = True; shade(cell, 'EEF2F7')
            if ci in numcols: p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    doc.add_paragraph()


h1("Bisyou: devemos assumir a marca?")
meta("Memorando de investimento confidencial. GE Beauty · junho de 2026.")

h2("1. Recomendação em resumo")
box('verdict', [("AVANÇAR (CONDICIONAL). ", True), ("Avançar para um term sheet, dentro das condições abaixo. O caso é uma arbitragem operacional de custos: assumir a receita própria da Bisyou e operá-la com uma base de custos muito mais enxuta do que os atuais donos conseguem. O downside é genuinamente limitado; o upside é real, porém modesto, e depende de se conseguimos adquirir os clientes da Bisyou de forma eficiente na própria marca dela.", False)])
para("Visão geral. A Bisyou perde ~R$3M/ano em run-rate e foi lucrativa em apenas um de cinco anos: o custo de adquirir clientes sempre consumiu sua margem de ~80%. A estrutura de licenciamento nos entrega a operação sem dívida, sem passivo trabalhista, sem contas a pagar legadas e (a Boniteca financia o estoque) sem capital de giro. Na nossa base de custos, sem serviço de dívida, com estrutura compartilhada enxuta e marketing como CPA variável em vez de contratos fixos, a mesma receita se converte em aproximadamente R$1M de EBITDA. O negócio de site próprio é durável (32% dos pedidos são recompra). A aposta é operar enxuto e adquirir com disciplina onde os atuais donos não conseguiram.")
h3("As condições (todas precisam se sustentar, ou desistimos)")
bullets([
 "Royalty <= ~5-8% da receita LÍQUIDA, sem mínimo fixo. Sobre o bruto, ou com mínimo, a conta não fecha.",
 "Conseguimos rodar aquisição standalone a <= ~35% da receita líquida. Ponto central: o upside depende da eficiência de marketing. Break-even ~39%; os donos rodaram 48% (recente) e 32% (único ano bom). Comprovar com teste pago pequeno antes de assumir compromisso.",
 "A receita de site próprio de maio/junho está estabilizando, não ainda caindo. Ainda não temos esses dois meses; ponto de diligência prospectivo.",
 "Prazo de licença longo e barato o suficiente para sair, comprovando o modelo antes da compra; além de ANVISA regular, marca registrada, sem litígio ativo.",
 "Limitamos a atenção da liderança comprometida. O custo real é a atenção de gestão tirada da GE Beauty, não caixa."], ordered=True)
table([["Métrica", "Valor"],
 ["Queima de caixa atual deles (run-rate 2026)", "-R$3,0M"],
 ["EBITDA est. na nossa base (ilustrativo)", "~R$1,0M"],
 ["Marketing de break-even (% da líq.)", "~39%"],
 ["Receita líquida de break-even (vs ~R$7,6M run-rate)", "~R$4,2M"]], numcols=(1,))

h2("2. O que está sendo proposto")
para("Visão geral. Um licenciamento de marca com assunção da operação, não uma aquisição. Operamos a Bisyou e pagamos um royalty, com opção de compra futura (~ano cinco). Assumimos a operação, não o balanço.")
h3("Estrutura (transição limpa)")
bullets([
 "Nenhum passivo transferido: sem passivos trabalhistas, sem dívida bancária, nenhuma das ~R$1,9M de contas a pagar legadas.",
 "Fornecimento inalterado: fabricado pela Boniteca (mesmo fabricante da GE). Fee é uma taxa de sucesso regressiva de 10%->5%, paga apenas após a venda.",
 "Sem desembolso de capital de giro: a Boniteca financia o estoque; pagamos ~M+2 após a venda (vendas de junho pagas no 5o dia útil de agosto). Pagamos só depois que o caixa entra, sem pré-financiamento de estoque de ~R$1M.",
 "Marketing hoje: contratos de influenciadores cancelados; agência de Meta/Google até nov/2026 (~R$60k/mês de mídia + R$6,5k de serviço, multa por saída antecipada)."])
h3("Com quem estamos lidando")
para("Cap table: Disruptive Participações S/A 76%, Ivan Pinheiro 12%, Carolina Viudes 12%. Um detentor financeiro controlando 76% e licenciando a operação é um leve sinal de seleção adversa: não conseguiram financiar ou consertar. Precificar o royalty e o preço de exercício da compra como a opção (call) que isto é.")

h2("3. A realidade financeira da marca")
para("Visão geral. A Bisyou escalou para ~R$15M em 2024 e ganhou dinheiro em exatamente um ano. Em 2025 virou um prejuízo líquido de R$1,8M. Os quatro meses de 2026 que temos (jan-abr) rodam bem abaixo de 2025.")
table([["R$ (visão contábil)", "2021", "2022", "2023", "2024", "2025"],
 ["Receita bruta", "2,47M", "6,40M", "9,81M", "15,44M", "14,79M"],
 ["Margem bruta", "77,5%", "82,4%", "84,5%", "85,2%", "80,2%"],
 ["Gasto comercial (mkt)", "0,91M", "2,34M", "3,14M", "4,45M", "5,20M"],
 ["Lucro / (prejuízo) líquido", "(0,20M)", "(0,22M)", "(0,40M)", "0,62M", "(1,78M)"]], numcols=(1, 2, 3, 4, 5))
box('gold', [("Sobre 2026: ", True), ("temos apenas 4 meses reais (jan-abr). O '-46% vs 2025 / ~R$3M de queima' é um run-rate anualizado, não um ano fechado confirmado: trate como direcional. Nesses meses a publicidade rodou ~48% da receita líquida e a empresa ainda perdia ~R$300k/mês: uma espiral de aquisição paga.", False)])

h2("4. O que quebrou, e o que a evidência prova (e não prova)")
para("Visão geral. O colapso está concentrado no TikTok Shop, puxado por um produto viral (Bio Estimulador). O canal de site próprio aguentou bem melhor. Mas vale ser preciso sobre o que os dados provam.")
table([["Receita bruta por canal", "nov/25", "dez/25", "jan/26", "fev/26", "mar/26", "abr/26", "Tendência"],
 ["TikTok Shop", "965k", "573k", "174k", "90k", "128k", "76k", "-92%"],
 ["Shopify (site próprio)", "1.312k", "987k", "562k", "476k", "909k", "597k", "-54%, oscilando"],
 ["B2B (DPSP)", "74k", "26k", "59k", "2k", "0", "0", "morto"]], numcols=(1, 2, 3, 4, 5, 6))
para("O que os dados sustentam: o TikTok caiu mais forte (-92%), impulso de item único (1,0 item/pedido), um SKU puxou tudo (Bio Estimulador 10.610->406 unidades). O Shopify é multi-item (~2,8) e 32% dos pedidos são recompra: estruturalmente mais durável.")
box('risk', [("O que NÃO prova: ", True), ("o P&L registra marketing como uma única linha, NÃO segmentada por canal. Portanto não consigo provar que a base do Shopify é independente do inchaço de mídia paga e influenciadores. A hipótese mais segura é que o inchaço levantou todos os canais. A base de site próprio pode encolher conforme a mídia paga se normaliza. Por isso o caso é construído sobre uma receita de break-even (~R$4,2M líq.) bem abaixo do run-rate, e não sobre o run-rate se manter.", False)])

h2("5. O núcleo durável (pedido a pedido)")
para("Visão geral. Reconstruímos todas as 89.648 linhas de nota em 45.626 pedidos. O negócio de site próprio é um negócio de compra planejada e recorrente: um ativo real, ainda que seu tamanho seja incerto.")
table([["Canal", "AOV médio", "Itens/pedido", "Caráter"],
 ["Shopify (site próprio)", "R$200", "~2,8", "Compra planejada / kits"],
 ["TikTok Shop", "R$90-148", "1,0", "Impulso viral de item único"]], numcols=(1, 2))
box('good', [("A retenção é real. ", True), ("Em seis meses, 32% dos pedidos de site próprio vieram de clientes recorrentes (16,5% dos clientes). O TikTok é quase todo de compra única. Equity de marca genuíno, mas monetizá-lo ainda exige o próprio motor de aquisição da Bisyou trazendo novos clientes.", False)])
meta("Mix de destino do site próprio: Sudeste 57% (SP 37%, MG 10%, RJ 8%), Sul 15%, Nordeste 17%, Centro-Oeste 8%, Norte 3%.")

h2("6. Por que isto funciona para a GE Beauty (puramente operacional)")
para("Visão geral. A vantagem está inteiramente na estrutura de custo: os donos rodaram uma base fixa pesada e contrataram crescimento a preços fixos; nós rodamos uma base leve e compramos crescimento a preços variáveis, por performance. Mesma receita, resultado final muito diferente.")
h3("A base de custos que carregaríamos")
table([["Linha", "Deles (2026 anual.)", "Nossa", "Detalhamento / por que difere"],
 ["Serviço de dívida", "~1,5M", "0", "Nenhuma dívida assumida no licenciamento"],
 ["Capital de giro (estoque)", "financiado por eles", "0", "Boniteca financia; pagamos M+2 após a venda"],
 ["Administrativo", "~1,6M", "~0,3M", "Shopify+apps ~R$110k; contabilidade na nossa função financeira ~R$120k; diversos ~R$70k"],
 ["Pessoas", "~1,1M", "~0,95M", "1 líder de marca/ops (custo total ~R$220k) + CX/mkt-ops/coord. fulfillment no time compartilhado (~R$730k)"],
 ["Publicidade", "~3,2M fixo (48% da líq.)", "variável", "CPA/afiliados via ferramentas do Flywheel, pagar por performance. Ilustrado a 25% da líq."]], numcols=(1, 2))
h3("As sinergias genuínas (apenas operacionais)")
bullets([
 "Mesmo fabricante (Boniteca) e modelo de distribuição que já operamos; a Boniteca ainda financia o estoque.",
 "Fulfillment, plataforma administrativa (Omnify) e time de financeiro/ops compartilhados: custo marginal de uma segunda marca é baixo.",
 "O motor de afiliados/CPA do Flywheel como modelo de marketing de custo variável: a disciplina de pagar por performance, sem contratos fixos."])
h3("O prêmio, em números (ilustrativo, run-rate do Shopify standalone)")
table([["Pró-forma anual ilustrativo", "R$"],
 ["Receita líquida (run-rate Shopify)", "~7,6M"],
 ["Lucro bruto (80%)", "~6,1M"],
 ["Vendas + logística + cartão (~17%)", "(1,30M)"],
 ["Marketing variável / CPA (25% da líq.)", "(1,91M)"],
 ["Fixo enxuto (pessoas ~0,95M + adm ~0,30M)", "(1,25M)"],
 ["Royalty (8% da líq.)", "(0,61M)"],
 ["EBITDA estimado", "~R$1,0M (14%)"]], numcols=(1,))
table([["Sensibilidade (líq. R$7,6M, royalty 8%)", "Mkt 20%", "Mkt 25%", "Mkt 30%"],
 ["EBITDA", "~R$1,42M", "~R$1,04M", "~R$0,66M"]], numcols=(1, 2, 3))
box('gold', [("A assimetria, sem rodeios. ", True), ("A marca que faz eles perderem ~R$3M/ano poderia nos render ~R$0,7-1,4M/ano, inteiramente pela estrutura de custos. Break-even de marketing ~39% da líquida (rodaram 48% recente, 32% no ano bom); receita de break-even ~R$4,2M líq. vs run-rate ~R$7,6M. A receita pode cair quase pela metade, ou o marketing rodar bem menos eficiente que o melhor deles, e ainda assim ficamos no azul. Essa margem de segurança é o caso.", False)])

h2("7. Os riscos, e onde está a armadilha")
box('risk', [("1. Eficiência de aquisição standalone. ", True), ("Tudo depende de comprar os clientes da Bisyou a <= ~35% da líquida. Os donos atuais rodaram 48%. Se não superarmos isso de forma relevante, o EBITDA evapora. Mitigante: teste pago antes de assumir compromisso.", False)])
box('risk', [("2. A base de site próprio segue caindo / é dependente de mídia. ", True), ("Mar (R$909k) -> Abr (R$597k) recuou, e conforme a seção 4 não conseguimos provar que o Shopify é independente do inchaço antigo. Maio/junho é o termômetro.", False)])
box('risk', [("3. O royalty é fixado errado. ", True), ("Sobre o bruto, ou com mínimo, transfere a fragilidade para nós. Ainda não definido, e somos nós que ditamos os termos.", False)])
box('risk', [("4. Custo de atenção. ", True), ("Um time de três pessoas; cada hora na Bisyou é uma hora a menos na GE Beauty.", False)])
box('risk', [("5. Risco de produto / estoque (não de capital de giro). ", True), ("A Boniteca carrega o estoque, sem desembolso de caixa, mas alguns SKUs são líquidos/vidro (água micelar, sabonete) com exposição a quebra e validade; demanda em SKUs de baixo giro é incerta.", False)])

h2("8. Custo de entrega: frete")
para("Uma distinção importante no frete: o '59% enviado grátis / R$6,52' é o que a Bisyou COBROU dos clientes (escolha de precificação), NÃO seu custo de envio. O custo real da transportadora atual deles (J&T/R3) não está nos dados, então essa comparação ainda não pode ser feita.")
para("O que podemos calcular é o nosso próprio custo de envio. Precificamos cada um dos 44.969 pedidos reconstruídos contra a tabela B2C da Unilog da GE (origem: filial de Serra/ES), por destino e cesta:")
table([["Custo de envio via contrato Unilog da GE", "Valor"],
 ["Custo de envio médio por pedido", "~R$26"],
 ["Como % do AOV", "~17%"],
 ["Frete anual implícito @ ~84k pedidos/ano", "~R$2,2M"]], numcols=(1,))
meta("Cálculo completo por pedido, resumo e premissas da tabela em Bisyou-Unilog-Freight-Cost.xlsx. Tarifas representativas por UF; mapeamento exato CEP->zona GEOCOM refinaria dentro de uma UF. Sem dado de peso, peso cubado inferido pelo tamanho do pedido (faixas do SE quase planas, 0,25-2 kg).")
box('gold', [("A conclusão sobre frete: ", True), ("nosso custo de envio é ~R$26/pedido; se isso é mais barato ou mais caro do que a Bisyou paga à J&T/R3 hoje fica EM ABERTO até vermos um mês das faturas de transportadora deles. Não assuma economia nem perda. A sinergia real de fulfillment é a consolidação de armazenagem/separação; a transportadora é escolhida pela cotação real.", False)])

h2("9. Termos do negócio e alavancas de negociação")
bullets([
 "Royalty: limitar a um dígito da LÍQUIDA, sem mínimo; atrelar aumentos à receita que de fato reconstruirmos.",
 "Opção de compra: fixar o preço de exercício agora e baixo, reconstruímos o equity durante a licença; não pagar duas vezes pelo nosso próprio trabalho.",
 "Prova de eficiência de marketing: teste pago curto (ou earn-in) para validar aquisição a <=35% da líquida antes de compromisso profundo.",
 "Agência: decidir entre assumir o contrato Meta/Google ou pagar a multa de saída (o contrato vai até nov/2026); não se comprometer com o mínimo de R$60k/mês além do nosso plano.",
 "Canais mortos são potencial futuro, não valor a pagar hoje: não pagar por DPSP/B2B (mortos) nem pelo pico do TikTok.",
 "Declarações e garantias limpas: ANVISA ativa com datas, marca sem contestação, sem litígio ativo, acessos no fechamento."])

h2("10. Veredito e próximos passos")
box('verdict', [("AVANÇAR (CONDICIONAL). ", True), ("O downside é genuinamente limitado (sem capital de giro, sem dívida, licença limpa) e o upside vem de pura arbitragem operacional. Sustenta-se porque a estrutura de custos tolera uma queda de quase metade da receita ou um marketing bem menos eficiente do que o melhor que os donos atuais conseguiram. Falha se o royalty for ganancioso, se a base de site próprio ainda estiver em queda livre, ou se não conseguirmos provar aquisição standalone abaixo de ~35% da líquida.", False)])
h3("Próximos passos imediatos")
bullets([
 "Pedir ao Ivan a receita de site próprio de maio/junho e um mês de faturas reais de transportadora (J&T/R3).",
 "Obter os termos de royalty e o preço de exercício da opção de compra do Edson, por escrito.",
 "Desenhar um teste pequeno de aquisição paga standalone para validar o teto de marketing de <=35% da líquida antes do compromisso.",
 "Confirmar declarações sobre ANVISA / marca / litígio antes de qualquer term sheet."], ordered=True)

meta("Fontes: deck Road Show da Bisyou; balancetes jan-abr 2026; relatorio faturamento_GE.xlsx (reconstrução de 45.626 pedidos); tabela de frete B2C Unilog da GE. Papéis de trabalho em sandbox/bisyou/diligence/. Números pró-forma ilustrativos e dirigidos por premissas; uso interno de decisão apenas.")

doc.save(r"c:\claude\sandbox\bisyou\diligence\Bisyou-Memorando-Investimento-PT.docx")
print("saved docx PT")
