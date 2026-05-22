import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const AddressSchema = z.object({
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string().optional(),
  bairro: z.string(),
  codigoMunicipio: z.string(),
  municipio: z.string(),
  uf: z.string().length(2),
  cep: z.string(),
  pais: z.string().optional(),
  telefone: z.string().optional(),
});

export type ParsedAddress = z.infer<typeof AddressSchema>;

export const ParsedItemSchema = z.object({
  nItem: z.number().int().positive(),
  codigo: z.string(),
  descricao: z.string(),
  quantidade: z.string(),
  unidade: z.string(),
  valorUnitario: z.string(),
  valorTotal: z.string(),
  valorDesconto: z.string().optional(),
  ean: z.string().optional(),
});
export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const ParsedNFeSchema = z.object({
  chaveAcesso: z.string().length(44),
  nfeNumero: z.string(),
  nfeSerie: z.string(),
  emissaoAt: z.string(),
  tpNF: z.number().int(),
  finNFe: z.number().int(),
  emitCnpj: z.string(),
  emitRazaoSocial: z.string(),
  emitNomeFantasia: z.string().optional(),
  emitEndereco: AddressSchema,
  destCpfCnpj: z.string(),
  destNome: z.string(),
  destEmail: z.string().optional(),
  destTelefone: z.string().optional(),
  destEndereco: AddressSchema,
  entregaEndereco: AddressSchema.optional(),
  modFrete: z.number().int(),
  transpCnpj: z.string().optional(),
  transpRazaoSocial: z.string().optional(),
  totalProdutos: z.string(),
  totalDesconto: z.string(),
  totalFrete: z.string(),
  totalNFe: z.string(),
  pesoBrutoKg: z.string().optional(),
  pesoLiquidoKg: z.string().optional(),
  volumes: z.number().int().optional(),
  sefazStatus: z.number().int(),
  sefazProtocolo: z.string(),
  merchantOrderRef: z.string(),
  items: z.array(ParsedItemSchema).nonempty(),
});
export type ParsedNFe = z.infer<typeof ParsedNFeSchema>;

export class NFeParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NFeParseError";
  }
}

// Best-effort scalar coerce. NFe XML carries numeric leaf values as strings
// (e.g. "1", "100", "0.1000"). We keep strings for monetary fields so Prisma
// can parse them as Decimal without precision loss; we coerce only the
// integers that are enum-like (tpNF, finNFe, modFrete, cStat, qVol, nItem).
function str(v: unknown): string {
  if (v === null || v === undefined) {
    throw new NFeParseError("expected string-like value, got null/undefined");
  }
  return String(v);
}

function optStr(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return String(v);
}

function int(v: unknown, fieldPath: string): number {
  if (v === null || v === undefined || v === "") {
    throw new NFeParseError(`expected int at ${fieldPath}, got empty`);
  }
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new NFeParseError(`expected int at ${fieldPath}, got ${String(v)}`);
  }
  return n;
}

function optInt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

function pickCpfOrCnpj(dest: Record<string, unknown>): string {
  if (typeof dest.CPF === "string") return dest.CPF;
  if (typeof dest.CNPJ === "string") return dest.CNPJ;
  if (typeof dest.idEstrangeiro === "string") return dest.idEstrangeiro;
  throw new NFeParseError(
    "dest is missing CPF / CNPJ / idEstrangeiro — one is required",
  );
}

function parseAddress(node: Record<string, unknown>): ParsedAddress {
  return {
    logradouro: str(node.xLgr),
    numero: str(node.nro),
    complemento: optStr(node.xCpl),
    bairro: str(node.xBairro),
    codigoMunicipio: str(node.cMun),
    municipio: str(node.xMun),
    uf: str(node.UF),
    cep: str(node.CEP),
    pais: optStr(node.xPais),
    telefone: optStr(node.fone),
  };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseNFe(xml: string): ParsedNFe {
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch (err) {
    throw new NFeParseError("failed to parse NFe XML", err);
  }

  // Two valid shapes: <nfeProc> (signed + authorized) or <NFe> alone (unsigned
  // / preview). Rota Local only ever stores authorized NFes, so the inner
  // <protNFe> block must be present for ingestion. The unsigned shape parses
  // here but will be rejected by the cStat ingestion gate downstream.
  const root = (raw as Record<string, unknown>)?.nfeProc ?? raw;
  const nfeProc = root as Record<string, unknown>;
  const nfe = (nfeProc.NFe ?? nfeProc) as Record<string, unknown>;
  const infNFe = nfe.infNFe as Record<string, unknown> | undefined;
  if (!infNFe) throw new NFeParseError("missing <infNFe> block");

  const chaveAcessoRaw = String(infNFe["@_Id"] ?? "");
  const chaveAcesso = chaveAcessoRaw.startsWith("NFe")
    ? chaveAcessoRaw.slice(3)
    : chaveAcessoRaw;
  if (chaveAcesso.length !== 44) {
    throw new NFeParseError(
      `chaveAcesso must be 44 digits (got ${chaveAcesso.length})`,
    );
  }

  const ide = infNFe.ide as Record<string, unknown>;
  const emit = infNFe.emit as Record<string, unknown>;
  const dest = infNFe.dest as Record<string, unknown>;
  const entrega = infNFe.entrega as Record<string, unknown> | undefined;
  const transp = infNFe.transp as Record<string, unknown> | undefined;
  const total = infNFe.total as Record<string, unknown> | undefined;
  const totalIcms =
    (total?.ICMSTot as Record<string, unknown> | undefined) ?? {};
  const compra = infNFe.compra as Record<string, unknown> | undefined;
  const protInfo = (nfeProc.protNFe as Record<string, unknown> | undefined)
    ?.infProt as Record<string, unknown> | undefined;

  const transpVol = transp?.vol as Record<string, unknown> | undefined;
  const transporta = transp?.transporta as Record<string, unknown> | undefined;

  const detsRaw = infNFe.det;
  const dets = asArray<Record<string, unknown>>(
    detsRaw as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );
  if (dets.length === 0) {
    throw new NFeParseError("NFe has no <det> items");
  }

  const items: ParsedItem[] = dets.map((det) => {
    const prod = det.prod as Record<string, unknown>;
    return {
      nItem: int(det["@_nItem"], "det/@nItem"),
      codigo: str(prod.cProd),
      descricao: str(prod.xProd),
      quantidade: str(prod.qCom),
      unidade: str(prod.uCom),
      valorUnitario: str(prod.vUnCom),
      valorTotal: str(prod.vProd),
      valorDesconto: optStr(prod.vDesc),
      ean: optStr(prod.cEAN),
    };
  });

  const parsed: ParsedNFe = {
    chaveAcesso,
    nfeNumero: str(ide.nNF),
    nfeSerie: str(ide.serie),
    emissaoAt: str(ide.dhEmi),
    tpNF: int(ide.tpNF, "ide/tpNF"),
    finNFe: int(ide.finNFe, "ide/finNFe"),

    emitCnpj: str(emit.CNPJ),
    emitRazaoSocial: str(emit.xNome),
    emitNomeFantasia: optStr(emit.xFant),
    emitEndereco: parseAddress(emit.enderEmit as Record<string, unknown>),

    destCpfCnpj: pickCpfOrCnpj(dest),
    destNome: str(dest.xNome),
    destEmail: optStr(dest.email),
    destTelefone: optStr(
      (dest.enderDest as Record<string, unknown> | undefined)?.fone,
    ),
    destEndereco: parseAddress(dest.enderDest as Record<string, unknown>),

    entregaEndereco: entrega ? parseAddress(entrega) : undefined,

    modFrete: int(transp?.modFrete, "transp/modFrete"),
    transpCnpj: optStr(transporta?.CNPJ),
    transpRazaoSocial: optStr(transporta?.xNome),

    totalProdutos: str(totalIcms.vProd),
    totalDesconto: str(totalIcms.vDesc),
    totalFrete: str(totalIcms.vFrete),
    totalNFe: str(totalIcms.vNF),
    pesoBrutoKg: optStr(transpVol?.pesoB),
    pesoLiquidoKg: optStr(transpVol?.pesoL),
    volumes: optInt(transpVol?.qVol),

    sefazStatus: int(protInfo?.cStat ?? -1, "protNFe/infProt/cStat"),
    sefazProtocolo: str(protInfo?.nProt ?? ""),

    merchantOrderRef: str(compra?.xPed ?? ""),

    items: items as [ParsedItem, ...ParsedItem[]],
  };

  return ParsedNFeSchema.parse(parsed);
}
