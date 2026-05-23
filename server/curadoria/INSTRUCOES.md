# GERMANUS.Art — Curadoria JSONs v2
Gerado em 23/05/2026 | 182 obras em 18 alas

## Estrutura dos JSONs

Cada obra tem 3 formatos possíveis, em ordem de prioridade no curador.js:

### 1. ID direto Met (melhor — 100% fiável)
```json
{ "met_id": 11417, "api": "met", ... }
```

### 2. ID direto AIC (melhor — 100% fiável)
```json
{ "aic_id": 27992, "api": "aic", ... }
```

### 3. URL Wikimedia (bom — bypass completo de API)
```json
{ "image_url": "https://upload.wikimedia.org/...", "api": "wikimedia", ... }
```

### 4. search_q (cascata Met → Cleveland → AIC → Europeana)
```json
{ "search_q": "Rembrandt self-portrait painting", "api": "met", ... }
```

## IDs diretos incluídos (confirmados)

| Ala | Obra | ID |
|-----|------|-----|
| historico | Washington Crossing the Delaware | met_id: 11417 |
| perspectiva | Paris Street; Rainy Day (Caillebotte) | aic_id: 20684 |
| luz_sol | Water Lilies (Monet 1906) | aic_id: 16568 |
| cores | A Sunday on La Grande Jatte (Seurat) | aic_id: 27992 |
| femininas | The Child's Bath (Cassatt) | aic_id: 111442 |
| femininas | Woman in Black at the Opera (Cassatt) | aic_id: 16790 |
| retratos | Juan de Pareja (Velázquez) | met_id: 437394 |

## Como adicionar mais IDs diretos (recomendado)

Para cada obra com `search_q`, pode enriquecer com ID direto:

```bash
# AIC — buscar por título/artista:
curl "https://api.artic.edu/api/v1/artworks/search?q=Rembrandt+self+portrait&fields=id,title,artist_display,is_public_domain&limit=5"

# Met — buscar por título/artista:
curl "https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=Rembrandt+self+portrait"
# → pegar objectID, depois:
curl "https://collectionapi.metmuseum.org/public/collection/v1/objects/{ID}"
# → confirmar: isPublicDomain=true e primaryImage não vazio
```

## Deploy

```sql
-- No Railway Postgres, ANTES de fazer commit:
DELETE FROM artworks WHERE source = 'curadoria';
```

Depois: **Commit → Push → Redeploy no Railway**

O curador.js re-indexa automaticamente ao subir.

## Wikimedia URLs incluídas (6 obras)

URLs computadas com MD5 correto. Se alguma retornar 404, o job 
`validateAndCleanImages` (24h) a marcará como NULL e o curador 
retentará na próxima rodada. Inofensivo.

