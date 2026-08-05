// Seeds the data inlined in docs/handoff-cash-funding-webapp.md: the two
// funders, UAUBox + B4A deliveries (installments generate from these via the
// server's own due-date logic), and the one already-executed Itaú operation.
// Run with: npm run seed -w @nami/cash-funding

import { PrismaClient } from "@prisma/client-cash-funding";
import { generateInstallmentValues } from "../../apps/cash-funding/src/domain/generateInstallments.js";

const prisma = new PrismaClient();

async function main() {
  const itau = await prisma.funder.upsert({
    where: { name: "Itaú" },
    update: {},
    create: {
      name: "Itaú",
      type: "bank",
      taxaAmPct: 1.72,
      iofDiarioPct: 0.0082,
      iofFixoPct: 0.38,
      tarifaOperacao: 260,
      tarifaTitulo: 4.5,
      tenorMaxDias: 210,
      tetoLinha: 650000,
      perSacadoCap: null,
      recourse: true,
      costsConfirmed: true,
      notes:
        "CET ref 30,13% a.a. Teto R$650.000 dictado pelo usuário, não verificado.",
    },
  });

  await prisma.funder.upsert({
    where: { name: "Ghia" },
    update: {},
    create: {
      name: "Ghia",
      type: "fidc",
      taxaAmPct: 2.0,
      iofDiarioPct: 0, // assumed — FIDC true-sale, unconfirmed
      iofFixoPct: 0, // assumed, unconfirmed
      tarifaOperacao: 0, // not yet quantified
      tarifaTitulo: 0, // not yet quantified
      tenorMaxDias: 120,
      tetoLinha: 500000,
      perSacadoCap: 250000,
      recourse: true,
      costsConfirmed: false,
      notes:
        "Ghia Crédito Corporativo FIDC (51.498.070/0001-52, cessionário) · Ghia Gestão de Recursos (35.070.686/0001-71, gestora) · Ghia Capital (14.662.218/0001-16, originadora). " +
        "24% a.a. nom / 26,82% efet. IOF, tarifas e CET NÃO CONFIRMADOS — custo é uma estimativa. Não ativa ainda (R$0 usado). Confirmar avalista pessoal (Camila Coutinho Valença).",
    },
  });

  async function createDelivery(
    d: Omit<Parameters<typeof prisma.delivery.create>[0]["data"], "id">,
  ) {
    const delivery = await prisma.delivery.create({ data: d });
    const rows = generateInstallmentValues({
      total: Number(d.total),
      numParcelas: d.numParcelas,
      firstOffsetDias: d.firstOffsetDias,
      intervalDias: d.intervalDias,
      calendar: d.calendar,
      dataEntrega: d.dataEntrega as Date,
    });
    for (const r of rows) {
      await prisma.installment.create({
        data: {
          deliveryId: delivery.id,
          numero: r.numero,
          valorFace: r.valorFace,
          dataVencimento: r.dataVencimento,
        },
      });
    }
    return delivery;
  }

  const UAU_CNPJ = "28.917.082/0001-52";
  await createDelivery({
    cliente: "UAUBOX LTDA",
    cnpjSacado: UAU_CNPJ,
    produto: "Shampoo a Seco (Março)",
    qtd: 17000,
    precoUnit: 17.19,
    total: 292230.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "corrido",
    dataEntrega: new Date("2026-02-15"),
    status: "received",
  });
  await createDelivery({
    cliente: "UAUBOX LTDA",
    cnpjSacado: UAU_CNPJ,
    produto: "Booster Hidratante (Maio)",
    qtd: 17000,
    precoUnit: 18.29,
    total: 310930.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "corrido",
    dataEntrega: new Date("2026-04-15"),
    status: "received",
    notes: "Mostly received (per handoff — not all installments confirmed settled).",
  });
  await createDelivery({
    cliente: "UAUBOX LTDA",
    cnpjSacado: UAU_CNPJ,
    produto: "Booster Definição (Novembro, revisado)",
    qtd: 26500,
    precoUnit: 21.83,
    total: 578495.0,
    numParcelas: 5,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "corrido",
    dataEntrega: new Date("2026-10-15"),
    status: "invoiced",
    notes:
      "Revisado de 17.000un/R$371.110 (4x92.777,50) para 26.500un/R$578.495 (5x115.699) por e-mail 31/07, confirmado por Raquel (Grupo UAU) 03/08. " +
      "4 originais faturadas; ainda a emitir R$207.385 (incremento 4x22.921,50 + 5ª parcela 115.699). Aditivo pendente, mas não é pré-requisito para antecipar.",
  });

  const B4A_CNPJ = "13.475.001/0001-34";
  await createDelivery({
    cliente: "B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A.",
    cnpjSacado: B4A_CNPJ,
    produto: "Shampoo sem sulfato 60ml",
    qtd: 15000,
    precoUnit: 7.0,
    total: 105000.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "terca_3_25",
    dataEntrega: new Date("2026-08-05"),
    status: "planned",
    notes: "Ajuda de custo (não é o valor de varejo/PDV). Dia de entrega (05) é placeholder — confirmar data real.",
  });
  await createDelivery({
    cliente: "B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A.",
    cnpjSacado: B4A_CNPJ,
    produto: "Máscara condicionadora 50ml",
    qtd: 15000,
    precoUnit: 7.0,
    total: 105000.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "terca_3_25",
    dataEntrega: new Date("2026-08-05"),
    status: "planned",
    notes: "Ajuda de custo. Dia de entrega (05) é placeholder.",
  });
  await createDelivery({
    cliente: "B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A.",
    cnpjSacado: B4A_CNPJ,
    produto: "Leave-in c/ proteção térmica 150ml",
    qtd: 15000,
    precoUnit: 12.0,
    total: 180000.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "terca_3_25",
    dataEntrega: new Date("2026-10-05"),
    status: "planned",
    notes: "Ajuda de custo. Dia de entrega (05) é placeholder.",
  });
  await createDelivery({
    cliente: "B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A.",
    cnpjSacado: B4A_CNPJ,
    produto: "Shampoo a seco 150ml",
    qtd: 15000,
    precoUnit: 14.0,
    total: 210000.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "terca_3_25",
    dataEntrega: new Date("2026-11-05"),
    status: "planned",
    notes: "Ajuda de custo. Dia de entrega (05) é placeholder.",
  });
  await createDelivery({
    cliente: "B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A.",
    cnpjSacado: B4A_CNPJ,
    produto: "Booster Antifrizz 15ml",
    qtd: 20000,
    precoUnit: 12.0,
    total: 240000.0,
    numParcelas: 4,
    firstOffsetDias: 30,
    intervalDias: 30,
    calendar: "terca_3_25",
    dataEntrega: new Date("2026-12-05"),
    status: "planned",
    notes: "Ajuda de custo. Dia de entrega (05) é placeholder.",
  });

  // Executed operation on the books — booked before the Booster Definição
  // revision, so it doesn't reconcile 1:1 to today's installment rows (see
  // handoff's "R$70k gap" open item). Left unlinked to installments.
  await prisma.operation.upsert({
    where: { opNumero: "1359525753" },
    update: {},
    create: {
      funderId: itau.id,
      opNumero: "1359525753",
      dataOperacao: new Date("2026-07-16"),
      faceTotal: 185555.0,
      juros: 14627.92,
      iof: 2574.88,
      tarifas: 264.5,
      custoTotal: 17467.3,
      liquido: 168087.7,
      dataVencimentoFinal: new Date("2026-12-15"),
      notes:
        "UAUBox Booster Definição, parcelas nov+dez aos valores ANTIGOS (R$92.777,50 cada, pré-revisão). Gap de ~R$70k vs teto dictado R$255.555 — não reconciliado.",
    },
  });

  // Seed Lucas as the first invited user so Google login has someone to bind to.
  await prisma.user.upsert({
    where: { email: "lucas@gebeauty.com.br" },
    update: {},
    create: { email: "lucas@gebeauty.com.br", name: "Lucas Guimarães", status: "active" },
  });

  console.log("Seed complete: 2 funders, 8 deliveries, 1 operation, 1 user.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
