// server/fichas_painel.js — Página /fichas (revisão das fichas propostas)
// Mesmo visual da /curadoria. Gerada no servidor; as ações chamam /api/fichas/*.

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function thumb(url) {
  if (!url) return "";
  if (url.includes("artic.edu/iiif")) return url.replace(/\/full\/[^/]+\//, "/full/400,/");
  if (url.includes("upload.wikimedia.org") && url.includes("/thumb/")) return url.replace(/\/\d+px-/, "/400px-");
  if (/Special:FilePath/i.test(url)) return url.replace(/width=\d+/, "width=400");
  return url;
}
const n = x => Number(x || 0).toLocaleString("pt-BR");

const ABAS = [
  ["alta", "✓ Alta confiança"], ["media", "◐ Revisar com calma"], ["sem_fonte", "∅ Sem fonte"],
  ["erro", "⚠ Erros"], ["aceita", "✔ Aceitas"], ["rejeitada", "✗ Rejeitadas"], ["ok", "· Já corretas"],
];
const CAMPOS = [["title", "Título"], ["artist", "Artista"], ["date", "Data"],
                ["medium", "Técnica"], ["dimensions", "Dimensões"], ["museum", "Museu"]];

function linhaCampo(rotulo, antes, depois, temProposta) {
  if (!temProposta) {
    return `<tr><th>${rotulo}</th><td colspan="2">${esc(antes) || "<i class='vz'>vazio</i>"}</td></tr>`;
  }
  const igual = norm(antes) === norm(depois) || depois === undefined || depois === null || depois === "";
  if (igual) return `<tr class="igual"><th>${rotulo}</th><td colspan="2">${esc(antes) || "<i class='vz'>vazio</i>"}</td></tr>`;
  return `<tr class="muda"><th>${rotulo}</th>
    <td class="antes">${esc(antes) || "<i class='vz'>vazio</i>"}</td>
    <td class="depois">${esc(depois)}</td></tr>`;
}

function card(o, aba, rotulos) {
  const p = o.ficha_proposta || {};
  const temProposta = aba === "alta" || aba === "media";
  const aceita = aba === "aceita";
  const ant = o.ficha_anterior || {};
  // na aba Aceitas mostramos: antes = ficha anterior, depois = ficha atual
  const linhas = CAMPOS.map(([k, r]) => {
    if (aceita) return linhaCampo(r, ant[k] ?? "", o[k], ant[k] !== undefined);
    if (k === "title" || k === "artist" || k === "date") return linhaCampo(r, o[k], p[k], temProposta);
    if (temProposta && p[k]) return linhaCampo(r, o[k], p[k], true);
    return o[k] ? linhaCampo(r, o[k], null, false) : "";
  }).join("");

  const def = (p.defeitos || []).map(d => `<span class="tag">${esc(rotulos[d] || d)}</span>`).join("");
  const mot = (p.motivos || []).map(m => `<li>${esc(m)}</li>`).join("");
  const links = [
    p.url ? `<a target="_blank" rel="noreferrer" href="${esc(p.url)}">fonte: ${esc(p.fonte || "")} ↗</a>` : (p.fonte ? `fonte: ${esc(p.fonte)}` : ""),
    p.wikidata ? `<a target="_blank" rel="noreferrer" href="https://www.wikidata.org/wiki/${esc(p.wikidata)}">${esc(p.wikidata)} ↗</a>` : "",
    o.external_url ? `<a target="_blank" rel="noreferrer" href="${esc(o.external_url)}">ficha original ↗</a>` : "",
  ].filter(Boolean).join(" · ");
  const titulos = p.titulos ? Object.entries(p.titulos).map(([L, t]) => `<b>${esc(L)}</b> ${esc(t)}`).join(" · ") : "";

  // valores para o editor: proposta (se houver) ou atual
  const ed = k => esc(temProposta && p[k] ? p[k] : o[k]);
  const acoes = temProposta
    ? `<label class="sel"><input type="checkbox" class="chk" value="${esc(o.id)}"> selecionar</label>
       <button class="ok" onclick="aceitar(['${esc(o.id)}'],this)">✓ aceitar</button>
       <button onclick="abrirEditor('${esc(o.id)}')">✎ editar</button>
       <button class="no" onclick="rejeitar(['${esc(o.id)}'],this)">✗ rejeitar</button>`
    : aceita
      ? `<button onclick="desfazer('${esc(o.id)}',this)">↶ desfazer</button>
         <button onclick="abrirEditor('${esc(o.id)}')">✎ editar</button>`
      : `<button onclick="abrirEditor('${esc(o.id)}')">✎ corrigir à mão</button>
         <button onclick="testar('${esc(o.id)}',this)">🔎 testar fonte</button>`;

  return `<div class="card" id="c_${esc(o.id)}">
    <div class="img"><a href="${esc(o.hd_url || o.image_url)}" target="_blank" rel="noreferrer">
      <img src="${esc(thumb(o.image_url))}" loading="lazy" alt="" onerror="this.parentElement.parentElement.classList.add('err')"></a></div>
    <div class="corpo">
      <div class="topo"><code onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(o.id)}')" title="copiar ID">${esc(o.id)}</code>
        ${p.confianca ? `<span class="conf ${esc(p.confianca)}">${p.confianca === "alta" ? "alta confiança" : "revisar"}</span>` : ""}
        ${o.status === "rascunho" ? `<span class="tag">entrada</span>` : o.ala_id ? `<span class="tag">${esc(o.ala_id)}</span>` : ""}
      </div>
      <table>${temProposta || aceita ? `<tr class="cab"><th></th><td>atual${aceita ? " (antes)" : ""}</td><td>${aceita ? "agora" : "proposta"}</td></tr>` : ""}${linhas}</table>
      ${def ? `<div class="defs">${def}</div>` : ""}
      ${mot ? `<ul class="mot">${mot}</ul>` : ""}
      ${titulos ? `<div class="tit6" title="títulos do Wikidata, guardados para o site em 6 idiomas">${titulos}</div>` : ""}
      ${links ? `<div class="links">${links}</div>` : ""}
      <div class="editor" id="e_${esc(o.id)}" hidden>
        <input data-k="title" value="${ed("title")}" placeholder="Título">
        <input data-k="artist" value="${ed("artist")}" placeholder="Artista">
        <input data-k="date" value="${ed("date")}" placeholder="Data">
        <button class="ok" onclick="salvarEdicao('${esc(o.id)}',this)">salvar minha versão</button>
      </div>
      <pre class="teste" id="t_${esc(o.id)}" hidden></pre>
      <div class="acoes">${acoes}</div>
    </div>
  </div>`;
}

function paginaFichas({ aba, offset, LIMIT, total, obras, diag, estado, rotulos, temSenha, temEuropeana }) {
  const pag = Math.floor(offset / LIMIT) + 1, pags = Math.max(1, Math.ceil(total / LIMIT));
  const contagem = {
    alta: diag.pendentes.alta, media: diag.pendentes.media,
    sem_fonte: diag.estados.sem_fonte, erro: diag.estados.erro, aceita: diag.estados.aceita,
    rejeitada: diag.estados.rejeitada, ok: diag.estados.ok,
  };
  const abas = ABAS.map(([k, r]) => `<a class="aba ${k === aba ? "on" : ""}" href="/fichas?aba=${k}">${r}${contagem[k] ? ` <b>${n(contagem[k])}</b>` : ""}</a>`).join("");
  const defs = Object.entries(diag.por_defeito).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="tag">${esc(rotulos[k] || k)} <b>${n(v)}</b></span>`).join(" ");
  const fontes = Object.entries(diag.por_fonte).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<span class="tag">${esc(k)} <b>${n(v)}</b></span>`).join(" ");
  const naoVistas = diag.estados.nao_vista || 0;

  return `<!DOCTYPE html><html lang="pt"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GERMANUS.Art — Fichas</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{font-size:20px;color:#fff;margin-bottom:4px}
.sub{color:#555;font-size:12px;margin-bottom:18px} .sub a{color:#555;text-decoration:none} .sub a:hover{color:#aaa}
.painel{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:16px}
.box{background:#101010;border:1px solid #222;border-radius:10px;padding:14px}
.box h3{font-size:12px;color:#ccc;margin-bottom:8px;font-weight:600}
.box p{font-size:11px;color:#777;line-height:1.5;margin-bottom:8px}
.num{font-size:26px;color:#fff;font-weight:300} .num small{font-size:12px;color:#666}
.tag{display:inline-block;font-size:10px;padding:2px 7px;border-radius:10px;background:#1a1a1a;border:1px solid #2a2a2a;color:#999;margin:2px 2px 2px 0}
.tag b{color:#ddd;font-weight:600}
.ctrl{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ctrl select,.ctrl input{background:#0a0a0a;border:1px solid #2a2a2a;color:#ddd;border-radius:6px;padding:6px 8px;font-size:12px}
button{font-size:11px;padding:6px 11px;border-radius:7px;border:1px solid #2a2a2a;background:#161616;color:#bbb;cursor:pointer}
button:hover{background:#1f1f1f;color:#fff}
button.ok{border-color:#1D9E7566;background:#1D9E7520;color:#4fd1a5} button.no{border-color:#E24B4A55;background:#E24B4A18;color:#ef7a79}
button.go{border-color:#534AB766;background:#534AB722;color:#a9a1ff}
#st{font-size:11px;color:#aaa;margin-top:8px;min-height:15px;white-space:pre-wrap}
.abas{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
.aba{font-size:12px;padding:6px 12px;border-radius:8px;text-decoration:none;border:1px solid #2a2a2a;background:#141414;color:#aaa}
.aba.on{border-color:#1D9E75;background:#1D9E7522;color:#1D9E75} .aba b{color:#ddd;font-weight:600}
.lote{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;font-size:12px;color:#888}
.nav{display:flex;align-items:center;gap:12px;margin:14px 0;font-size:13px;color:#888}
.nav a{color:#378ADD;text-decoration:none;padding:6px 14px;border:1px solid #2a2a2a;border-radius:8px}
.nav .off{color:#444;border-color:#1a1a1a;pointer-events:none}
.lista{display:flex;flex-direction:column;gap:12px}
.card{display:grid;grid-template-columns:170px 1fr;background:#121212;border:1px solid #222;border-radius:10px;overflow:hidden}
.card.feito{opacity:.35;pointer-events:none}
.img{background:#1a1a1a;display:flex;align-items:flex-start;justify-content:center;min-height:150px}
.img img{width:100%;height:auto;max-height:260px;object-fit:contain;display:block}
.card.err .img::after{content:"imagem indisponível";color:#555;font-size:11px;padding:20px}
.card.err .img img{display:none}
.corpo{padding:11px 13px;display:flex;flex-direction:column;gap:7px;min-width:0}
.topo{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.topo code{font-size:10px;color:#666;background:#0d0d0d;padding:3px 6px;border-radius:5px;cursor:pointer;word-break:break-all}
.conf{font-size:10px;padding:2px 8px;border-radius:10px} .conf.alta{background:#1D9E7522;color:#4fd1a5;border:1px solid #1D9E7555}
.conf.media{background:#BA751722;color:#e0a23a;border:1px solid #BA751755}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{width:78px;text-align:left;color:#666;font-weight:500;font-size:11px;padding:4px 8px 4px 0;vertical-align:top}
td{padding:4px 8px;vertical-align:top;color:#ccc;word-break:break-word}
tr.cab td{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;padding-bottom:0}
tr.muda td.antes{color:#a56;text-decoration:line-through;text-decoration-color:#a5566688}
tr.muda td.depois{color:#4fd1a5;background:#1D9E750d;border-radius:4px}
tr.igual td{color:#999}
.vz{color:#444}
.defs{margin-top:-2px}
.mot{list-style:none;font-size:11px;color:#888} .mot li::before{content:"· ";color:#555}
.tit6{font-size:10.5px;color:#777;line-height:1.5} .tit6 b{color:#555;text-transform:uppercase;font-size:9px}
.links{font-size:11px;color:#666} .links a{color:#378ADD;text-decoration:none}
.editor{display:grid;grid-template-columns:2fr 1.4fr .8fr auto;gap:6px}
.editor input{background:#0a0a0a;border:1px solid #333;color:#eee;border-radius:6px;padding:6px 8px;font-size:12px;min-width:0}
.teste{font-size:10.5px;color:#9ab;background:#0b0e10;border:1px solid #1d2730;border-radius:6px;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap}
.acoes{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:auto}
.sel{font-size:11px;color:#777;display:flex;gap:4px;align-items:center;margin-right:4px}
.aviso{background:#1a1408;border:1px solid #3a2e15;color:#e0a23a;font-size:11.5px;padding:9px 12px;border-radius:8px;margin-bottom:12px}
@media(max-width:760px){.painel{grid-template-columns:1fr}.card{grid-template-columns:1fr}.img{min-height:0}.img img{max-height:220px}.editor{grid-template-columns:1fr}}
</style></head><body>

<h1>GERMANUS.Art — Fichas</h1>
<p class="sub"><a href="/curadoria">← curadoria</a> · <a href="/agente">agente</a> · <a href="/triagem">triagem</a> · cada ficha é rebuscada pelo próprio ID na fonte e conferida no Wikidata; nada muda no site sem a sua aprovação</p>

${temSenha ? "" : `<div class="aviso">Painel sem senha: qualquer pessoa com o link pode aceitar fichas. Crie <b>FICHAS_SENHA</b> no Railway (ou use a NOTICIAS_SENHA, que já vale aqui).</div>`}
${temEuropeana ? "" : `<div class="aviso">EUROPEANA_KEY não encontrada: as obras da Europeana vão cair em "Erros" até a chave existir.</div>`}

<div class="painel">
  <div class="box">
    <h3>Diagnóstico das fichas publicadas</h3>
    <div class="num">${n(diag.com_defeito)} <small>com defeito, de ${n(diag.publicadas)} publicadas · ${n(naoVistas)} ainda não conferidas</small></div>
    <p style="margin-top:8px">${defs || "nenhum defeito detectado"}</p>
    <p>Por fonte: ${fontes || "—"}</p>
    <p><a href="/fichas?aba=${aba}&recontar=1" style="color:#555">recontar</a></p>
  </div>
  <div class="box">
    <h3>Rodar uma remessa</h3>
    <div class="ctrl">
      <select id="qtd"><option>100</option><option selected>300</option><option>1000</option><option>3000</option></select>
      <select id="esc"><option value="publicadas">publicadas</option><option value="entrada">entrada</option><option value="todas">todas</option></select>
      <select id="sodef"><option value="1">só com defeito</option><option value="0">todas (confere também as boas)</option></select>
      <button class="go" onclick="rodar()">▶ rodar</button>
      <button onclick="parar()">■ parar</button>
    </div>
    <div id="st">${estado.rodando ? "⏳ rodando…" : ""}</div>
    <p style="margin-top:8px">As com mais defeitos vão primeiro. Cerca de 1 a 2 segundos por obra (300 ≈ 8 min). Pode fechar a página.</p>
    <div class="ctrl" style="margin-top:4px">
      <input id="tid" placeholder="ID para testar sem gravar" style="flex:1;min-width:160px">
      <button onclick="testar(document.getElementById('tid').value.trim())">🔎 testar</button>
    </div>
    <pre class="teste" id="t_" hidden></pre>
  </div>
</div>

<div class="abas">${abas}</div>

${(aba === "alta" || aba === "media") && total ? `<div class="lote">
  <button onclick="marcarTodas()">marcar todas da página</button>
  <button class="ok" onclick="aceitarSel()">✓ aceitar marcadas</button>
  <button class="no" onclick="rejeitarSel()">✗ rejeitar marcadas</button>
  ${aba === "alta" ? `<button class="ok" onclick="aceitarTodasAlta()">✓ aceitar TODAS de alta confiança (${n(contagem.alta)})</button>` : ""}
</div>` : ""}
${aba === "erro" || aba === "sem_fonte" || aba === "rejeitada" || aba === "ok" ? `<div class="lote">
  <button onclick="reabrir('${aba}')">↻ devolver estas ${n(total)} para a fila</button>
  ${aba === "sem_fonte" ? `<span>Estas não trazem um ID de fonte consultável. Corrija à mão o que estiver errado.</span>` : ""}
</div>` : ""}

<div class="nav">
  ${offset > 0 ? `<a href="/fichas?aba=${aba}&offset=${offset - LIMIT}">← Anterior</a>` : `<a class="off">← Anterior</a>`}
  <span>página ${pag} de ${pags} · ${n(total)} fichas</span>
  ${offset + LIMIT < total ? `<a href="/fichas?aba=${aba}&offset=${offset + LIMIT}">Próxima →</a>` : `<a class="off">Próxima →</a>`}
</div>

<div class="lista">${obras.map(o => card(o, aba, rotulos)).join("") || `<p style="color:#555;font-size:13px">Nada nesta aba${aba === "alta" && !estado.rodando ? " — rode uma remessa acima" : ""}.</p>`}</div>

<div class="nav">
  ${offset > 0 ? `<a href="/fichas?aba=${aba}&offset=${offset - LIMIT}">← Anterior</a>` : `<a class="off">← Anterior</a>`}
  <span>página ${pag} de ${pags}</span>
  ${offset + LIMIT < total ? `<a href="/fichas?aba=${aba}&offset=${offset + LIMIT}">Próxima →</a>` : `<a class="off">Próxima →</a>`}
</div>

<script>
const TEM_SENHA = ${temSenha ? "true" : "false"};
function senha(){
  if(!TEM_SENHA) return {};
  let s = ""; try { s = localStorage.getItem("germ_senha") || ""; } catch(e){}
  if(!s){ s = prompt("Senha do painel:") || ""; try { localStorage.setItem("germ_senha", s); } catch(e){} }
  return { "x-senha": s };
}
async function post(url, body){
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", ...senha() }, body: JSON.stringify(body||{}) });
  const d = await r.json().catch(()=>({error:"resposta inválida"}));
  if(r.status===401){ try{ localStorage.removeItem("germ_senha"); }catch(e){} }
  if(!r.ok || d.error) throw new Error(d.error || ("HTTP "+r.status));
  return d;
}
function feito(id){ const c=document.getElementById("c_"+id); if(c) c.classList.add("feito"); }
async function aceitar(ids, btn){
  try{ if(btn) btn.disabled=true; await post("/api/fichas/aceitar",{ids}); ids.forEach(feito); }
  catch(e){ alert("Erro: "+e.message); if(btn) btn.disabled=false; }
}
async function rejeitar(ids, btn){
  try{ if(btn) btn.disabled=true; await post("/api/fichas/rejeitar",{ids}); ids.forEach(feito); }
  catch(e){ alert("Erro: "+e.message); if(btn) btn.disabled=false; }
}
function marcadas(){ return [...document.querySelectorAll(".chk:checked")].map(c=>c.value); }
function marcarTodas(){ document.querySelectorAll(".chk").forEach(c=>c.checked=true); }
function aceitarSel(){ const i=marcadas(); if(!i.length) return alert("Marque pelo menos uma."); aceitar(i); }
function rejeitarSel(){ const i=marcadas(); if(!i.length) return alert("Marque pelo menos uma."); rejeitar(i); }
async function aceitarTodasAlta(){
  if(!confirm("Aceitar todas as fichas de alta confiança? Cada uma guarda a versão anterior e pode ser desfeita na aba Aceitas.")) return;
  try{ const d=await post("/api/fichas/aceitar",{todas_alta:true}); alert("Aceitas: "+d.aceitas); location.reload(); }
  catch(e){ alert("Erro: "+e.message); }
}
async function desfazer(id, btn){
  try{ btn.disabled=true; await post("/api/fichas/desfazer",{id}); feito(id); }
  catch(e){ alert("Erro: "+e.message); btn.disabled=false; }
}
function abrirEditor(id){ const e=document.getElementById("e_"+id); e.hidden=!e.hidden; }
async function salvarEdicao(id, btn){
  const e=document.getElementById("e_"+id), v={id};
  e.querySelectorAll("input").forEach(i=>v[i.dataset.k]=i.value);
  try{ btn.disabled=true; await post("/api/fichas/editar",v); feito(id); }
  catch(err){ alert("Erro: "+err.message); btn.disabled=false; }
}
async function reabrir(estado){
  if(!confirm("Devolver estas fichas para a fila? Elas serão conferidas de novo na próxima remessa.")) return;
  try{ const d=await post("/api/fichas/reabrir",{estado}); alert("Devolvidas: "+d.reabertas); location.reload(); }
  catch(e){ alert("Erro: "+e.message); }
}
async function testar(id, btn){
  if(!id) return;
  const box=document.getElementById("t_"+(btn?id:"")) || document.getElementById("t_");
  box.hidden=false; box.textContent="⏳ consultando a fonte…";
  try{ const r=await fetch("/api/fichas/testar?id="+encodeURIComponent(id)); box.textContent=JSON.stringify(await r.json(),null,2); }
  catch(e){ box.textContent="Erro: "+e.message; }
}
async function rodar(){
  const total=+document.getElementById("qtd").value, escopo=document.getElementById("esc").value;
  const so_defeituosas=document.getElementById("sodef").value==="1";
  try{ const d=await post("/api/fichas/rodar",{total,escopo,so_defeituosas}); document.getElementById("st").textContent="✅ "+d.mensagem; acompanhar(); }
  catch(e){ document.getElementById("st").textContent="❌ "+e.message; }
}
async function parar(){ try{ await post("/api/fichas/parar"); }catch(e){ alert(e.message); } }
let tick=null;
async function acompanhar(){
  clearTimeout(tick);
  try{
    const s=await (await fetch("/api/fichas/status")).json();
    const el=document.getElementById("st");
    if(s.rodando || s.feitas){
      el.textContent=(s.rodando?"⏳ ":"✅ concluído · ")+s.feitas+" de "+s.alvo+" · "+s.propostas+" propostas · "+s.ok+" já corretas · "+s.sem_fonte+" sem fonte · "+s.erros+" erros"
        +(s.ultima?"\\nagora: "+s.ultima:"")+(s.ultimo_erro?"\\núltimo erro: "+s.ultimo_erro:"");
    }
    if(s.rodando) tick=setTimeout(acompanhar,3000);
  }catch(e){}
}
acompanhar();
</script>
</body></html>`;
}

module.exports = { paginaFichas };
