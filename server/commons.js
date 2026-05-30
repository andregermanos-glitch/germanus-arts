// server/commons.js — Wikimedia Commons v2
// Filtro de licença permissivo + artistas internacionais por ala

const ALA_TERMOS = {
  retratos:      ["Ilya Repin portrait painting","Ivan Kramskoy portrait","Valentin Serov portrait","Russian portrait 19th century"],
  pessoas_reais: ["Vasily Surikov historical painting","Russian tsar portrait","Repin historical figures","Russian nobility painting"],
  historico:     ["Vasily Surikov battle painting","Russian history painting","Russian revolution art","Russian war painting 19th century"],
  perspectiva:   ["Russian interior painting","Russian room painting","Russian perspective art","Russian cityscape interior"],
  objetos:       ["Russian still life painting","Russian flowers painting","Russian kitchen still life","Boris Kustodiev still life"],
  lugares:       ["Isaac Levitan landscape Russia","Russian village painting","Russian landscape famous","Alexei Savrasov landscape"],
  natureza:      ["Ivan Shishkin forest painting","Russian nature painting","Russian winter landscape","Arkhip Kuindzhi landscape"],
  familiar:      ["Russian domestic scene painting","Russian family painting","Russian everyday life art","Russian peasant interior"],
  nudes:         ["Russian nude painting","Russian figure painting","Russian mythology Venus","Karl Bryullov figure painting"],
  esoterico:     ["Mikhail Vrubel demon painting","Russian symbolist art","Russian mystical painting","Vrubel fantasy art"],
  sacro:         ["Russian Orthodox icon painting","Russian religious art","Russian Madonna painting","Russian biblical scene"],
  arquitetura:   ["Russian architecture watercolor","Russian cathedral painting","Russian church art","Russian building painting"],
  povo:          ["Russian peasant painting","Russian workers art","Russian folk scene","Vasily Perov peasant painting"],
  luz_sol:       ["Russian impressionist painting","Russian summer painting","Russian sunlight art","Russian plein air"],
  cores:         ["Wassily Kandinsky abstract","Russian avant-garde painting","Russian colorist art","Natalia Goncharova color"],
  cidades:       ["Kazimir Malevich abstract","Russian suprematism","Russian constructivism painting","Russian modernist abstract"],
  fase:          ["Mikhail Vrubel fantasy","Russian symbolist dream","Russian mystical art Vrubel","Russian fairy tale painting"],
  femininas:     ["Russian woman portrait painting","Russian female artist","Zinaida Serebriakova painting","Russian noblewoman art"]
};

const ARTISTAS_RUSSOS = [
  "Ilya Repin","Ivan Aivazovsky","Viktor Vasnetsov","Mikhail Vrubel","Ivan Shishkin",
  "Valentin Serov","Vasily Surikov","Ivan Kramskoy","Vasily Perov","Isaac Levitan",
  "Boris Kustodiev","Kazimir Malevich","Wassily Kandinsky","Natalia Goncharova",
  "Mikhail Larionov","Alexei Savrasov","Arkhip Kuindzhi","Konstantin Makovsky",
  "Vladimir Borovikovsky","Karl Bryullov","Alexander Ivanov","Nikolai Ge",
  "Vasily Polenov","Illarion Pryanishnikov","Zinaida Serebriakova","Pavel Fedotov"
];

function isPublicDomain(license, date) {
  if (!license && !date) return true; // sem info → tentar
  const l = (license || "").toLowerCase();
  const d = (date || "").toLowerCase();
  // Rejeitar só licenças claramente não-livres
  if (l.includes("all rights reserved") || l.includes("copyright") || l.includes("cc by-nc") || l.includes("cc by-nd")) return false;
  // Aceitar domínio público e licenças abertas
  if (l.includes("public domain") || l.includes("pd-") || l.includes("cc0") ||
      l.includes("cc by") || l.includes("cc-by") || l.includes("attribution") ||
      l.includes("free") || l === "") return true;
  // Verificar data — antes de 1928 é sempre domínio público
  const yearMatch = d.match(/\b(1[0-9]{3})\b/);
  if (yearMatch && parseInt(yearMatch[1]) < 1928) return true;
  return true; // dúvida → incluir
}

async function buscarImagemWikimedia(termo, limite = 8) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(termo)}&gsrnamespace=6&gsrlimit=${limite}`
    + `&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|DateTimeOriginal`
    + `&format=json&origin=*`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const imagens = [];
    for (const page of Object.values(d.query?.pages || {})) {
      const ii = page.imageinfo?.[0];
      if (!ii?.url) continue;
      const meta = ii.extmetadata || {};
      const license = meta.LicenseShortName?.value || "";
      const artist  = (meta.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
      const date    = meta.DateTimeOriginal?.value || "";
      if (!isPublicDomain(license, date)) continue;
      // Só imagens (não svg de logotipos, não ficheiros de audio)
      if (!ii.url.match(/\.(jpg|jpeg|png|tiff?)$/i)) continue;
      imagens.push({
        title: (page.title || "").replace(/^File:/, ""),
        url:   ii.url,
        artist, date, license
      });
    }
    return imagens;
  } catch(e) {
    console.log(`  [Commons] ${termo}: ${e.message}`);
    return [];
  }
}

async function buscarObrasPorAla(pool, alaId, limite = 20) {
  const termos = ALA_TERMOS[alaId] || ["Russian painting art"];
  const resultados = [];
  const seenUrls = new Set();

  for (const termo of termos) {
    if (resultados.length >= limite) break;
    const imagens = await buscarImagemWikimedia(termo, 10);
    for (const img of imagens) {
      if (resultados.length >= limite) break;
      if (seenUrls.has(img.url)) continue;
      seenUrls.add(img.url);
      const id = `commons_${alaId}_${Buffer.from(img.url).toString("base64").slice(0,20).replace(/[^a-z0-9]/gi,"_")}`;
      resultados.push({
        id, source: "wikimedia_commons",
        title:  img.title.replace(/\.(jpg|jpeg|png|tiff?)$/i,"").slice(0,200),
        artist: img.artist || "Artista russo",
        date:   img.date?.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/)?.[0] || "",
        museum: "Wikimedia Commons — Domínio Público",
        image_url: img.url,
        ala_id: alaId
      });
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  ✓ [${alaId}] ${resultados.length} obras Commons`);
  return resultados;
}

async function carregarTodasAlas(pool, limitePorAla = 15) {
  const todas = [];
  for (const ala of Object.keys(ALA_TERMOS)) {
    const obras = await buscarObrasPorAla(pool, ala, limitePorAla);
    todas.push(...obras);
    await new Promise(r => setTimeout(r, 500));
  }
  return todas;
}

async function salvarObras(pool, obras) {
  let salvas = 0, erros = 0;
  for (const obra of obras) {
    try {
      await pool.query(
        `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit)
         VALUES ($1,'wikimedia_commons',$2,$3,$4,$5,$6,$7,'Domínio Público — Wikimedia Commons')
         ON CONFLICT (id) DO UPDATE SET image_url=EXCLUDED.image_url`,
        [obra.id, obra.title, obra.artist, obra.date, obra.museum, obra.image_url, obra.ala_id]
      );
      salvas++;
    } catch { erros++; }
  }
  return { salvas, erros };
}

module.exports = { buscarObrasPorAla, carregarTodasAlas, salvarObras, ARTISTAS_RUSSOS, ALA_TERMOS };
