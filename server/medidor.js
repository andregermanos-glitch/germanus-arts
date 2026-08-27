// server/medidor.js — Medidor de resolução do acervo (qualidade para impressão)
// ─────────────────────────────────────────────────────────────────────────────
// O banco guarda a URL da imagem, mas nunca soube o TAMANHO dela. Sem isso não
// há como responder "quantas obras servem para uma ecobag de 30 cm a 300 dpi?".
// Este módulo mede e guarda: img_w, img_h.
//
// COMO MEDE (barato): lê apenas o CABEÇALHO do arquivo (~96 KB, geralmente
// bastam 8 KB) via requisição Range e interrompe o download. Medir 16 mil obras
// custa alguns MB, não gigabytes.
//
// A CONTA DOS 300 dpi: 300 pontos por polegada = 118,11 pixels por centímetro.
//   40 cm → 4724 px · 30 cm → 3543 px · 20 cm → 2362 px · 10 cm → 1181 px
// O lado que manda é o MENOR (LEAST(img_w,img_h)): é ele que limita a arte.
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./medidor").montarMedidor(app, pool);
//
// USO:  painel em /medidor  ·  POST /api/medidor/rodar  ·  GET /api/medidor/relatorio
// ─────────────────────────────────────────────────────────────────────────────

const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const MAX_CABECALHO = 96 * 1024;   // teto de bytes baixados por imagem
const PARALELO = 6;                // imagens medidas ao mesmo tempo
const PX_POR_CM = 118.11;          // 300 dpi ÷ 2,54

let est = { rodando: false, alvo: 0, feitas: 0, medidas: 0, falhas: 0, inicio: 0, ultimo_erro: null };

// ── leitura de dimensões a partir do cabeçalho ───────────────────────────────
function dimensoes(b) {
  if (!b || b.length < 24) return null;
  // PNG
  if (b.readUInt32BE(0) === 0x89504E47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  // WebP
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const c = b.toString("ascii", 12, 16);
    if (c === "VP8X") return { w: (b.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (b.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
    if (c === "VP8 ") {
      const i = b.indexOf(Buffer.from([0x9D, 0x01, 0x2A]));
      if (i > 0 && i + 7 < b.length) return { w: b.readUInt16LE(i + 3) & 0x3FFF, h: b.readUInt16LE(i + 5) & 0x3FFF };
    }
  }
  // JPEG — percorre os segmentos até achar o SOF (que carrega altura e largura)
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (i + 4 > b.length) break;
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        if (i + 9 > b.length) break;
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

async function baixarCabecalho(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Range": `bytes=0-${MAX_CABECALHO - 1}`, "Accept": "image/*" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status);
    // lê em pedaços e CANCELA assim que tiver o bastante (o servidor pode ignorar o Range)
    const partes = []; let n = 0;
    const leitor = r.body.getReader();
    while (n < MAX_CABECALHO) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(Buffer.from(value)); n += value.length;
    }
    try { await leitor.cancel(); } catch {}
    return Buffer.concat(partes);
  } finally { clearTimeout(t); }
}

async function medirUma(pool, obra) {
  const url = obra.url_medir;
  const agora = `EXTRACT(EPOCH FROM NOW())::BIGINT`;
  try {
    const buf = await baixarCabecalho(url);
    const d = dimensoes(buf);
    if (!d || !d.w || !d.h) throw new Error("formato não reconhecido");
    await pool.query(
      `UPDATE artworks SET img_w=$1, img_h=$2, medida_em=${agora}, medida_erro=NULL WHERE id=$3`,
      [d.w, d.h, obra.id]
    );
    est.medidas++;
  } catch (e) {
    const msg = (e.message || "erro").slice(0, 120);
    est.ultimo_erro = msg;
    await pool.query(
      `UPDATE artworks SET img_w=NULL, img_h=NULL, medida_em=${agora}, medida_erro=$1 WHERE id=$2`,
      [msg, obra.id]
    ).catch(() => {});
    est.falhas++;
  } finally { est.feitas++; }
}

async function rodar(pool, total, refazerErros) {
  est = { rodando: true, alvo: total, feitas: 0, medidas: 0, falhas: 0, inicio: Date.now(), ultimo_erro: null };
  const condicao = refazerErros ? `medida_erro IS NOT NULL` : `COALESCE(medida_em,0) = 0`;
  while (est.feitas < total) {
    const restam = Math.min(60, total - est.feitas);
    const r = await pool.query(
      `SELECT id, COALESCE(NULLIF(hd_url,''), image_url) AS url_medir
         FROM artworks
        WHERE image_url IS NOT NULL AND image_url <> '' AND ${condicao}
        ORDER BY indexed_at DESC
        LIMIT ${restam}`
    );
    if (r.rows.length === 0) break;
    // mede em pequenos grupos paralelos (educado com os servidores dos museus)
    for (let i = 0; i < r.rows.length; i += PARALELO) {
      await Promise.all(r.rows.slice(i, i + PARALELO).map(o => medirUma(pool, o)));
    }
    await new Promise(s => setTimeout(s, 300));
  }
  est.rodando = false;
  console.log(`📏 Medidor: ${est.medidas} medidas, ${est.falhas} falhas (de ${est.feitas})`);
}

// ── relatório ────────────────────────────────────────────────────────────────
const ESCOPOS = {
  todas:      `image_url IS NOT NULL AND image_url <> ''`,
  entrada:    `image_url IS NOT NULL AND image_url <> '' AND ala_id = 'entrada'`,
  publicadas: `image_url IS NOT NULL AND image_url <> '' AND COALESCE(status,'publicada') = 'publicada'`,
};

async function relatorio(pool, escopo) {
  const onde = ESCOPOS[escopo] || ESCOPOS.todas;
  const medida = `medida_em > 0 AND img_w > 0`;
  const g = await pool.query(`
    SELECT COUNT(*)::int                                                       AS total,
           COUNT(*) FILTER (WHERE ${medida})::int                              AS medidas,
           COUNT(*) FILTER (WHERE medida_erro IS NOT NULL)::int                AS falhas,
           COUNT(*) FILTER (WHERE COALESCE(medida_em,0) = 0)::int              AS pendentes,
           COUNT(*) FILTER (WHERE ${medida} AND LEAST(img_w,img_h) >= 4724)::int AS cm40,
           COUNT(*) FILTER (WHERE ${medida} AND LEAST(img_w,img_h) >= 3543)::int AS cm30,
           COUNT(*) FILTER (WHERE ${medida} AND LEAST(img_w,img_h) >= 2362)::int AS cm20,
           COUNT(*) FILTER (WHERE ${medida} AND LEAST(img_w,img_h) >= 1181)::int AS cm10,
           COALESCE(MAX(LEAST(img_w,img_h)) FILTER (WHERE ${medida}), 0)::int   AS maior_lado,
           COALESCE(ROUND(AVG(img_w::numeric*img_h/1000000) FILTER (WHERE ${medida}), 1), 0) AS mp_medio
      FROM artworks WHERE ${onde}`);

  const m = await pool.query(`
    SELECT COALESCE(NULLIF(museum,''),'(sem museu)') AS museu,
           COUNT(*) FILTER (WHERE ${medida})::int                                AS medidas,
           COUNT(*) FILTER (WHERE ${medida} AND LEAST(img_w,img_h) >= 3543)::int AS cm30
      FROM artworks WHERE ${onde}
     GROUP BY 1 HAVING COUNT(*) FILTER (WHERE ${medida}) > 0
     ORDER BY cm30 DESC, medidas DESC LIMIT 15`);

  return { escopo: escopo || "todas", ...g.rows[0], museus: m.rows };
}

// ── montagem ─────────────────────────────────────────────────────────────────
function montarMedidor(app, pool) {
  (async () => {
    try {
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS hd_url TEXT`);
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS img_w INT`);
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS img_h INT`);
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS medida_em BIGINT DEFAULT 0`);
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS medida_erro TEXT`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_art_medida ON artworks(medida_em)`);
    } catch (e) { console.log("📏 Medidor — migração:", e.message); }
  })();

  app.post("/api/medidor/rodar", async (req, res) => {
    if (est.rodando) return res.json({ ok: false, mensagem: "Já está medindo", est });
    const total = Math.min(parseInt(req.body?.total || "500", 10) || 500, 100000);
    const refazer = !!req.body?.refazer_erros;
    res.json({ ok: true, mensagem: `Medição iniciada (até ${total}).`, total });
    rodar(pool, total, refazer).catch(e => { est.rodando = false; console.log("📏 Medidor erro:", e.message); });
  });

  app.get("/api/medidor/status", (req, res) => res.json(est));

  app.get("/api/medidor/relatorio", async (req, res) => {
    try { res.json(await relatorio(pool, (req.query.escopo || "todas").trim())); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/medidor", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Medidor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 20px}a{color:#378ADD;text-decoration:none}
h2{font-size:13px;color:#888;text-transform:uppercase;margin:26px 0 10px;font-weight:600}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
button{padding:9px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:12px}
button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
select{padding:9px 12px;border-radius:8px;border:1px solid #2a2a2a;background:#111;color:#eee;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:8px 10px;border-bottom:1px solid #1c1c1c;text-align:left}
th{color:#888;font-weight:600;font-size:11px;text-transform:uppercase}
tr:hover{background:#141414}
.n{color:#5fd6a8;font-variant-numeric:tabular-nums;text-align:right}
.pct{color:#666;font-size:11px}
#status{margin:14px 0;padding:12px;border-radius:8px;background:#111;border:1px solid #222;font-size:12px;display:none}
.prog{height:6px;background:#1c1c1c;border-radius:3px;overflow:hidden;margin-top:8px}
.prog>div{height:100%;background:#1D9E75;width:0;transition:width .4s}
.nota{color:#666;font-size:12px;line-height:1.6;margin-top:10px}
</style></head><body>
<h1>GERMANUS.Art — Medidor de Resolução</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/curadoria">curadoria</a> · <a href="/europeana">europeana</a> ·
mede o tamanho real das imagens · <span style="color:#8a6d2f">medidor v1</span></p>

<div id="status"></div>

<div class="bar">
  <button class="go" onclick="medir(500)">📏 Medir 500</button>
  <button onclick="medir(3000)">Medir 3.000</button>
  <button onclick="medir(100000)">Medir tudo</button>
  <button onclick="medir(2000,true)">↻ Repetir as que falharam</button>
  <select id="escopo" onchange="ver()">
    <option value="todas">todo o acervo</option>
    <option value="entrada">só a Entrada</option>
    <option value="publicadas">só publicadas</option>
  </select>
  <button onclick="ver()">🔄 Atualizar relatório</button>
</div>

<div id="rel"><p class="nota">Carregando relatório…</p></div>

<script>
async function medir(total, refazer){
  const r = await (await fetch('/api/medidor/rodar',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({total:total, refazer_erros:!!refazer})})).json();
  if(!r.ok){ alert(r.mensagem||'já rodando'); return; }
  acompanhar();
}
async function acompanhar(){
  const box=document.getElementById('status'); box.style.display='block';
  const j = await (await fetch('/api/medidor/status')).json();
  const pct = j.alvo? Math.min(100, Math.round(j.feitas/j.alvo*100)) : 0;
  box.innerHTML = '<b>'+j.feitas+' processadas</b> · '+j.medidas+' medidas · '+j.falhas+' falhas'+
    (j.ultimo_erro?' · <span style="color:#e88">último erro: '+j.ultimo_erro+'</span>':'')+
    '<div class="prog"><div style="width:'+pct+'%"></div></div>'+
    (j.rodando?'':'<div style="color:#5fd6a8;margin-top:8px">✓ concluído</div>');
  if(j.rodando) setTimeout(acompanhar,1500); else ver();
}
function linha(rot, n, tot, cor){
  const p = tot? Math.round(n/tot*100) : 0;
  return '<tr><td>'+rot+'</td><td class="n" style="color:'+(cor||'#5fd6a8')+'">'+n.toLocaleString('pt-BR')+
         '</td><td class="pct">'+p+'% das medidas</td></tr>';
}
async function ver(){
  const esc = document.getElementById('escopo').value;
  const d = await (await fetch('/api/medidor/relatorio?escopo='+esc)).json();
  const m = d.medidas||0;
  let h = '<h2>Cobertura da medição</h2><table>'+
    '<tr><td>Obras com imagem no escopo</td><td class="n">'+(d.total||0).toLocaleString('pt-BR')+'</td><td></td></tr>'+
    '<tr><td>Já medidas</td><td class="n">'+m.toLocaleString('pt-BR')+'</td><td class="pct">'+
      (d.total?Math.round(m/d.total*100):0)+'% do escopo</td></tr>'+
    '<tr><td>Falharam (servidor recusou / formato)</td><td class="n" style="color:#e88">'+(d.falhas||0).toLocaleString('pt-BR')+'</td><td></td></tr>'+
    '<tr><td>Ainda não medidas</td><td class="n" style="color:#888">'+(d.pendentes||0).toLocaleString('pt-BR')+'</td><td></td></tr>'+
    '</table>';
  h += '<h2>Impressão a 300 dpi (lado menor da imagem)</h2><table>'+
    '<tr><th>Serve para imprimir até</th><th style="text-align:right">Obras</th><th></th></tr>'+
    linha('40 × 40 cm ou mais <span class="pct">(≥ 4.724 px)</span>', d.cm40||0, m, '#7fe0b8')+
    linha('30 × 30 cm <span class="pct">(≥ 3.543 px)</span>', d.cm30||0, m)+
    linha('20 × 20 cm <span class="pct">(≥ 2.362 px)</span>', d.cm20||0, m, '#c9a227')+
    linha('10 × 10 cm <span class="pct">(≥ 1.181 px)</span>', d.cm10||0, m, '#c9a227')+
    '</table>'+
    '<p class="nota">Os números são cumulativos: quem serve para 40 cm também serve para 30. '+
    'Média das medidas: <b>'+(d.mp_medio||0)+' megapixels</b> · maior lado menor encontrado: <b>'+
    (d.maior_lado||0).toLocaleString('pt-BR')+' px</b>.</p>';
  if((d.museus||[]).length){
    h += '<h2>Melhores fontes para ecobag (30 cm+)</h2><table>'+
      '<tr><th>Museu</th><th style="text-align:right">Servem 30 cm</th><th style="text-align:right">Medidas</th></tr>'+
      d.museus.map(x=>'<tr><td>'+x.museu+'</td><td class="n">'+x.cm30.toLocaleString('pt-BR')+
        '</td><td class="n" style="color:#888">'+x.medidas.toLocaleString('pt-BR')+'</td></tr>').join('')+'</table>';
  }
  document.getElementById('rel').innerHTML = h;
}
ver();
(async()=>{ const j=await (await fetch('/api/medidor/status')).json(); if(j.rodando) acompanhar(); })();
</script>
</body></html>`);
  });

  console.log("📏 Medidor montado — painel em /medidor");
}

module.exports = { montarMedidor };
