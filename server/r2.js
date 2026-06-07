// ═══════════════════════════════════════════════════════════════════════════
// r2.js — Helper para enviar imagens ao Cloudflare R2
// Usado pelo semeador e categorias para guardar novas obras direto no R2
// ═══════════════════════════════════════════════════════════════════════════

const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

let r2 = null;
const BUCKET = process.env.R2_BUCKET || "germanus-art";
const PUBLIC = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

// Inicializa o cliente R2 só se as credenciais existirem
function getR2() {
  if (r2) return r2;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) return null;
  r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return r2;
}

const r2Ativo = () => !!(process.env.R2_ACCOUNT_ID && process.env.R2_PUBLIC_URL);

// Baixa uma imagem de uma URL e envia ao R2. Devolve a URL pública do R2, ou null se falhar.
async function enviarParaR2(id, imageUrl) {
  const client = getR2();
  if (!client || !imageUrl) return null;
  const chave = `obras/${id}.jpg`;

  try {
    // Se já existe, devolve a URL sem rebaixar
    try {
      await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: chave }));
      return `${PUBLIC}/${chave}`;
    } catch {}

    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 3000) return null;

    await client.send(new PutObjectCommand({
      Bucket: BUCKET, Key: chave, Body: buf, ContentType: ct,
    }));
    return `${PUBLIC}/${chave}`;
  } catch {
    return null;
  }
}

module.exports = { enviarParaR2, r2Ativo, R2_PUBLIC: PUBLIC };
