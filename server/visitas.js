// server/visitas.js — Contador de visitas por PAÍS (sem guardar IP)
// ─────────────────────────────────────────────────────────────────────────────
// Privacidade (LGPD/GDPR): NÃO armazena IP. Deriva o país na hora e guarda só
// a contagem agregada por país + total. Uma visita por navegador por dia
// (cookie anônimo de 24h, sem dado pessoal).
//
// Ordem de detecção do país:
//   1. Cabeçalho cf-ipcountry (Cloudflare/Railway já entregam, custo zero)
//   2. Fallback: API gratuita de geolocalização na hora (o IP é usado e
//      descartado na mesma requisição — nunca gravado)
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./visitas").montarVisitas(app, pool);
//   E garanta `app.use(require("cookie-parser")())` OU deixe que este módulo
//   leia o cookie manualmente (já faz isso, não exige cookie-parser).
// ─────────────────────────────────────────────────────────────────────────────

// Nomes de país por código ISO-2 (os mais comuns; outros caem em "Outros")
const PAIS_NOME = {
  BR:"Brasil", PT:"Portugal", US:"Estados Unidos", GB:"Reino Unido", FR:"França",
  ES:"Espanha", IT:"Itália", DE:"Alemanha", NL:"Países Baixos", BE:"Bélgica",
  CH:"Suíça", AT:"Áustria", IE:"Irlanda", CA:"Canadá", MX:"México",
  AR:"Argentina", CL:"Chile", CO:"Colômbia", PE:"Peru", UY:"Uruguai",
  PY:"Paraguai", BO:"Bolívia", VE:"Venezuela", EC:"Equador",
  JP:"Japão", CN:"China", KR:"Coreia do Sul", IN:"Índia", RU:"Rússia",
  AU:"Austrália", NZ:"Nova Zelândia", ZA:"África do Sul", AO:"Angola",
  MZ:"Moçambique", CV:"Cabo Verde", PL:"Polônia", SE:"Suécia", NO:"Noruega",
  DK:"Dinamarca", FI:"Finlândia", GR:"Grécia", TR:"Turquia", IL:"Israel",
  AE:"Emirados Árabes", SA:"Arábia Saudita", EG:"Egito", MA:"Marrocos",
  CZ:"Tchéquia", HU:"Hungria", RO:"Romênia", UA:"Ucrânia",
};
const FLAG = c => c && c.length === 2
  ? String.fromCodePoint(...[...c.toUpperCase()].map(x => 0x1F1E6 + x.charCodeAt(0) - 65))
  : "🌐";

function lerCookie(req, nome) {
  const raw = req.headers.cookie || "";
  for (const par of raw.split(";")) {
    const [k, v] = par.trim().split("=");
    if (k === nome) return v;
  }
  return null;
}

function ipDoPedido(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket?.remoteAddress || "";
}

// País pelo cabeçalho (custo zero); fallback API só se necessário
async function detectarPais(req) {
  const h = req.headers;
  const cab = h["cf-ipcountry"] || h["x-vercel-ip-country"] || h["x-country-code"];
  if (cab && cab.length === 2 && cab !== "XX") return cab.toUpperCase();

  // Fallback: geolocalização na hora. O IP é usado e descartado aqui mesmo.
  const ip = ipDoPedido(req);
  if (!ip || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("10.") || ip.startsWith("192.168.")) return null;
  try {
    const r = await fetch(`https://ipapi.co/${ip}/country/`, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": "GermanusArt/1.0 (germanus.art)" },
    });
    if (r.ok) {
      const c = (await r.text()).trim();
      if (c.length === 2) return c.toUpperCase();
    }
  } catch {}
  return null;
}

function montarVisitas(app, pool) {
  // Tabela agregada — uma linha por país, só contagem. Sem IP, sem timestamp pessoal.
  pool.query(`
    CREATE TABLE IF NOT EXISTS visitas_pais (
      pais TEXT PRIMARY KEY,
      total BIGINT DEFAULT 0,
      atualizado BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `).then(() => console.log("🌍 Visitas — tabela pronta"))
    .catch(e => console.log("🌍 Visitas — migração:", e.message));

  // Endpoint de registro: chamado pelo frontend a cada carregamento de página.
  // Conta no máximo 1×/dia por navegador (cookie anônimo de 24h).
  app.get("/api/visita", async (req, res) => {
    try {
      // Já contou hoje neste navegador? então não conta de novo.
      const jaContou = lerCookie(req, "germ_v");
      const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      if (jaContou === hoje) return res.json({ ok: true, contado: false });

      const pais = (await detectarPais(req)) || "??";
      await pool.query(`
        INSERT INTO visitas_pais (pais, total, atualizado)
        VALUES ($1, 1, EXTRACT(EPOCH FROM NOW())::BIGINT)
        ON CONFLICT (pais) DO UPDATE
          SET total = visitas_pais.total + 1,
              atualizado = EXTRACT(EPOCH FROM NOW())::BIGINT
      `, [pais]);

      // Cookie anônimo: marca "já contou hoje". Expira em 24h. SameSite=Lax.
      res.setHeader("Set-Cookie",
        `germ_v=${hoje}; Max-Age=86400; Path=/; SameSite=Lax`);
      res.json({ ok: true, contado: true });
    } catch (e) {
      res.json({ ok: false }); // nunca quebra a navegação por causa do contador
    }
  });

  // JSON dos números (para o painel /banco consumir)
  app.get("/api/visitas", async (req, res) => {
    try {
      const r = await pool.query(`SELECT pais, total FROM visitas_pais ORDER BY total DESC`);
      const linhas = r.rows.map(x => ({
        pais: x.pais,
        nome: x.pais === "??" ? "Desconhecido" : (PAIS_NOME[x.pais] || x.pais),
        flag: x.pais === "??" ? "🌐" : FLAG(x.pais),
        total: parseInt(x.total, 10),
      }));
      const total = linhas.reduce((s, l) => s + l.total, 0);
      res.json({ total, paises: linhas });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("🌍 Visitas montado — /api/visita (registro) e /api/visitas (dados)");
}

module.exports = { montarVisitas, PAIS_NOME, FLAG };
