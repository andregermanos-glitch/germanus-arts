import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Paginas from './Paginas.jsx'
import { ROTAS } from './MenuRodape.jsx'

// Páginas do menu do rodapé (/nos-somos, /direitos, /editorial, /loja, /contatos);
// qualquer outro caminho abre o site como sempre.
let slug = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
if (slug === 'noticias') slug = 'editorial'   // endereço antigo continua funcionando

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {ROTAS.includes(slug) ? <Paginas slug={slug} /> : <App />}
  </React.StrictMode>
)
