// Sector pages (site-brief-260930.md, page 5) -- template ready, no sectors
// chosen yet ("Which 2-3 sectors ship first" is an open decision owned by
// Lucas). This array stays empty until that's decided: /setores/[setor].astro
// reads getStaticPaths from here, so an empty array means zero live pages
// for now rather than a fake placeholder sector going out under a real URL.
//
// Shape for when sectors are added:
// {
//   slug: "distribuidoras",
//   nome: "Distribuidoras",
//   dores: ["a dor mais aguda", "a segunda", "a terceira"],
//   sistemas: ["ERP comum ao setor", "outro sistema comum"],
//   exemplo: {
//     titulo: "um exemplo de trabalho resolvido",
//     corpo: "a situação, com números inventados e marcados como exemplo",
//   },
// }
export interface Setor {
  slug: string;
  nome: string;
  dores: string[];
  sistemas: string[];
  exemplo: { titulo: string; corpo: string };
}

export const SETORES: Setor[] = [];
