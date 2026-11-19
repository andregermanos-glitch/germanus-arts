// server/noticias.js — Seção Notícias (Editorial GERMANUS.Art) e páginas do rodapé
// ─────────────────────────────────────────────────────────────────────────────
// · Tabela `noticias`: rascunho → publicada | descartada. Só o que André publica
//   aparece em /noticias. Assinatura padrão: "Editorial GERMANUS.Art".
// · Tabela `paginas`: textos editáveis de Nós Somos, Direitos, Loja e Contatos.
// · Painel em /noticias-admin (editar, publicar, descartar, colar texto do Claude,
//   escrever matéria própria, editar as páginas do rodapé).
// · Proteção: se a variável NOTICIAS_SENHA existir no Railway, toda gravação
//   exige essa senha (o painel pede uma vez e guarda no navegador).
// · Pronto para a automação futura: POST /api/noticias/salvar com status
//   "rascunho" é o mesmo caminho que a rotina com a API do Claude vai usar.
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./noticias").montarNoticias(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const ASSINATURA = "Editorial GERMANUS.Art";
const EDITORIAS = ["Artes Plásticas", "Moda", "Comportamento"];
const POR_EDICAO = 7; // 1 central + 6 laterais

const PAGINAS_PADRAO = {
  "nos-somos": {
    titulo: "Nós Somos",
    texto:
`A GERMANUS.Art é uma plataforma de curadoria de arte em domínio público. Reunimos obras de museus do mundo inteiro e as organizamos em 18 alas temáticas, pensadas a partir do olhar: o retrato, a história, os objetos, as pessoas do povo, a luz, as cores, a emoção.

Cada ala dimensiona as artes plásticas por aquilo que o olhar alcança. Uma obra entra na ala em que um de seus elementos comanda a experiência de quem a vê, e não por uma classificação rígida de escola ou período.

O acervo é livre para ver, estudar e compartilhar. O Editorial GERMANUS.Art acompanha, diariamente, o que acontece nas artes plásticas, na moda e no comportamento, com leitura própria e opinião assinada.`,
  },
  "direitos": {
    titulo: "Direitos",
    texto:
`Todas as obras do acervo estão em domínio público. Seguimos a regra da legislação brasileira de direitos autorais: a obra cai em domínio público 70 anos após o 1º de janeiro do ano seguinte à morte do autor. Obras antigas de autoria desconhecida ou sem data de morte conhecida passam por verificação adicional antes de entrar no acervo.

As imagens vêm de duas origens: museus com política de acesso aberto, que as disponibilizam sob licença CC0, e o Wikimedia Commons, em que a licença é conferida arquivo por arquivo. Toda obra passa por triagem de direitos antes da publicação, e cada ficha informa a fonte.

Os textos do Editorial GERMANUS.Art são de nossa autoria, produzidos com apoio de inteligência artificial e revisados pela curadoria. As notícias citam e linkam as fontes originais.

Se você entende que alguma imagem ou texto não deveria estar aqui, escreva pela página de Contatos. Analisamos cada pedido e, se for o caso, retiramos o conteúdo.`,
  },
  "loja": {
    titulo: "Loja",
    texto:
`Em breve: ecobags e camisetas com obras do acervo em domínio público, cada peça com etiqueta de título, data e fonte da obra.`,
  },
  "contatos": {
    titulo: "Contatos",
    texto:
`[Inclua aqui o e-mail e os canais de contato da GERMANUS.Art pelo painel /noticias-admin, aba Páginas.]

TikTok: @germanus.art`,
  },
};

// Traduções das páginas padrão (EN e FR). Só são gravadas se o texto em português
// no banco ainda for o padrão — se André já editou a página, nada é sobrescrito.
const PAGINAS_TRAD = {
  "nos-somos": {
    titulo_en: "About us", titulo_fr: "Qui sommes-nous",
    texto_en:
`GERMANUS.Art is a curatorial platform for public-domain art. We bring together works from museums around the world and arrange them in 18 thematic galleries, conceived from the act of looking: the portrait, history, objects, ordinary people, light, colour, emotion.

Each gallery measures the visual arts by what the eye can reach. A work enters the gallery in which one of its elements commands the viewer's experience, not by a rigid classification of school or period.

The collection is free to view, study and share. The GERMANUS.Art Editorial follows what happens in the visual arts, fashion and culture, with its own reading and signed opinion.`,
    texto_fr:
`GERMANUS.Art est une plateforme de curation d'art du domaine public. Nous réunissons des œuvres de musées du monde entier et les organisons en 18 galeries thématiques, pensées à partir du regard : le portrait, l'histoire, les objets, les gens du peuple, la lumière, les couleurs, l'émotion.

Chaque galerie mesure les arts plastiques à ce que le regard atteint. Une œuvre entre dans la galerie où l'un de ses éléments commande l'expérience de celui qui la regarde, et non selon un classement rigide par école ou par période.

La collection est libre d'accès, d'étude et de partage. L'Éditorial GERMANUS.Art suit l'actualité des arts plastiques, de la mode et des comportements, avec une lecture propre et une opinion signée.`,
  },
  "direitos": {
    titulo_en: "Rights", titulo_fr: "Droits",
    texto_en:
`Every work in the collection is in the public domain. We follow the rule of Brazilian copyright law: a work enters the public domain 70 years after 1 January of the year following the author's death. Older works by unknown authors, or whose date of death is unknown, undergo additional verification before entering the collection.

Images come from two sources: museums with open-access policies, which release them under a CC0 licence, and Wikimedia Commons, where the licence is checked file by file. Every work goes through a rights review before publication, and each record states its source.

GERMANUS.Art Editorial texts are our own, written with the help of artificial intelligence and reviewed by our curators. News items cite and link to their original sources.

If you believe an image or text should not be here, please write to us through the Contact page. We review every request and, where appropriate, remove the content.`,
    texto_fr:
`Toutes les œuvres de la collection appartiennent au domaine public. Nous suivons la règle du droit d'auteur brésilien : une œuvre entre dans le domaine public 70 ans après le 1er janvier de l'année suivant la mort de son auteur. Les œuvres anciennes d'auteur inconnu, ou dont la date de décès est inconnue, font l'objet d'une vérification supplémentaire avant d'entrer dans la collection.

Les images proviennent de deux sources : des musées ayant une politique d'accès ouvert, qui les diffusent sous licence CC0, et Wikimedia Commons, où la licence est vérifiée fichier par fichier. Chaque œuvre passe par un contrôle des droits avant publication, et chaque fiche indique sa source.

Les textes de l'Éditorial GERMANUS.Art sont de notre plume, rédigés avec l'aide de l'intelligence artificielle et relus par la curation. Les articles citent et renvoient à leurs sources originales.

Si vous estimez qu'une image ou un texte ne devrait pas figurer ici, écrivez-nous via la page Contact. Nous examinons chaque demande et retirons le contenu le cas échéant.`,
  },
  "loja": {
    titulo_en: "Shop", titulo_fr: "Boutique",
    texto_en: `Coming soon: tote bags and T-shirts featuring public-domain works from the collection, each piece labelled with the work's title, date and source.`,
    texto_fr: `Bientôt : tote bags et t-shirts ornés d'œuvres du domaine public de la collection, chaque pièce accompagnée d'une étiquette indiquant le titre, la date et la source de l'œuvre.`,
  },
  "contatos": {
    titulo_en: "Contact", titulo_fr: "Contact",
    texto_en: `TikTok: @germanus.art`,
    texto_fr: `TikTok : @germanus.art`,
  },
};

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function montarNoticias(app, pool) {

  // ── Migração idempotente + páginas padrão ─────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS noticias (
          id            SERIAL PRIMARY KEY,
          editoria      TEXT NOT NULL DEFAULT 'Artes Plásticas',
          titulo        TEXT NOT NULL,
          linha_fina    TEXT,
          texto         TEXT NOT NULL DEFAULT '',
          fontes        TEXT,
          autor         TEXT NOT NULL DEFAULT '${ASSINATURA}',
          status        TEXT NOT NULL DEFAULT 'rascunho',
          destaque      BOOLEAN NOT NULL DEFAULT FALSE,
          origem        TEXT NOT NULL DEFAULT 'manual',
          criada_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          publicada_em  TIMESTAMPTZ
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_noticias_pub ON noticias (status, publicada_em DESC)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paginas (
          slug          TEXT PRIMARY KEY,
          titulo        TEXT NOT NULL,
          texto         TEXT NOT NULL DEFAULT '',
          atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      for (const [slug, p] of Object.entries(PAGINAS_PADRAO)) {
        await pool.query(
          `INSERT INTO paginas (slug, titulo, texto) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
          [slug, p.titulo, p.texto]);
      }
      // Idiomas: EN e FR ao lado do português
      for (const col of ["titulo_en", "titulo_fr", "texto_en", "texto_fr"])
        await pool.query(`ALTER TABLE paginas ADD COLUMN IF NOT EXISTS ${col} TEXT NOT NULL DEFAULT ''`);
      for (const [slug, tr] of Object.entries(PAGINAS_TRAD)) {
        await pool.query(`
          UPDATE paginas SET titulo_en=$2, titulo_fr=$3, texto_en=$4, texto_fr=$5
           WHERE slug=$1 AND texto_en='' AND texto_fr='' AND texto=$6`,
          [slug, tr.titulo_en, tr.titulo_fr, tr.texto_en, tr.texto_fr, PAGINAS_PADRAO[slug].texto]);
        // contatos: o texto padrão tem uma instrução interna; o público vê só o TikTok
        if (slug === "contatos") await pool.query(`
          UPDATE paginas SET titulo_en=$2, titulo_fr=$3
           WHERE slug=$1 AND titulo_en='' AND titulo_fr=''`, [slug, tr.titulo_en, tr.titulo_fr]);
      }
      console.log("📰 Notícias — tabelas prontas");
    } catch (e) { console.log("📰 Notícias — migração:", e.message); }
  })();

  // ── Senha opcional para gravações ─────────────────────────────────────────
  function autorizado(req, res) {
    const senha = process.env.NOTICIAS_SENHA;
    if (!senha) return true;
    if (req.get("x-senha") === senha) return true;
    res.status(401).json({ error: "senha inválida" });
    return false;
  }

  // ── API pública ────────────────────────────────────────────────────────────

  // Edição atual: as últimas matérias publicadas; a de destaque mais recente
  // vai para o centro. ?n=<id> abre uma matéria específica no centro.
  app.get("/api/noticias", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, editoria, titulo, linha_fina, texto, fontes, autor, destaque, publicada_em
          FROM noticias WHERE status = 'publicada'
         ORDER BY publicada_em DESC NULLS LAST, id DESC
         LIMIT $1`, [POR_EDICAO]);
      let lista = rows;
      const pedida = parseInt(req.query.n, 10);
      if (pedida && !lista.some(n => n.id === pedida)) {
        const x = await pool.query(`
          SELECT id, editoria, titulo, linha_fina, texto, fontes, autor, destaque, publicada_em
            FROM noticias WHERE status='publicada' AND id=$1`, [pedida]);
        if (x.rows[0]) lista = [x.rows[0], ...lista.slice(0, POR_EDICAO - 1)];
      }
      const iCentro = pedida ? lista.findIndex(n => n.id === pedida)
                             : lista.findIndex(n => n.destaque);
      if (iCentro > 0) lista = [lista[iCentro], ...lista.filter((_, i) => i !== iCentro)];
      const ed = await pool.query(`
        SELECT COUNT(DISTINCT (publicada_em AT TIME ZONE 'America/Sao_Paulo')::date)::int AS n
          FROM noticias WHERE status='publicada'`);
      res.json({ noticias: lista, edicao: ed.rows[0].n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/pagina/:slug", async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM paginas WHERE slug=$1`, [req.params.slug]);
      const p = rows[0];
      if (!p) return res.status(404).json({ error: "página não encontrada" });
      const lang = ["en", "fr"].includes(req.query.lang) ? req.query.lang : "pt";
      // Sem tradução gravada, cai para o português
      const titulo = lang === "pt" ? p.titulo : (p[`titulo_${lang}`] || "");
      const texto  = lang === "pt" ? p.texto  : (p[`texto_${lang}`]  || p.texto);
      res.json({ slug: p.slug, titulo: titulo || p.titulo, titulo_traduzido: lang === "pt" || !!titulo, texto, lang });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── API do painel ──────────────────────────────────────────────────────────

  app.get("/api/noticias/painel", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      const status = ["rascunho", "publicada", "descartada"].includes(req.query.status)
        ? req.query.status : "rascunho";
      const { rows } = await pool.query(`
        SELECT * FROM noticias WHERE status=$1
         ORDER BY COALESCE(publicada_em, criada_em) DESC, id DESC LIMIT 200`, [status]);
      const c = await pool.query(`SELECT status, COUNT(*)::int AS n FROM noticias GROUP BY status`);
      const contagem = {}; c.rows.forEach(r => contagem[r.status] = r.n);
      res.json({ noticias: rows, contagem });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Cria ou atualiza. Sem id → nova. status opcional: rascunho | publicada | descartada
  app.post("/api/noticias/salvar", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      const b = req.body || {};
      const titulo = String(b.titulo || "").trim();
      if (!titulo) return res.status(400).json({ error: "título obrigatório" });
      const status = ["rascunho", "publicada", "descartada"].includes(b.status) ? b.status : "rascunho";
      const campos = [
        String(b.editoria || EDITORIAS[0]).trim(), titulo,
        String(b.linha_fina || "").trim() || null, String(b.texto || "").trim(),
        String(b.fontes || "").trim() || null,
        String(b.autor || "").trim() || ASSINATURA,
        status, !!b.destaque,
      ];
      let id = parseInt(b.id, 10) || null;
      if (id) {
        await pool.query(`
          UPDATE noticias SET editoria=$1, titulo=$2, linha_fina=$3, texto=$4, fontes=$5, autor=$6,
                 status=$7, destaque=$8, atualizada_em=NOW(),
                 publicada_em = CASE WHEN $7='publicada' THEN COALESCE(publicada_em, NOW()) ELSE publicada_em END
           WHERE id=$9`, [...campos, id]);
      } else {
        const r = await pool.query(`
          INSERT INTO noticias (editoria, titulo, linha_fina, texto, fontes, autor, status, destaque, origem, publicada_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $7='publicada' THEN NOW() END)
          RETURNING id`, [...campos, String(b.origem || "manual")]);
        id = r.rows[0].id;
      }
      // Só uma matéria em destaque por vez
      if (b.destaque) await pool.query(`UPDATE noticias SET destaque=FALSE WHERE id<>$1 AND destaque`, [id]);
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/noticias/excluir", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      await pool.query(`DELETE FROM noticias WHERE id=$1`, [parseInt(req.body?.id, 10)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/paginas/painel", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      const { rows } = await pool.query(`SELECT slug, titulo, texto, titulo_en, texto_en, titulo_fr, texto_fr FROM paginas ORDER BY slug`);
      res.json({ paginas: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/paginas/salvar", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      const { slug, titulo, texto, titulo_en, texto_en, titulo_fr, texto_fr } = req.body || {};
      if (!PAGINAS_PADRAO[slug]) return res.status(400).json({ error: "página desconhecida" });
      await pool.query(`
        INSERT INTO paginas (slug, titulo, texto, titulo_en, texto_en, titulo_fr, texto_fr, atualizada_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, texto=EXCLUDED.texto,
          titulo_en=EXCLUDED.titulo_en, texto_en=EXCLUDED.texto_en,
          titulo_fr=EXCLUDED.titulo_fr, texto_fr=EXCLUDED.texto_fr, atualizada_em=NOW()`,
        [slug, String(titulo || PAGINAS_PADRAO[slug].titulo), String(texto || ""),
         String(titulo_en || ""), String(texto_en || ""), String(titulo_fr || ""), String(texto_fr || "")]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Painel /noticias-admin ─────────────────────────────────────────────────
  app.get("/noticias-admin", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(PAINEL_HTML(!!process.env.NOTICIAS_SENHA));
  });

  console.log("📰 Notícias montadas — /noticias (público) · /noticias-admin (painel)");
}

// ─────────────────────────────────────────────────────────────────────────────
function PAINEL_HTML(temSenha) {
  const opts = EDITORIAS.map(e => `<option>${esc(e)}</option>`).join("");
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Editorial</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f3efe7;color:#0a0a0a;font-family:Verdana,sans-serif;padding:24px 16px;max-width:1000px;margin:0 auto}
a{color:#1545c7;text-decoration:none}
.logo{display:flex;align-items:baseline;line-height:1;user-select:none}
.logo .g{font-size:22px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.logo .p{font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:700;color:#1545c7;margin:0 1px}
.logo .a{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:#d41515}
.sub{font-size:9px;color:#999;letter-spacing:2px;text-transform:uppercase;margin:6px 0 18px}
.tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid #e0dbd0;margin-bottom:18px}
.tabs button{background:none;border:none;border-bottom:2px solid transparent;color:#999;padding:9px 16px 9px 0;margin-right:6px;cursor:pointer;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;font-family:inherit}
.tabs button.on{color:#0a0a0a;border-bottom-color:#0a0a0a}
.box{background:#fff;border:1px solid #e8e4dc;border-radius:3px;padding:16px;margin-bottom:16px}
.box h3{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#666;margin-bottom:10px;font-weight:400}
label{display:block;font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:12px 0 4px}
input,textarea,select{width:100%;background:#faf9f7;border:1px solid #e0dbd0;border-radius:2px;color:#0a0a0a;padding:9px 10px;font-size:14px;font-family:'Cormorant Garamond',Georgia,serif}
textarea{min-height:110px;resize:vertical;line-height:1.5}
#f_texto{min-height:320px;font-size:16px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:640px){.row{grid-template-columns:1fr}}
button.b{padding:8px 14px;border-radius:2px;border:1px solid #0a0a0a;background:#fff;color:#0a0a0a;cursor:pointer;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-family:Verdana,sans-serif;margin:4px 4px 0 0}
button.b.go{background:#0a0a0a;color:#fff}
button.b.red{border-color:#b03a2e;color:#b03a2e}
.item{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #e8e4dc;border-left:3px solid #e0dbd0;border-radius:3px;padding:12px;margin-bottom:8px;cursor:pointer}
.item:hover{border-left-color:#0a0a0a}
.item.dest{border-left-color:#b03a2e}
.item .ed{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#b03a2e}
.item .t{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:700;line-height:1.15;margin:3px 0}
.item .m{font-size:10px;color:#999}
.vazio{font-size:11px;color:#aaa;padding:24px 0}
.aviso{font-size:11px;color:#8a5a00;background:#fff6e0;border:1px solid #f0dca8;padding:8px 10px;border-radius:2px;margin-bottom:14px}
#msg{font-size:11px;color:#666;margin-left:6px}
.check{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:11px;color:#444}
.check input{width:auto}
</style></head><body>
<div class="logo"><span class="g">Germanus</span><span class="p">.</span><span class="a">Art</span></div>
<p class="sub">Editorial · curadoria das notícias · <a href="/noticias" target="_blank">ver página pública ↗</a></p>
${temSenha ? "" : `<div class="aviso">Painel sem senha. Crie a variável <b>NOTICIAS_SENHA</b> no Railway para que só você possa publicar.</div>`}

<div class="tabs" id="tabs">
  <button data-t="rascunho" class="on">Rascunhos <span id="c_rascunho"></span></button>
  <button data-t="publicada">Publicadas <span id="c_publicada"></span></button>
  <button data-t="descartada">Descartadas <span id="c_descartada"></span></button>
  <button data-t="nova">+ Nova matéria</button>
  <button data-t="paginas">Páginas</button>
</div>

<div id="lista"></div>

<div id="editor" style="display:none">
  <div class="box">
    <h3>Colar texto gerado pelo Claude</h3>
    <textarea id="colar" placeholder="Cole aqui a resposta inteira do Claude (Editoria, Título, Linha fina, Texto, Fontes) e toque em preencher."></textarea>
    <button class="b" onclick="preencher()">preencher campos</button>
  </div>
  <div class="box">
    <h3 id="ed_titulo">Nova matéria</h3>
    <div class="row">
      <div><label>editoria</label><select id="f_editoria">${opts}</select></div>
      <div><label>assinatura</label><input id="f_autor" value="${ASSINATURA}"></div>
    </div>
    <label>título</label><input id="f_titulo">
    <label>linha fina</label><input id="f_linha">
    <label>texto (parágrafos separados por linha em branco)</label><textarea id="f_texto"></textarea>
    <label>fontes (uma por linha: Veículo — link)</label><textarea id="f_fontes"></textarea>
    <div class="check"><input type="checkbox" id="f_dest"><span>matéria central (destaque da edição)</span></div>
    <div style="margin-top:14px">
      <button class="b go" onclick="salvar('publicada')">publicar</button>
      <button class="b" onclick="salvar('rascunho')">salvar rascunho</button>
      <button class="b red" onclick="salvar('descartada')">descartar</button>
      <button class="b red" id="bt_excluir" onclick="excluir()">excluir</button>
      <button class="b" onclick="voltar()">voltar</button>
      <span id="msg"></span>
    </div>
  </div>
</div>

<div id="paginas" style="display:none"></div>

<script>
var g = function(i){ return document.getElementById(i); };
var ATUAL = null, ABA = 'rascunho', CACHE = [];
function senha(){ try { return localStorage.getItem('germ_ed_senha') || ''; } catch(e){ return ''; } }
function h(){ return {'Content-Type':'application/json','x-senha':senha()}; }
async function api(url, body){
  var r = await fetch(url, body ? {method:'POST',headers:h(),body:JSON.stringify(body)} : {headers:h()});
  if (r.status === 401){
    var s = prompt('Senha do editorial:');
    if (s === null) throw new Error('sem senha');
    try { localStorage.setItem('germ_ed_senha', s); } catch(e){}
    return api(url, body);
  }
  return r.json();
}
function e(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function data(d){ return d ? new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : ''; }

function mostrar(q){ ['lista','editor','paginas'].forEach(function(id){ g(id).style.display = id===q ? '' : 'none'; }); }
function marcarAba(t){ Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function(b){ b.classList.toggle('on', b.dataset.t===t); }); }

document.querySelectorAll('#tabs button').forEach(function(b){
  b.onclick = function(){
    var t = b.dataset.t; marcarAba(t);
    if (t === 'nova') return abrir(null);
    if (t === 'paginas') return carregarPaginas();
    ABA = t; carregar();
  };
});

async function carregar(){
  mostrar('lista'); g('lista').innerHTML = '<p class="vazio">carregando…</p>';
  var d = await api('/api/noticias/painel?status=' + ABA);
  ['rascunho','publicada','descartada'].forEach(function(s){ g('c_'+s).textContent = d.contagem && d.contagem[s] ? '('+d.contagem[s]+')' : ''; });
  CACHE = d.noticias || [];
  g('lista').innerHTML = CACHE.map(function(n){
    return '<div class="item'+(n.destaque?' dest':'')+'" onclick="abrir('+n.id+')"><div style="flex:1">'+
      '<div class="ed">'+e(n.editoria)+(n.destaque?' · central':'')+'</div>'+
      '<div class="t">'+e(n.titulo)+'</div>'+
      '<div class="m">'+e(n.autor)+' · '+data(n.publicada_em||n.criada_em)+(n.origem&&n.origem!=='manual'?' · '+e(n.origem):'')+'</div>'+
      '</div></div>';
  }).join('') || '<p class="vazio">Nada aqui.</p>';
}

function abrir(id){
  ATUAL = id ? CACHE.find(function(n){ return n.id===id; }) : null;
  var n = ATUAL || {};
  g('ed_titulo').textContent = ATUAL ? ('Editar · ' + ATUAL.status) : 'Nova matéria';
  g('f_editoria').value = n.editoria || 'Artes Plásticas';
  g('f_autor').value = n.autor || '${ASSINATURA}';
  g('f_titulo').value = n.titulo || '';
  g('f_linha').value = n.linha_fina || '';
  g('f_texto').value = n.texto || '';
  g('f_fontes').value = n.fontes || '';
  g('f_dest').checked = !!n.destaque;
  g('colar').value = ''; g('msg').textContent = '';
  g('bt_excluir').style.display = ATUAL ? '' : 'none';
  mostrar('editor'); window.scrollTo(0,0);
}
function voltar(){ marcarAba(ABA); carregar(); }

async function salvar(status){
  var b = { id: ATUAL ? ATUAL.id : null, status: status,
    editoria: g('f_editoria').value, autor: g('f_autor').value,
    titulo: g('f_titulo').value, linha_fina: g('f_linha').value,
    texto: g('f_texto').value, fontes: g('f_fontes').value, destaque: g('f_dest').checked };
  if (!b.titulo.trim()) return alert('Falta o título.');
  if (status === 'publicada' && !b.texto.trim()) return alert('Falta o texto.');
  g('msg').textContent = 'salvando…';
  var d = await api('/api/noticias/salvar', b);
  if (d.ok){ ABA = status; marcarAba(ABA); carregar(); }
  else g('msg').textContent = 'erro: ' + (d.error||'');
}
async function excluir(){
  if (!ATUAL || !confirm('Excluir de vez esta matéria?')) return;
  await api('/api/noticias/excluir', {id: ATUAL.id}); carregar();
}

// Lê a resposta do Claude: rótulos Editoria / Título / Linha fina / Texto / Fontes
function preencher(){
  var txt = g('colar').value; if (!txt.trim()) return;
  var rot = { 'editoria':'editoria', 'titulo':'titulo', 'linha fina':'linha', 'texto':'texto', 'fontes':'fontes', 'fonte':'fontes', 'assinatura':'assinatura' };
  var partes = {}, atual = null;
  txt.split(/\\r?\\n/).forEach(function(linha){
    var limpa = linha.replace(/^[\\s#>*_-]+/, '').replace(/\\*\\*/g, '');
    var semAc = limpa.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
    var m = semAc.match(/^(editoria|titulo|linha fina|texto|fontes|fonte|assinatura)\\s*(?::\\s*(.*)|:?\\s*)$/i);
    if (m){
      atual = rot[m[1].toLowerCase()];
      var resto = (m[2] !== undefined && limpa.indexOf(':') >= 0) ? limpa.slice(limpa.indexOf(':') + 1).trim() : '';
      partes[atual] = resto ? [resto] : [];
    } else if (atual){ partes[atual].push(linha.replace(/\\*\\*/g,'')); }
  });
  function j(k){ return (partes[k]||[]).join('\\n').replace(/^\\s+|\\s+$/g,''); }
  var ed = j('editoria');
  if (ed){ var ok = Array.prototype.find.call(g('f_editoria').options, function(o){ return o.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'') === ed.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''); }); if (ok) g('f_editoria').value = ok.value; }
  if (j('titulo')) g('f_titulo').value = j('titulo').split('\\n')[0];
  if (j('linha')) g('f_linha').value = j('linha').replace(/\\n+/g,' ');
  if (j('texto')) g('f_texto').value = j('texto').replace(/\\n*Editorial GERMANUS\\.Art\\s*$/i,'').trim();
  if (j('fontes')) g('f_fontes').value = j('fontes').split('\\n').map(function(l){ return l.replace(/^\\s*[-*•]\\s*/,''); }).filter(function(l){ return l.trim(); }).join('\\n');
  if (!j('titulo') && !j('texto')) alert('Não reconheci os rótulos. Confira se a resposta tem "Título:" e "Texto:".');
}

async function carregarPaginas(){
  mostrar('paginas'); g('paginas').innerHTML = '<p class="vazio">carregando…</p>';
  var d = await api('/api/paginas/painel');
  var ordem = ['nos-somos','direitos','loja','contatos'];
  var ps = (d.paginas||[]).sort(function(a,b){ return ordem.indexOf(a.slug)-ordem.indexOf(b.slug); });
  g('paginas').innerHTML = ps.map(function(p){
    var campo = function(rot, suf, tit, txt){
      return '<div style="margin:10px 0 14px;padding-top:8px;border-top:1px dashed #ddd"><b style="font-size:11px">'+rot+'</b>'+
        '<label>título</label><input id="pt'+suf+'_'+p.slug+'" value="'+e(tit||'')+'">'+
        '<label>texto (parágrafos separados por linha em branco)</label><textarea id="px'+suf+'_'+p.slug+'" style="min-height:180px">'+e(txt||'')+'</textarea></div>';
    };
    return '<div class="box"><h3>/'+e(p.slug)+'</h3>'+
      campo('ENGLISH (idioma principal)', 'en', p.titulo_en, p.texto_en)+
      campo('FRANÇAIS', 'fr', p.titulo_fr, p.texto_fr)+
      campo('PORTUGUÊS', '', p.titulo, p.texto)+
      '<button class="b go" onclick="salvarPagina(\\''+p.slug+'\\')">salvar</button> '+
      '<a href="/'+p.slug+'" target="_blank" style="font-size:10px;margin-left:8px">ver ↗</a>'+
      '<span id="pm_'+p.slug+'" style="font-size:11px;color:#666;margin-left:8px"></span></div>';
  }).join('');
}
async function salvarPagina(slug){
  g('pm_'+slug).textContent = 'salvando…';
  var d = await api('/api/paginas/salvar', {slug:slug,
    titulo:g('pt_'+slug).value, texto:g('px_'+slug).value,
    titulo_en:g('pten_'+slug).value, texto_en:g('pxen_'+slug).value,
    titulo_fr:g('ptfr_'+slug).value, texto_fr:g('pxfr_'+slug).value});
  g('pm_'+slug).textContent = d.ok ? 'salvo ✓' : ('erro: '+(d.error||''));
}

carregar();
</script>
</body></html>`;
}

module.exports = { montarNoticias };
