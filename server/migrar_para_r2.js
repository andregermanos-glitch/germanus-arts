// ═══════════════════════════════════════════════════════════════════════════
// migrar_para_r2.js — Baixa as imagens dos museus para o Cloudflare R2 (uma vez)
// O banco passa a guardar a URL do R2. Roda via Railway Start Command override:
//   node server/migrar_para_r2.js
// ═══════════════════════════════════════════════════════════════════════════

const { Pool } = require("pg");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Cliente R2 (compatível com S3)
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "germanus-art";
const PUBLIC = process.env.R2_PUBLIC_URL.replace(/\/$/, "");  // sem barra final

// Já existe no R2?
async function existeNoR2(chave) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
    return true;
  } catch { return false; }
}

// Baixa uma imagem do museu e envia para o R2
async function migrarUma(row) {
  const chave = `obras/${row.id}.jpg`;

  // Se já está no R2, só atualiza a URL no banco
  if (await existeNoR2(chave)) {
    await pool.query(`UPDATE artworks SET image_url=$1 WHERE id=$2`, [`${PUBLIC}/${chave}`, row.id]);
    return "existe";
  }

  try {
    const res = await fetch(row.image_url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) throw new Error("not image");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 3000) throw new Error("too small");

    // Envia para o R2
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET, Key: chave, Body: buf, ContentType: ct,
    }));

    // Atualiza o banco com a URL pública do R2
    await pool.query(`UPDATE artworks SET image_url=$1 WHERE id=$2`, [`${PUBLIC}/${chave}`, row.id]);
    return "ok";
  } catch (e) {
    return "falha:" + e.message;
  }
}

(async () => {
  console.log("🚀 Migração para Cloudflare R2 iniciada");

  // Buscar obras que ainda NÃO estão no R2 (URL não contém o domínio do R2)
  const r = await pool.query(
    `SELECT id, image_url FROM artworks
     WHERE image_url IS NOT NULL AND image_url != ''
       AND image_url NOT LIKE '%r2.dev%'
       AND image_url NOT LIKE '%r2.cloudflarestorage%'
     ORDER BY id`
  );
  console.log(`📋 ${r.rows.length} obras para migrar`);

  let ok = 0, existe = 0, falha = 0;
  const CONCORRENCIA = 8;

  for (let i = 0; i < r.rows.length; i += CONCORRENCIA) {
    const lote = r.rows.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.all(lote.map(migrarUma));
    for (const res of resultados) {
      if (res === "ok") ok++;
      else if (res === "existe") existe++;
      else falha++;
    }
    if ((i + CONCORRENCIA) % 80 === 0 || i + CONCORRENCIA >= r.rows.length) {
      console.log(`  progresso: ${Math.min(i + CONCORRENCIA, r.rows.length)}/${r.rows.length} · ✓${ok} já-tinha:${existe} ✗${falha}`);
    }
  }

  console.log(`\n✅ Migração concluída — ${ok} novas, ${existe} já existiam, ${falha} falhas`);
  console.log(`💾 As imagens agora estão no R2. Pode limpar o banco com:`);
  console.log(`   UPDATE artworks SET image_data=NULL, image_cached_at=0; VACUUM FULL artworks;`);
  process.exit(0);
})();
