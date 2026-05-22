import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNFe, NFeParseError } from "../src/nfe/parser.js";
import { runIngestionGates } from "../src/nfe/ingestion-gates.js";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML_PATH = resolve(here, "fixtures/sample-nfe.xml");

describe("parseNFe — GE Beauty sample (chave 35260...124810)", () => {
  const xml = readFileSync(SAMPLE_XML_PATH, "utf8");
  const parsed = parseNFe(xml);

  it("extracts the 44-digit access key without the 'NFe' prefix", () => {
    expect(parsed.chaveAcesso).toBe("35260534987157000336550010000026481025124810");
  });

  it("extracts identity fields from <ide>", () => {
    expect(parsed.nfeNumero).toBe("2648");
    expect(parsed.nfeSerie).toBe("1");
    expect(parsed.tpNF).toBe(1);
    expect(parsed.finNFe).toBe(1);
    expect(parsed.emissaoAt).toBe("2026-05-20T23:46:19-03:00");
  });

  it("extracts emitter + nome fantasia", () => {
    expect(parsed.emitCnpj).toBe("34987157000336");
    expect(parsed.emitRazaoSocial).toBe("GE COSMETICOS LTDA");
    expect(parsed.emitNomeFantasia).toBe("GE BEAUTY");
    expect(parsed.emitEndereco.cep).toBe("01414002");
    expect(parsed.emitEndereco.municipio).toBe("Sao Paulo");
    expect(parsed.emitEndereco.uf).toBe("SP");
  });

  it("extracts dest with CPF (not CNPJ)", () => {
    expect(parsed.destCpfCnpj).toBe("28346931883");
    expect(parsed.destNome).toBe("Celia Marques");
    expect(parsed.destEmail).toBe("celinhammarques@gmail.com");
    expect(parsed.destTelefone).toBe("5511992280767");
    expect(parsed.destEndereco.cep).toBe("04707061");
  });

  it("extracts entrega address (separate from dest in this sample)", () => {
    expect(parsed.entregaEndereco).toBeDefined();
    expect(parsed.entregaEndereco?.cep).toBe("04707061");
  });

  it("extracts transp + weights", () => {
    expect(parsed.modFrete).toBe(9);
    expect(parsed.transpCnpj).toBeUndefined();
    expect(parsed.pesoBrutoKg).toBe("0.212");
    expect(parsed.pesoLiquidoKg).toBe("0.169");
  });

  it("extracts totals", () => {
    expect(parsed.totalProdutos).toBe("168.00");
    expect(parsed.totalDesconto).toBe("25.20");
    expect(parsed.totalFrete).toBe("0.00");
    expect(parsed.totalNFe).toBe("142.80");
  });

  it("extracts SEFAZ authorization status", () => {
    expect(parsed.sefazStatus).toBe(100);
    expect(parsed.sefazProtocolo).toBe("135261958594725");
  });

  it("maps compra/xPed → merchantOrderRef (Shopify order number)", () => {
    expect(parsed.merchantOrderRef).toBe("81062");
  });

  it("extracts both items with correct fields", () => {
    expect(parsed.items).toHaveLength(2);
    const [first, second] = parsed.items;
    expect(first?.nItem).toBe(1);
    expect(first?.codigo).toBe("GEB 003");
    expect(first?.ean).toBe("7896768471151");
    expect(first?.valorUnitario).toBe("99.00");
    expect(first?.valorDesconto).toBe("14.85");
    expect(second?.codigo).toBe("GEB 021");
    expect(second?.valorDesconto).toBe("10.35");
  });
});

describe("parseNFe — error paths", () => {
  it("rejects non-XML input", () => {
    expect(() => parseNFe("not xml at all")).toThrow(NFeParseError);
  });

  it("rejects XML missing infNFe", () => {
    expect(() => parseNFe("<nfeProc></nfeProc>")).toThrow(NFeParseError);
  });
});

describe("runIngestionGates — against GE Beauty sample", () => {
  const xml = readFileSync(SAMPLE_XML_PATH, "utf8");
  const parsed = parseNFe(xml);

  it("accepts when tenant CNPJ matches and SEFAZ/tpNF/finNFe are valid", () => {
    expect(runIngestionGates(parsed, "34987157000336")).toEqual({ ok: true });
  });

  it("rejects when tenant CNPJ differs (anti-spoofing)", () => {
    const gate = runIngestionGates(parsed, "00000000000000");
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.code).toBe("CNPJ_MISMATCH");
  });

  it("rejects when SEFAZ status isn't 100", () => {
    const gate = runIngestionGates(
      { ...parsed, sefazStatus: 101 },
      "34987157000336",
    );
    expect(gate.ok === false && gate.code).toBe("SEFAZ_NOT_AUTHORIZED");
  });

  it("rejects entrada NFes (tpNF=0)", () => {
    const gate = runIngestionGates(
      { ...parsed, tpNF: 0 },
      "34987157000336",
    );
    expect(gate.ok === false && gate.code).toBe("NOT_OUTBOUND");
  });

  it("rejects devolução NFes (finNFe=4)", () => {
    const gate = runIngestionGates(
      { ...parsed, finNFe: 4 },
      "34987157000336",
    );
    expect(gate.ok === false && gate.code).toBe("NOT_NORMAL_OPERATION");
  });
});
