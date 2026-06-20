// server/imagens_mortas.js — Obras com imagem morta → Entrada (Opção A)
// ─────────────────────────────────────────────────────────────────────────────
// O navegador do visitante avisa quando a imagem de uma obra não carrega
// (onError do <img>). Aqui contamos as falhas; depois de 2 avisos, a obra é
// movida para a ENTRADA (status='rascunho') — some do site na hora, e fica
// visível na curadoria para você arquivar ou achar imagem nova depois.
//
// Não muda o ala_id: a Entrada da curadoria mostra TODOS os rascunhos, então a
// obra preserva sua ala original (útil se você consertar e republicar).
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./imagens_mortas").montarImagensMortas(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const LIMITE_FALHAS = 2; // nº de avisos antes de mover para a Entrada

function montarImagensMortas(app, pool) {
  pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS falhas_imagem INT DEFAULT 0`)
    .then(() => console.log("🖼️  Imagens mortas — coluna pronta"))
    .catch(e => console.log("🖼️  Imagens mortas — migração:", e.message));

  // O frontend chama isto quando uma imagem não carrega
  app.post("/api/obra/imagem-morta", async (req, res) => {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) return res.status(400).json({ error: "id obrigatório" });

      // conta a falha; só mexe em obra ainda publicada
      const r = await pool.query(
        `UPDATE artworks
            SET falhas_imagem = COALESCE(falhas_imagem,0) + 1
          WHERE id = $1 AND COALESCE(status,'publicada') = 'publicada'
          RETURNING falhas_imagem`,
        [id]
      );
      if (r.rowCount === 0) return res.json({ ok: true, movida: false }); // já não publicada / não existe

      const falhas = parseInt(r.rows[0].falhas_imagem, 10);
      let movida = false;
      if (falhas >= LIMITE_FALHAS) {
        await pool.query(
          `UPDATE artworks SET status = 'rascunho' WHERE id = $1`, [id]
        );
        movida = true;
        console.log(`🖼️  Imagem morta — "${id}" movida para a Entrada (${falhas} falhas)`);
      }
      res.json({ ok: true, falhas, movida });
    } catch (e) {
      res.json({ ok: false }); // nunca quebra a navegação por causa disto
    }
  });

  // monitoramento: quantas já foram para a Entrada por imagem morta
  app.get("/api/obra/mortas", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE COALESCE(falhas_imagem,0) > 0) AS com_falha,
                COUNT(*) FILTER (WHERE COALESCE(falhas_imagem,0) >= ${LIMITE_FALHAS}
                                   AND COALESCE(status,'publicada') = 'rascunho') AS movidas
           FROM artworks`
      );
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log("🖼️  Imagens mortas montado — POST /api/obra/imagem-morta");
}

module.exports = { montarImagensMortas };
