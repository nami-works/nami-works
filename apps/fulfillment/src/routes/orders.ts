import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client-fulfillment";
import { z } from "zod";
import { authorizeTenantRequest } from "../auth/tenant-auth.js";
import { prisma } from "../db/prisma.js";
import { NFeParseError, parseNFe, type ParsedNFe } from "../nfe/parser.js";
import { runIngestionGates } from "../nfe/ingestion-gates.js";
import { tenantLogger } from "../lib/logger.js";

const ParamsSchema = z.object({ tenant: z.string().min(1) });

export async function mountOrderRoutes(app: FastifyInstance): Promise<void> {
  // Accept raw XML bodies on the orders endpoint. The default JSON parser
  // would reject text/xml; register an explicit content-type parser scoped
  // to this content type so the rest of the app can still use JSON.
  app.addContentTypeParser(
    ["application/xml", "text/xml"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );

  app.post("/v1/:tenant/orders", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid tenant slug" });
    }
    const slug = params.data.tenant;
    const log = tenantLogger(slug).child({ requestId: request.id });

    // Auth + tenant lookup.
    const auth = await authorizeTenantRequest({
      slug,
      authorizationHeader: request.headers.authorization,
    });
    if (!auth.ok) {
      log.warn({ status: auth.status }, "auth_failed");
      return reply.code(auth.status).send({ error: auth.error });
    }
    const tenant = auth.tenant;

    // Body shape. fast-xml-parser handles raw string XML; reject early if
    // the body isn't a non-empty string.
    const xml = typeof request.body === "string" ? request.body : "";
    if (!xml.trim()) {
      return reply.code(400).send({ error: "XML body required" });
    }

    // Parse.
    let nfe: ParsedNFe;
    try {
      nfe = parseNFe(xml);
    } catch (err) {
      if (err instanceof NFeParseError) {
        log.warn({ err: err.message }, "nfe_parse_failed");
        return reply
          .code(400)
          .send({ error: "invalid NFe XML", detail: err.message });
      }
      throw err;
    }

    // Idempotency: if we've already accepted this chaveAcesso, return the
    // current row's status. Safe to call multiple times from a retrying ERP.
    const existing = await prisma.fulfillmentOrder.findUnique({
      where: { chaveAcesso: nfe.chaveAcesso },
      select: { id: true, status: true, chaveAcesso: true },
    });
    if (existing) {
      log.info(
        { chaveAcesso: nfe.chaveAcesso, status: existing.status },
        "duplicate_ingestion",
      );
      return reply.code(200).send({
        id: existing.id,
        chaveAcesso: existing.chaveAcesso,
        status: existing.status,
      });
    }

    // Ingestion gates — anti-spoofing CNPJ + SEFAZ status + tpNF + finNFe.
    const gate = runIngestionGates(nfe, tenant.cnpj);
    if (!gate.ok) {
      log.warn(
        { code: gate.code, chaveAcesso: nfe.chaveAcesso },
        "ingestion_gate_rejected",
      );
      const status = gate.code === "CNPJ_MISMATCH" ? 409 : 422;
      return reply
        .code(status)
        .send({ error: gate.code, detail: gate.reason });
    }

    // Persist. rawXmlS3Key is a placeholder until the S3 uploader lands —
    // for v0 we record the chaveAcesso-derived key shape; the actual upload
    // happens in a follow-up worker. The schema requires the field, so we
    // populate it deterministically.
    const rawXmlS3Key = `tenants/${tenant.slug}/nfe/${nfe.chaveAcesso}.xml`;

    const created = await prisma.fulfillmentOrder.create({
      data: {
        tenantId: tenant.id,
        chaveAcesso: nfe.chaveAcesso,
        merchantOrderRef: nfe.merchantOrderRef,
        nfeNumero: nfe.nfeNumero,
        nfeSerie: nfe.nfeSerie,
        emissaoAt: new Date(nfe.emissaoAt),
        tpNF: nfe.tpNF,
        finNFe: nfe.finNFe,
        sefazStatus: nfe.sefazStatus,
        sefazProtocolo: nfe.sefazProtocolo,
        emitCnpj: nfe.emitCnpj,
        emitRazaoSocial: nfe.emitRazaoSocial,
        emitNomeFantasia: nfe.emitNomeFantasia ?? null,
        emitEndereco: nfe.emitEndereco as Prisma.InputJsonValue,
        destCpfCnpj: nfe.destCpfCnpj,
        destNome: nfe.destNome,
        destEmail: nfe.destEmail ?? null,
        destTelefone: nfe.destTelefone ?? null,
        destEndereco: nfe.destEndereco as Prisma.InputJsonValue,
        entregaEndereco: nfe.entregaEndereco
          ? (nfe.entregaEndereco as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        modFrete: nfe.modFrete,
        transpCnpj: nfe.transpCnpj ?? null,
        transpRazaoSocial: nfe.transpRazaoSocial ?? null,
        totalProdutos: nfe.totalProdutos,
        totalDesconto: nfe.totalDesconto,
        totalFrete: nfe.totalFrete,
        totalNFe: nfe.totalNFe,
        pesoBrutoKg: nfe.pesoBrutoKg ?? null,
        pesoLiquidoKg: nfe.pesoLiquidoKg ?? null,
        volumes: nfe.volumes ?? null,
        rawXmlS3Key,
        items: {
          create: nfe.items.map((item) => ({
            nItem: item.nItem,
            codigo: item.codigo,
            descricao: item.descricao,
            quantidade: item.quantidade,
            unidade: item.unidade,
            valorUnitario: item.valorUnitario,
            valorTotal: item.valorTotal,
            valorDesconto: item.valorDesconto ?? null,
            ean: item.ean ?? null,
          })),
        },
      },
      select: { id: true, chaveAcesso: true, status: true },
    });

    log.info(
      {
        chaveAcesso: created.chaveAcesso,
        merchantOrderRef: nfe.merchantOrderRef,
        itemCount: nfe.items.length,
      },
      "order_received",
    );

    return reply.code(201).send(created);
  });
}
