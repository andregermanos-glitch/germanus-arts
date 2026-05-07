# GERMANUS.Arts — Deploy no Railway

## Pré-requisitos
- Conta no GitHub (gratuita) — github.com
- Conta no Railway (gratuita) — railway.app
- Chave da API Anthropic — console.anthropic.com

---

## Passo a passo

### 1. Subir para o GitHub

```bash
# Na pasta germanus-deploy:
git init
git add .
git commit -m "Germanus.Arts v1.0"

# Crie um repositório no GitHub (github.com/new)
# Depois conecte:
git remote add origin https://github.com/SEU_USUARIO/germanus-arts.git
git push -u origin main
```

### 2. Deploy no Railway

1. Acesse railway.app e faça login
2. Clique em **New Project → Deploy from GitHub repo**
3. Selecione o repositório `germanus-arts`
4. Railway detecta automaticamente que é Node.js

### 3. Configurar variáveis de ambiente

No painel do Railway, vá em **Variables** e adicione:

```
ANTHROPIC_API_KEY = sk-ant-... (sua chave)
```

Opcionais para mais museus:
```
RIJKS_KEY    = ...  (rijksmuseum.nl)
HARVARD_KEY  = ...  (harvardartmuseums.org)
EUROPEANA_KEY = ... (apis.europeana.eu)
```

### 4. Configurar Build e Start

O Railway deve detectar automaticamente, mas confirme em **Settings**:
- Build Command: `npm run build`
- Start Command: `npm start`

### 5. Acessar o app

Após o deploy (~3 minutos), Railway fornece uma URL pública:
```
https://germanus-arts-xxxx.up.railway.app
```

Acesse essa URL — o Germanus.Arts estará funcionando com imagens reais.

---

## Verificar se está funcionando

Acesse `/api/status` na sua URL:
```
https://sua-url.up.railway.app/api/status
```

Deve retornar JSON com status "online" e confirmação de que a chave Anthropic está configurada.

---

## Custo estimado

- Railway free tier: $5 de crédito por mês (suficiente para uso leve)
- Railway hobby: $5/mês (produção contínua)
- A chave Anthropic: ~$0.003 por busca (muito barato)

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env
# Edite .env com suas chaves

# Terminal 1 — Backend
npm run dev:server

# Terminal 2 — Frontend
npm run dev:client

# Acesse: http://localhost:5173
```
