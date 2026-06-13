// server/r2.js — Integração Cloudflare R2 (armazenamento de imagens)
// Estratégia: imagens deixam de morar no Postgres (BYTEA) e passam a morar
// no bucket R2. O Postgres guarda só a URL pública.
//
// Variáveis de ambiente necessárias (Railway → germanus-arts → Variables):
//   R2_ACCOUNT_ID        — ID da conta Cloudflare (32 caracteres hex)
//   R2_ACCESS_KEY_ID     — Access Key do token R2
//   R2_SECRET_ACCESS_KEY — Secret Access Key do token R2
//   R2_BUCKET            — nome do bucket (ex.: germanus-art)
//   R2_PUBLIC_URL        — URL pública do bucket (ex.: https://pub-xxxx.r2.dev)
//                          OU o domínio personalizado configurado

const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID     || "";
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID  || "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET     = process.env.R2_BUCKET         || "germanus-art";
// Remove barra final da URL pública, se houver
const PUBLIC_URL = (process.env.R2_PUBLIC_URL    || "").replace(/\/$/, "");

let s3 = null;

function r2Ativo() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_URL);
}

function getClient() {
  if (s3) return s3;
  s3 = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return s3;
}

// Deduz extensão e mime a partir da URL/content-type
function deduzirTipo(url, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png"))  return { ext: "png",  mime: "image/png" };
  if (ct.includes("webp")) return { ext: "webp", mime: "image/webp" };
  if (ct.includes("tiff")) return { ext: "jpg",  mime: "image/jpeg" }; // tiff → tratado como jpg no destino
  if (ct.includes("gif"))  return { ext: "gif",  mime: "image/gif" };
  if (ct.includes("jpeg") || ct.includes("jpg")) return { ext: "jpg", mime: "image/jpeg" };
  // fallback pela extensão da URL
  const m = (url || "").toLowerCase().match(/\.(png|webp|gif|jpe?g)(\?|$)/);
  if (m) {
    const e = m[1] === "jpeg" ? "jpg" : m[1];
    return { ext: e, mime: e === "png" ? "image/png" : e === "webp" ? "image/webp" : e === "gif" ? "image/gif" : "image/jpeg" };
  }
  return { ext: "jpg", mime: "image/jpeg" };
}

// Verifica se a chave já existe no bucket (evita re-upload)
async function jaExisteNoR2(key) {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Baixa a imagem da URL de origem e envia ao R2.
// Devolve a URL pública do R2 em caso de sucesso, ou null em caso de falha.
// Códigos de falha são propagados via throw para o chamador poder tratar 429.
async function enviarParaR2(id, urlOrigem) {
  if (!r2Ativo()) return null;
  if (!urlOrigem) return null;

  // Se já está no R2, não faz nada
  if (urlOrigem.includes(".r2.dev") || urlOrigem.includes("r2.cloudflarestorage")) {
    return urlOrigem;
  }

  // 1) Baixar da fonte
  const res = await fetch(urlOrigem, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": UA },
  });
  if (res.status === 429) { const e = new Error("HTTP_429"); e.code = 429; throw e; }
  if (!res.ok) throw new Error("HTTP_" + res.status);

  const contentType = res.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("nao_e_imagem");

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 5000) throw new Error("muito_pequena");

  const { ext, mime } = deduzirTipo(urlOrigem, contentType);
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `obras/${safeId}.${ext}`;

  // 2) Enviar ao R2 (só se ainda não existir)
  if (!(await jaExisteNoR2(key))) {
    await getClient().send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buf,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  }

  // 3) Devolver URL pública
  return `${PUBLIC_URL}/${key}`;
}

module.exports = { enviarParaR2, r2Ativo, jaExisteNoR2 };
