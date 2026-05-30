// server/commons.js - Busca obras em domínio público no Wikimedia Commons
// Foco: artistas russos e obras relacionadas à arte russa

// Mapeamento de alas para termos de busca
const ALA_TERMOS = {
  retratos: ["Russian portrait painting", "Russian portrait 19th century", "Repin portrait", "Kramskoy portrait"],
  pessoas_reais: ["Russian historical figures portrait", "Tsar portrait Russia", "Russian nobility painting", "Repin historical figures"],
  historico: ["Russian historical event painting", "Battle painting Russia", "Russian history 19th century art", "Surikov history painting"],
  perspectiva: ["Russian landscape perspective", "Russian cityscape painting", "Russian street view art", "Shishkin forest perspective"],
  objetos: ["Russian still life painting", "Russian still life art", "Russian kitchen painting", "Russian flowers still life"],
  lugares: ["Russian famous place painting", "Moscow painting 19th century", "St Petersburg art", "Russian landscape famous"],
  natureza: ["Russian landscape painting", "Russian forest painting", "Russian winter landscape art", "Shishkin forest"],
  familiar: ["Russian family painting", "Russian domestic scene art", "Russian peasant life painting", "Russian everyday life art"],
  nudes: ["Russian nude painting", "Russian figure painting", "Russian mythology painting", "Russian Venus painting"],
  esoterico: ["Russian symbolist painting", "Russian mystical art", "Vrubel demon painting", "Russian occult art"],
  sacro: ["Russian religious painting", "Russian Orthodox icon", "Russian biblical scene art", "Russian Madonna painting"],
  arquitetura: ["Russian architecture painting", "Russian church painting", "Russian cathedral art", "Russian building watercolor"],
  povo: ["Russian peasant painting", "Russian worker art", "Russian folk scene painting", "Russian people genre"],
  luz_sol: ["Russian sunlight painting", "Russian summer landscape", "Russian golden hour art", "Russian impressionist light"],
  cores: ["Russian colorist painting", "Russian avant-garde color", "Russian bright colors art", "Kandinsky colorful painting"],
  cidades: ["Russian abstract art", "Russian avant-garde painting", "Russian modernist art", "Russian Suprematism"],
  fase: ["Russian surrealist painting", "Russian fantasy art", "Russian dream painting", "Russian mystical artwork"],
  femininas: ["Russian female painter", "Russian woman artist", "Russian portrait of woman", "Russian noblewoman painting"]
};

// Artistas russos famosos para busca direta
const ARTISTAS_RUSSOS = [
  "Ilya Repin", "Ivan Aivazovsky", "Viktor Vasnetsov", "Mikhail Vrubel", "Ivan Shishkin",
  "Valentin Serov", "Vasily Surikov", "Ivan Kramskoy", "Vasily Perov", "Isaac Levitan",
  "Boris Kustodiev", "Kazimir Malevich", "Wassily Kandinsky", "Marc Chagall", "Natalia Goncharova",
  "Mikhail Larionov", "Alexei Savrasov", "Arkhip Kuindzhi", "Konstantin Makovsky", "Vladimir Borovikovsky"
];

// Função para buscar imagens no Wikimedia Commons
async function buscarImagemWikimedia(termo) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(termo)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url&format=json&origin=*`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    const imagens = [];
    
    if (data.query && data.query.pages) {
      for (const page of Object.values(data.query.pages)) {
        if (page.imageinfo && page.imageinfo[0] && page.title) {
          imagens.push({
            title: page.title.replace(/^File:/, ''),
            url: page.imageinfo[0].url,
            pageid: page.pageid
          });
        }
      }
    }
    return imagens;
  } catch (error) {
    console.error(`Erro Wikimedia: ${termo}`, error.message);
    return [];
  }
}

// Buscar informações detalhadas de uma imagem
async function getImageInfo(filename) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(filename)}&prop=imageinfo&iiprop=extmetadata|url&format=json&origin=*`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    const pages = data.query?.pages || {};
    const page = Object.values(pages)[0];
    
    if (page && page.imageinfo && page.imageinfo[0]) {
      const info = page.imageinfo[0];
      const meta = info.extmetadata || {};
      
      return {
        url: info.url,
        description: meta.ImageDescription?.value || "",
        artist: meta.Artist?.value || "",
        date: meta.Date?.value || "",
        license: meta.LicenseShortName?.value || ""
      };
    }
  } catch (error) {
    console.error(`Erro info: ${filename}`, error.message);
  }
  return null;
}

// Extrair artista da descrição
function extrairArtista(desc, filename) {
  if (!desc) return null;
  for (const artista of ARTISTAS_RUSSOS) {
    if (desc.toLowerCase().includes(artista.toLowerCase())) return artista;
  }
  const match = desc.match(/by\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  return match ? match[1] : null;
}

// Extrair ano
function extrairAno(dataStr) {
  if (!dataStr) return "";
  const match = dataStr.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return match ? match[0] : "";
}

// Função principal - buscar obras por ala
async function buscarObrasPorAla(pool, alaId, limite = 30) {
  const termos = ALA_TERMOS[alaId] || ["Russian painting", "Russian art"];
  const resultados = [];
  const seenUrls = new Set();
  
  console.log(`🔍 Buscando obras para ala "${alaId}" no Wikimedia Commons...`);
  
  for (const termo of termos) {
    if (resultados.length >= limite) break;
    
    const imagens = await buscarImagemWikimedia(termo);
    
    for (const img of imagens) {
      if (resultados.length >= limite) break;
      if (seenUrls.has(img.url)) continue;
      
      const info = await getImageInfo(`File:${img.title}`);
      if (!info || !info.url) continue;
      
      // Verificar se é domínio público
      if (!info.license || (!info.license.includes('Public domain') && !info.license.includes('CC0') && !info.license.includes('CC BY'))) {
        continue;
      }
      
      const artista = extrairArtista(info.description, img.title) || info.artist || "Artista russo";
      const ano = extrairAno(info.date) || info.date || "";
      const id = `commons_${alaId}_${resultados.length}_${Date.now()}`;
      
      seenUrls.add(img.url);
      resultados.push({
        id: id,
        source: "wikimedia_commons",
        title: img.title.replace(/\.(jpg|jpeg|png|gif|tiff)$/i, '').substring(0, 200),
        artist: artista.substring(0, 200),
        date: ano.substring(0, 50),
        museum: "Wikimedia Commons - Domínio Público / Coleção Russa",
        image_url: info.url,
        ala_id: alaId
      });
      
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  console.log(`  ✓ Encontradas ${resultados.length} obras para ${alaId}`);
  return resultados;
}

// Função para carregar todas as alas
async function carregarTodasAlas(pool, limitePorAla = 15) {
  const alas = Object.keys(ALA_TERMOS);
  const todosResultados = [];
  
  for (const ala of alas) {
    console.log(`\n📁 Processando ala: ${ala}`);
    const obras = await buscarObrasPorAla(pool, ala, limitePorAla);
    todosResultados.push(...obras);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return todosResultados;
}

// Salvar obras no banco
async function salvarObras(pool, obras) {
  let salvas = 0;
  let erros = 0;
  
  for (const obra of obras) {
    try {
      await pool.query(`
        INSERT INTO artworks (id, source, title, artist, date, museum, image_url, ala_id, credit, image_cached_at)
        VALUES ($1, 'wikimedia_commons', $2, $3, $4, $5, $6, $7, $8, 0)
        ON CONFLICT (id) DO UPDATE SET 
          title = EXCLUDED.title, artist = EXCLUDED.artist, image_url = EXCLUDED.image_url
      `, [obra.id, obra.title, obra.artist, obra.date, obra.museum, obra.image_url, obra.ala_id, "Imagem em domínio público via Wikimedia Commons"]);
      salvas++;
    } catch (err) {
      erros++;
    }
  }
  return { salvas, erros };
}

module.exports = {
  buscarObrasPorAla,
  carregarTodasAlas,
  salvarObras,
  ARTISTAS_RUSSOS,
  ALA_TERMOS
};
