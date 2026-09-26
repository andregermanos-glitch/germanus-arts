# Aba Exposições + a exposição Olhares

Arquivo novo: `src/Exposicoes.jsx`.
Alterados: `src/App.jsx` (3 trechos). O `colecoes_ui.js` no servidor continua o mesmo.

Se você ainda não subiu o `Colecoes.jsx`, **não suba** — o `Exposicoes.jsx`
o substitui e faz mais: tem a vista de sala, que o outro não tinha.

---

## 1 · src/App.jsx — import

Abaixo de `import Atendente from "./Atendente";`:

```js
import Exposicoes from "./Exposicoes";
```

## 2 · src/App.jsx — o rótulo da aba, nos 6 idiomas

No objeto `T`, terceira posição de `tabs`:

- `fr`: `"Expositions"` · `en`: `"Exhibitions"` · `es`: `"Exposiciones"`
- `pt`: `"Exposições"` · `it`: `"Mostre"` · `de`: `"Ausstellungen"`

Só a terceira muda. A segunda continua sendo a coleção pessoal do visitante.

## 3 · src/App.jsx — o conteúdo da aba

Procure por `CuradoriaTab` (a linha de uso, única):

```jsx
        {tab==="curadoria"&&<CuradoriaTab col={col} onClickAla={ala=>{clickAla(ala);setTab("buscar");}} t={t} lang={lang}/>}
```

Troque por:

```jsx
        {tab==="curadoria"&&<Exposicoes lang={lang}/>}
```

O identificador interno `"curadoria"` fica como está — trocá-lo obrigaria a
mexer em cinco lugares sem ganho. Só o rótulo e o conteúdo mudam.

---

## 4 · Criar a exposição

No Postgres, para já deixar o registro pronto com o texto curatorial:

```sql
insert into colecoes (slug, titulo_pt, titulo_fr, titulo_en, titulo_es, titulo_it, titulo_de,
                      texto_pt, publicada, ordem)
values ('olhares', 'Olhares', 'Regards', 'Gazes', 'Miradas', 'Sguardi', 'Blicke',
'Não é uma exposição sobre mulheres no século XIX. É uma exposição sobre o ato de olhar, no momento em que a pintura ocidental deixa de ser apenas representação e passa a ser também psicologia, sociabilidade e instante.

O olhar circula de várias formas: o olhar para si, diante do espelho; o olhar para o outro, na conversa e na cumplicidade; o olhar através de um limiar, pela janela; o olhar ausente, que desce para a mesa; o olhar direto, que devolve ao visitante a sua própria condição de observador.

Os cenários funcionam como dispositivos de enquadramento: toucadores, cafés, janelas, barcos, campos de trigo, salões. A luz impressionista ou a precisão acadêmica servem ao mesmo propósito — tornar visível a qualidade daquele olhar.

As obras já estão olhando umas para as outras.',
true, 1)
on conflict (slug) do update set texto_pt = excluded.texto_pt;
```

## 5 · Montar a sequência

Abra `/colecoes?c=olhares`, busque cada obra por autor e adicione. Depois use
as setas para pôr na ordem do argumento.

**Ordem sugerida, pelos cinco modos de olhar:**

1. Courbet — o espelho: abertura, o olhar para si
2. Madrazo — o sapato rosa: cumplicidade feminina no espaço privado
3. Zandomeneghi — duas mulheres à mesa: o olhar confidencial
4. Degas — *Bouderie*: o olhar direto e interrogativo
5. Degas — *L'Absinthe*: o olhar que desce, vazio
6. Monet — o lenço vermelho: o olhar através do limiar
7. Morisot — no barco com o cisne: o olhar que se recolhe
8. Morisot — Julie com o galgo
9. Cassatt / Renoir — o convívio
10. Renoir — o almoço dos barqueiros: o olhar como prazer social
11. Ridgway Knight — a camponesa no trigo: o olhar solar e direto
12. Grigorescu — a jovem no jardim: o olhar que se deixa capturar
13. Tito — *Donne di pescatori*
14. Whistler — o interior em aquarela
15. Pagliano, Andreotti, Greuze e a menina das margaridas conforme você decidir

**Atenção a duas correções antes de publicar:**

O sapato rosa é de **Raimundo de Madrazo y Garreta**, não de Alfred Stevens.
O texto que você recebeu traz essa atribuição errada.

A cena de praia é **Ettore Tito, *Donne di pescatori*** — italiano, 1859–1941,
domínio público desde 2012. A ficha no banco precisa da correção que já
conversamos.

**Notas de parede.** Cada obra pode ter uma linha própria na coluna `nota_pt`
da tabela `colecao_obras`, que a sala exibe ao lado da legenda:

```sql
update colecao_obras set nota_pt = 'O manifesto da exposição. O olhar não é coquete: é concentrado, quase analítico.'
 where colecao = 'olhares' and obra_id = 'ID_DA_OBRA_DE_COURBET';
```

---

## Como a sala funciona

As obras ficam **lado a lado**, alinhadas pela base, numa faixa percorrida da
esquerda para a direita — que é o que faz a ordem valer como argumento. No
desktop as telas têm 340px de altura; no celular, 230px, e a faixa rola com o
dedo. Clicar amplia.

Não é grade de propósito. Grade embaralha a sequência e desfaz a leitura.
