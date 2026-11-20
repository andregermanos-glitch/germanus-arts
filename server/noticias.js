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

// Primeira versão das traduções (EN e FR), gravada em 19/11/2026. Fica aqui só para
// reconhecer esses textos no banco e trocá-los pela versão revisada abaixo.
const TRAD_V1 = {
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

// ─── Páginas em seis idiomas ─────────────────────────────────────────────────
// O português é o texto de origem (campo `texto`); os outros idiomas ficam em
// texto_en, texto_fr, texto_es, texto_it, texto_de. Quem lê num idioma sem tradução
// vê o inglês (idioma principal do site) e, na falta dele, o português.
const OUTROS_IDIOMAS = ["en", "fr", "es", "it", "de"];

// Pontuação francesa: espaço que não quebra antes de : ; ? !
const fr = t => t.replace(/ ([:;?!])/g, " $1");

// Títulos (os mesmos do menu do rodapé)
const TITULOS = {
  "nos-somos": { en: "About us", fr: "Qui sommes-nous", es: "Quiénes somos", it: "Chi siamo", de: "Über uns" },
  "direitos":  { en: "Rights",   fr: "Droits",          es: "Derechos",      it: "Diritti",   de: "Rechte" },
  "loja":      { en: "Shop",     fr: "Boutique",        es: "Tienda",        it: "Negozio",   de: "Shop" },
  "contatos":  { en: "Contact",  fr: "Contact",         es: "Contacto",      it: "Contatti",  de: "Kontakt" },
};

// Traduções dos textos padrão — valem enquanto o português no banco for o texto padrão.
const TRAD_PADRAO = {
  "nos-somos": {
    en:
`GERMANUS.Art is a curatorial platform for public-domain art. We bring together works from museums around the world and arrange them in 18 thematic galleries, conceived from the act of looking: the portrait, history, objects, ordinary people, light, color, emotion.

Each gallery measures the visual arts by what the eye can reach. A work enters the gallery in which one of its elements commands the viewer's experience — not according to a rigid classification by school or period.

The collection is free to view, study and share. The GERMANUS.Art Editorial follows, day by day, what is happening in the visual arts, fashion and culture, with its own reading and signed opinion.`,
    fr: fr(
`GERMANUS.Art est une plateforme de curation consacrée à l'art du domaine public. Nous réunissons des œuvres de musées du monde entier et les organisons en 18 galeries thématiques, pensées à partir du regard : le portrait, l'histoire, les objets, les gens du peuple, la lumière, les couleurs, l'émotion.

Chaque galerie mesure les arts plastiques à ce que le regard atteint. Une œuvre entre dans la galerie où l'un de ses éléments commande l'expérience de celui qui la regarde, et non selon un classement rigide par école ou par période.

La collection est en accès libre : chacun peut la voir, l'étudier et la partager. L'Éditorial GERMANUS.Art suit chaque jour l'actualité des arts plastiques, de la mode et de la société, avec un regard propre et une opinion signée.`),
    es:
`GERMANUS.Art es una plataforma de curaduría de arte en dominio público. Reunimos obras de museos de todo el mundo y las organizamos en 18 galerías temáticas, pensadas a partir de la mirada: el retrato, la historia, los objetos, la gente del pueblo, la luz, los colores, la emoción.

Cada galería mide las artes plásticas por lo que alcanza la mirada. Una obra entra en la galería en la que uno de sus elementos gobierna la experiencia de quien la mira, y no por una clasificación rígida de escuela o período.

La colección es de libre acceso: se puede ver, estudiar y compartir. El Editorial GERMANUS.Art sigue a diario lo que sucede en las artes plásticas, la moda y las tendencias, con una lectura propia y opinión firmada.`,
    it:
`GERMANUS.Art è una piattaforma curatoriale dedicata all'arte di pubblico dominio. Riuniamo opere di musei di tutto il mondo e le ordiniamo in 18 gallerie tematiche, pensate a partire dallo sguardo: il ritratto, la storia, gli oggetti, la gente del popolo, la luce, i colori, l'emozione.

Ogni galleria misura le arti visive su ciò che lo sguardo raggiunge. Un'opera entra nella galleria in cui uno dei suoi elementi guida l'esperienza di chi la guarda, e non secondo una classificazione rigida per scuola o periodo.

La collezione si può vedere, studiare e condividere liberamente. L'Editoriale GERMANUS.Art segue ogni giorno ciò che accade nelle arti visive, nella moda e nel costume, con una lettura propria e opinioni firmate.`,
    de:
`GERMANUS.Art ist eine kuratorische Plattform für gemeinfreie Kunst. Wir vereinen Werke aus Museen in aller Welt und ordnen sie in 18 thematischen Galerien, die vom Sehen her gedacht sind: das Porträt, die Geschichte, die Dinge, die einfachen Leute, das Licht, die Farben, die Emotion.

Jede Galerie bemisst die bildende Kunst an dem, was der Blick erfasst. Ein Werk kommt in die Galerie, in der eines seiner Elemente das Seherlebnis bestimmt – nicht nach einer starren Einteilung in Schulen oder Epochen.

Die Sammlung steht allen frei zum Ansehen, Studieren und Teilen. Die Redaktion von GERMANUS.Art verfolgt täglich, was in der bildenden Kunst, in der Mode und in der Gesellschaft geschieht – mit eigener Lesart und namentlich gezeichneter Meinung.`,
  },
  "direitos": {
    en:
`Every work in the collection is in the public domain. We follow the rule of Brazilian copyright law: a work enters the public domain 70 years after January 1 of the year following the author's death. Older works by unknown artists, or by artists whose date of death is unknown, undergo additional checks before entering the collection.

Images come from two sources: museums with open-access policies, which release them under a CC0 license, and Wikimedia Commons, where the license is checked file by file. Every work goes through a rights review before publication, and each record states its source.

GERMANUS.Art Editorial texts are our own, written with the help of artificial intelligence and reviewed by our curators. News items cite and link to their original sources.

If you believe an image or text should not be here, please write to us through the Contact page. We review every request and, where appropriate, remove the content.`,
    fr: fr(
`Toutes les œuvres de la collection appartiennent au domaine public. Nous suivons la règle du droit d'auteur brésilien : une œuvre entre dans le domaine public 70 ans après le 1er janvier de l'année qui suit la mort de son auteur. Les œuvres anciennes d'auteur inconnu, ou dont la date de décès n'est pas connue, font l'objet d'une vérification supplémentaire avant d'entrer dans la collection.

Les images proviennent de deux sources : des musées pratiquant l'accès ouvert, qui les diffusent sous licence CC0, et Wikimedia Commons, où la licence est vérifiée fichier par fichier. Chaque œuvre passe par un contrôle des droits avant publication, et chaque fiche indique sa source.

Les textes de l'Éditorial GERMANUS.Art sont de notre plume, rédigés avec l'aide de l'intelligence artificielle et relus par la curation. Les articles citent leurs sources originales et renvoient vers elles.

Si vous estimez qu'une image ou un texte ne devrait pas figurer ici, écrivez-nous depuis la page Contact. Nous examinons chaque demande et, le cas échéant, retirons le contenu.`),
    es:
`Todas las obras de la colección están en dominio público. Seguimos la regla de la legislación brasileña de derechos de autor: una obra pasa al dominio público 70 años después del 1 de enero del año siguiente a la muerte de su autor. Las obras antiguas de autoría desconocida, o cuya fecha de muerte se desconoce, pasan por una verificación adicional antes de entrar en la colección.

Las imágenes provienen de dos fuentes: museos con políticas de acceso abierto, que las publican bajo licencia CC0, y Wikimedia Commons, donde la licencia se verifica archivo por archivo. Cada obra pasa por una revisión de derechos antes de publicarse, y cada ficha indica su fuente.

Los textos del Editorial GERMANUS.Art son de nuestra autoría, escritos con apoyo de inteligencia artificial y revisados por la curaduría. Las noticias citan y enlazan sus fuentes originales.

Si consideras que alguna imagen o algún texto no debería estar aquí, escríbenos desde la página de Contacto. Analizamos cada solicitud y, cuando corresponde, retiramos el contenido.`,
    it:
`Tutte le opere della collezione sono di pubblico dominio. Seguiamo la regola della legge brasiliana sul diritto d'autore: un'opera diventa di pubblico dominio 70 anni dopo il 1° gennaio dell'anno successivo alla morte dell'autore. Le opere antiche di autore ignoto, o di cui non si conosce la data di morte, sono sottoposte a una verifica aggiuntiva prima di entrare nella collezione.

Le immagini provengono da due fonti: musei con politiche di accesso aperto, che le rendono disponibili con licenza CC0, e Wikimedia Commons, dove la licenza viene verificata file per file. Ogni opera passa un controllo dei diritti prima della pubblicazione, e ogni scheda ne indica la fonte.

I testi dell'Editoriale GERMANUS.Art sono nostri, scritti con il supporto dell'intelligenza artificiale e rivisti dalla curatela. Le notizie citano le fonti originali e vi rimandano con un link.

Se ritieni che un'immagine o un testo non debba trovarsi qui, scrivici dalla pagina Contatti. Esaminiamo ogni richiesta e, se necessario, rimuoviamo il contenuto.`,
    de:
`Alle Werke der Sammlung sind gemeinfrei. Wir folgen der Regel des brasilianischen Urheberrechts: Ein Werk wird 70 Jahre nach dem 1. Januar des auf den Tod des Urhebers folgenden Jahres gemeinfrei. Ältere Werke unbekannter Urheber oder mit unbekanntem Todesdatum werden vor der Aufnahme in die Sammlung zusätzlich geprüft.

Die Bilder stammen aus zwei Quellen: aus Museen mit Open-Access-Politik, die sie unter der Lizenz CC0 bereitstellen, und aus Wikimedia Commons, wo die Lizenz Datei für Datei geprüft wird. Jedes Werk durchläuft vor der Veröffentlichung eine Rechteprüfung, und jeder Eintrag nennt seine Quelle.

Die Texte der Redaktion von GERMANUS.Art sind eigene Texte, mit Unterstützung künstlicher Intelligenz verfasst und kuratorisch geprüft. Die Nachrichten nennen und verlinken ihre Originalquellen.

Wenn Sie der Meinung sind, dass ein Bild oder ein Text nicht hierher gehört, schreiben Sie uns über die Seite „Kontakt“. Wir prüfen jede Anfrage und entfernen den Inhalt gegebenenfalls.`,
  },
  "loja": {
    en: `Coming soon: tote bags and T-shirts featuring public-domain works from the collection, each piece labeled with the work's title, date and source.`,
    fr: fr(`Bientôt : des tote bags et des t-shirts ornés d'œuvres du domaine public de la collection, chaque pièce accompagnée d'une étiquette indiquant le titre, la date et la source de l'œuvre.`),
    es: `Próximamente: bolsas de tela y camisetas con obras de la colección en dominio público, cada pieza con una etiqueta que indica el título, la fecha y la fuente de la obra.`,
    it: `Prossimamente: shopper in tela e magliette con opere di pubblico dominio della collezione, ogni pezzo con un'etichetta che ne riporta titolo, data e fonte.`,
    de: `Demnächst: Stofftaschen und T-Shirts mit gemeinfreien Werken aus der Sammlung – jedes Stück mit einem Etikett, das Titel, Datum und Quelle des Werks nennt.`,
  },
  "contatos": {
    en: `TikTok: @germanus.art`,
    fr: fr(`TikTok : @germanus.art`),
    es: `TikTok: @germanus.art`,
    it: `TikTok: @germanus.art`,
    de: `TikTok: @germanus.art`,
  },
};

// Texto novo do "Nós Somos" (versão revisada de André) e suas traduções.
// Entram sozinhas se o português publicado for este texto — a comparação ignora
// maiúsculas, acentos, pontuação e espaços, e aceita o título "Nós Somos" no começo.
const MANIFESTO = {
  pt:
`Entre direitos e pessoas, assim nasceu a GERMANUS.Art.

A representação é o retrato social que nasce do indivíduo: a sua vontade de se materializar fora do tempo. Acreditamos que a filosofia da arte surge com a ruptura do indivíduo diante do objeto de arte. O que se põe na tela é a própria definição da arte como vontade.

Por isso as galerias começam pela representação pessoal, em Retratos. É o caminho mais intuitivo, embora as obras mais antigas do nosso acervo sejam sacras. Começar pelo retrato é uma escolha. O Ser, a persona, a sua construção pessoal é o início do acervo: o espaço da pessoa humana delimitado por uma moldura.

Mas a arte do ego não morre na moldura; ela vaza para a história. Pessoas Conhecidas são a representação do ego e de suas conquistas, que ecoam pela eternidade numa tela pintada.

A persona, porém, existe independentemente da história. O ser vivo conta a história pelo contexto social, e a sociedade é um embate de resultados nem justos nem certos, sujos em essência, românticos no olhar. Gente do Povo é a galeria que busca esse contexto: onde e quando acontece, o trabalho, a forma, a dor, a vida em moldura.

A história não é instante: ela vaza pela moldura e contamina o olhar. O social não a determina, é determinado por ela. Assim, História registra, homenageia e cataloga o tempo, e não o contrário.

O que cabe numa moldura? O tempo, a sociedade, as pessoas, suas histórias? O contexto das coisas diz o motivo da história e do tempo. As coisas determinam o homem; por isso ele as cria e as admira. Objetos são a história da arte em semiótica primitiva.

A persona não é só ego e história; é também determinação do espaço, e a moldura diz o que se vê. Natureza é o retrato do imutável, do indeterminável: a natureza indomável que determina o ser humano.

A natureza é indomável, mas os lugares que moldam a persona são a moldura significativa. Lugares Conhecidos guarda o que ainda tem significado e significância em si mesmo e perdura no tempo para além da própria história.

O significado não é apenas horizontal; ele reverbera costumes, vidas e aquilo que diz mais do que conseguimos expressar. A essa incompletude responde Sacro, que bem poderia se chamar religiosa, pois busca a nossa ligação com o indizível. E, como representação alegórica do indizível, há Esoterismo, onde o mito é a própria representação da realidade.

O indizível precisa ter um sentido e perpetuar o sentido da vida. Ambiente Familiar reúne o místico e o sagrado numa só moldura. A família não é apenas uma apresentação social: carrega, em tinta, os sentidos místicos, religiosos e filosóficos de cada tempo.

O corpo humano é forma, e a forma pede representação. Em Nus Femininos, o corpo é atemporal, inspirador e conspirador, mas foi sobretudo registro de corpos de mulheres moldados aos valores e às ideias de cada época.

Arquitetura reúne registros, acadêmicos ou não, de construções muitas vezes vistas como menores na história, mas que são documento de engenharia e de cultura.

Perspectiva não trata propriamente de ângulos de construção, mas de ângulos de formação: a vida vista de outras origens, o traço reto formando novas realidades. A persona não é produto de si mesma, mas de formas que se somam e criam novas realidades.

Luz do Sol nos lembra que o tempo é instante na memória de quem sabe ver. A luz é instante; a forma é subjetiva à luz. Cada instante é uma forma iluminada, registro sensível de quem sabe que o tempo é curto. Basta VER!

A passagem do tempo tem suas formas, mas as formas podem se subordinar às cores. Em Cores, não são as cores que ganham formas: as formas é que ganham as cores. Ver cores é a modernidade, o registro do pós-momento, o instante que perdura.

Em Emoção, a cor se junta ao sentimento, e as formas se subordinam às cores por seus aspectos psicológicos e emocionais. É o lugar da abstração e da arte contemporânea, que leva adiante o que o fauvismo começou ao libertar a cor da forma, e que não se limita aos materiais com que a cor é feita.

Mas a forma também é imposição. A imposição impregna a mente, e a mente tem diversas maneiras de enxergar a forma. Psiquê mostra que a moldura não contém o registro: a imagem se perde no imaginário, e é isso que a mente guarda. A arte sempre foi uma incógnita do pensamento sobre si e sobre a realidade. Dalí pressentiu a Guerra Civil Espanhola em Construção mole com feijões cozidos, de 1936.

E Artistas Femininas devolve a moldura a quem, por séculos, esteve mais dentro dela do que diante dela: mulheres que pintaram o seu tempo com o próprio olhar.

VIVA o instante que ainda vamos perceber!`,

  en:
`Between rights and people, GERMANUS.Art was born.

Representation is the social portrait born of the individual: the will to take on a form beyond time. We believe that the philosophy of art arises from the individual's rupture in the face of the art object. What is set down on the canvas is the very definition of art as will.

That is why the galleries begin with personal representation, in Portraits. It is the most intuitive path, even though the oldest works in our collection are sacred. Beginning with the portrait is a choice. Being, the persona, the way a self is built: this is where the collection begins — the space of the human person, bounded by a frame.

But the art of the ego does not die within the frame; it spills over into history. Famous Figures are the representation of the ego and its conquests, which echo through eternity on a painted canvas.

The persona, however, exists independently of history. The living being tells history through its social context, and society is a clash of outcomes, neither just nor certain, dirty in essence, romantic to the eye. Ordinary People is the gallery that seeks this context: where and when it happens — work, form, pain, life within a frame.

History is not an instant: it spills over the frame and seeps into the gaze. The social does not determine it; it is determined by it. Thus History records, honors and catalogs time — and not the other way around.

What fits within a frame? Time, society, people, their stories? The context of things tells us the reason for history and for time. Things shape us; that is why we make them and admire them. Objects is the history of art as primitive semiotics.

The persona is not only ego and history; it is also a shaping of space, and the frame decides what is seen. Nature is the portrait of the unchanging and the indeterminable: untamable nature, which shapes the human being.

Nature cannot be tamed, but the places that shape the persona are the frame that gives meaning. Famous Places keeps what still holds meaning and significance in itself, and endures in time beyond its own history.

Meaning is not only horizontal; it echoes customs, lives, and whatever speaks more than we are able to express. To this incompleteness, Sacred Art responds — it might just as well be called religious, for it seeks our bond with the ineffable. And, as an allegorical representation of the ineffable, there is Esotericism, where myth is the very representation of reality.

The ineffable must have a meaning and carry on the meaning of life. Home Life brings the mystical and the sacred together in a single frame. The family is not merely a social presentation: in paint, it carries the mystical, religious and philosophical meanings of each age.

The human body is form, and form calls for representation. In Female Nudes, the body is timeless, inspiring and conspiring, yet above all it was a record of women's bodies shaped to the values and ideas of each era.

Architecture gathers records, academic or not, of buildings often seen as minor in history, yet which document engineering and culture.

Perspective is not really about angles of construction but about angles of formation: life seen from other origins, the straight line shaping new realities. The persona is not a product of itself, but of forms that add up and create new realities.

Sunlight reminds us that time is an instant in the memory of those who know how to see. Light is an instant; form is subject to light. Every instant is an illuminated form, a sensitive record left by someone who knows that time is short. One need only SEE!

The passing of time has its forms, but forms can yield to colors. In Colors, it is not the colors that take on forms: it is the forms that take on colors. To see color is modernity, the record of the after-moment, the instant that endures.

In Emotion, color joins feeling, and forms yield to color through their psychological and emotional power. It is the place of abstraction and of contemporary art, which carries on what Fauvism began by freeing color from form, and which is not bound by the materials color is made of.

But form is also an imposition. Imposition seeps into the mind, and the mind has many ways of seeing form. Psyche shows that the frame does not hold the record: the image is lost in the imagination, and that is what the mind keeps. Art has always been an enigma of thought about itself and about reality. Dalí sensed the Spanish Civil War coming in Soft Construction with Boiled Beans, 1936.

And Women Artists gives the frame back to those who, for centuries, were more often inside it than in front of it: women who painted their time with their own eyes.

LONG LIVE the instant we have yet to perceive!`,

  fr: fr(
`Entre les droits et les personnes : ainsi est née GERMANUS.Art.

La représentation est le portrait social qui naît de l'individu : sa volonté de prendre forme hors du temps. Nous pensons que la philosophie de l'art naît de la rupture de l'individu face à l'objet d'art. Ce que l'on pose sur la toile est la définition même de l'art comme volonté.

C'est pourquoi les galeries commencent par la représentation de la personne, avec Portraits. C'est le chemin le plus intuitif, même si les œuvres les plus anciennes de notre collection sont sacrées. Commencer par le portrait est un choix. L'Être, la persona, sa construction personnelle : voilà le commencement de la collection — l'espace de la personne humaine délimité par un cadre.

Mais l'art de l'ego ne meurt pas dans le cadre ; il déborde dans l'histoire. Personnages célèbres est la représentation de l'ego et de ses conquêtes, qui résonnent pour l'éternité sur une toile peinte.

La persona, pourtant, existe indépendamment de l'histoire. L'être vivant raconte l'histoire à travers son contexte social, et la société est un affrontement de résultats ni justes ni certains, sales par essence, romantiques par le regard. Gens du peuple est la galerie qui cherche ce contexte : où et quand cela se passe, le travail, la forme, la douleur, la vie dans un cadre.

L'histoire n'est pas un instant : elle déborde du cadre et imprègne le regard. Le social ne la détermine pas, il est déterminé par elle. Ainsi, Histoire enregistre, honore et catalogue le temps, et non l'inverse.

Que contient un cadre ? Le temps, la société, les personnes, leurs histoires ? Le contexte des choses dit la raison de l'histoire et du temps. Les choses façonnent l'homme ; c'est pourquoi il les crée et les admire. Objets, c'est l'histoire de l'art en sémiotique primitive.

La persona n'est pas seulement ego et histoire ; elle est aussi détermination de l'espace, et le cadre dit ce que l'on voit. Nature est le portrait de l'immuable, de l'indéterminable : la nature indomptable qui façonne l'être humain.

La nature est indomptable, mais les lieux qui façonnent la persona sont le cadre qui donne sens. Lieux célèbres garde ce qui a encore un sens et une portée en soi, et qui dure dans le temps au-delà de sa propre histoire.

Le sens n'est pas seulement horizontal ; il fait résonner des coutumes, des vies et ce qui dit plus que nous ne savons exprimer. À cette incomplétude répond Art sacré, qu'on aurait tout aussi bien pu appeler art religieux, car il cherche notre lien avec l'indicible. Et, comme représentation allégorique de l'indicible, il y a Ésotérisme, où le mythe est la représentation même de la réalité.

L'indicible doit avoir un sens et perpétuer le sens de la vie. Vie domestique réunit le mystique et le sacré dans un même cadre. La famille n'est pas qu'une représentation sociale : elle porte, en peinture, les sens mystiques, religieux et philosophiques de chaque époque.

Le corps humain est forme, et la forme appelle la représentation. Dans Nus féminins, le corps est intemporel, inspirant et conspirateur, mais il fut surtout le témoignage de corps de femmes modelés selon les valeurs et les idées de chaque époque.

Architecture réunit des témoignages, académiques ou non, de constructions souvent jugées mineures par l'histoire, mais qui documentent l'ingénierie et la culture.

Perspective ne traite pas vraiment d'angles de construction, mais d'angles de formation : la vie vue depuis d'autres origines, le trait droit qui forme de nouvelles réalités. La persona n'est pas le produit d'elle-même, mais de formes qui s'additionnent et créent de nouvelles réalités.

Lumière du soleil nous rappelle que le temps est un instant dans la mémoire de qui sait voir. La lumière est instant ; la forme est soumise à la lumière. Chaque instant est une forme éclairée, trace sensible de qui sait que le temps est court. Il suffit de VOIR !

Le passage du temps a ses formes, mais les formes peuvent se soumettre aux couleurs. Dans Couleurs, ce ne sont pas les couleurs qui prennent forme : ce sont les formes qui prennent couleur. Voir les couleurs, c'est la modernité, la trace de l'après-instant, l'instant qui dure.

Dans Émotion, la couleur rejoint le sentiment, et les formes se soumettent aux couleurs par leur dimension psychologique et émotionnelle. C'est le lieu de l'abstraction et de l'art contemporain, qui poursuit ce que le fauvisme avait commencé en libérant la couleur de la forme, et qui ne se limite pas aux matériaux dont la couleur est faite.

Mais la forme est aussi une imposition. L'imposition imprègne l'esprit, et l'esprit a bien des façons de voir la forme. Psyché montre que le cadre ne contient pas la trace : l'image se perd dans l'imaginaire, et c'est cela que l'esprit garde. L'art a toujours été une énigme de la pensée sur elle-même et sur la réalité. Dalí a pressenti la guerre civile espagnole dans Construction molle avec haricots bouillis, en 1936.

Et Artistes femmes rend le cadre à celles qui, pendant des siècles, se sont trouvées plus souvent dedans que devant : des femmes qui ont peint leur temps avec leur propre regard.

VIVE l'instant qu'il nous reste à percevoir !`),

  es:
`Entre derechos y personas: así nació GERMANUS.Art.

La representación es el retrato social que nace del individuo: su voluntad de materializarse fuera del tiempo. Creemos que la filosofía del arte surge con la ruptura del individuo frente al objeto artístico. Lo que se pone en el lienzo es la definición misma del arte como voluntad.

Por eso las galerías empiezan por la representación personal, en Retratos. Es el camino más intuitivo, aunque las obras más antiguas de nuestra colección sean sacras. Empezar por el retrato es una elección. El Ser, la persona, su construcción personal es el comienzo de la colección: el espacio de la persona humana delimitado por un marco.

Pero el arte del ego no muere en el marco; se desborda hacia la historia. Personajes célebres es la representación del ego y de sus conquistas, que resuenan por la eternidad en un lienzo pintado.

La persona, sin embargo, existe con independencia de la historia. El ser vivo cuenta la historia a través del contexto social, y la sociedad es un choque de resultados ni justos ni ciertos, sucios en esencia, románticos en la mirada. Gente del pueblo es la galería que busca ese contexto: dónde y cuándo sucede, el trabajo, la forma, el dolor, la vida enmarcada.

La historia no es un instante: se desborda del marco y contamina la mirada. Lo social no la determina; es determinado por ella. Así, Historia registra, homenajea y cataloga el tiempo, y no al revés.

¿Qué cabe en un marco? ¿El tiempo, la sociedad, las personas, sus historias? El contexto de las cosas dice el motivo de la historia y del tiempo. Las cosas determinan al hombre; por eso él las crea y las admira. Objetos es la historia del arte en semiótica primitiva.

La persona no es solo ego e historia; es también determinación del espacio, y el marco dice lo que se ve. Naturaleza es el retrato de lo inmutable, de lo indeterminable: la naturaleza indómita que determina al ser humano.

La naturaleza es indómita, pero los lugares que moldean a la persona son el marco significativo. Lugares célebres guarda lo que todavía tiene significado y trascendencia en sí mismo y perdura en el tiempo más allá de su propia historia.

El significado no es solo horizontal; hace resonar costumbres, vidas y aquello que dice más de lo que logramos expresar. A esa incompletud responde Arte sacro, que bien podría llamarse religioso, pues busca nuestro vínculo con lo indecible. Y, como representación alegórica de lo indecible, está Esoterismo, donde el mito es la representación misma de la realidad.

Lo indecible necesita tener un sentido y perpetuar el sentido de la vida. Vida doméstica reúne lo místico y lo sagrado en un solo marco. La familia no es solo una presentación social: lleva, en pintura, los sentidos místicos, religiosos y filosóficos de cada tiempo.

El cuerpo humano es forma, y la forma pide ser representada. En Desnudos femeninos, el cuerpo es atemporal, inspirador y conspirador, pero fue sobre todo registro de cuerpos de mujeres moldeados según los valores y las ideas de cada época.

Arquitectura reúne registros, académicos o no, de construcciones a menudo consideradas menores en la historia, pero que son documento de ingeniería y de cultura.

Perspectiva no trata propiamente de ángulos de construcción, sino de ángulos de formación: la vida vista desde otros orígenes, el trazo recto que forma nuevas realidades. La persona no es producto de sí misma, sino de formas que se suman y crean nuevas realidades.

Luz del sol nos recuerda que el tiempo es un instante en la memoria de quien sabe ver. La luz es instante; la forma está sujeta a la luz. Cada instante es una forma iluminada, registro sensible de quien sabe que el tiempo es breve. ¡Basta con VER!

El paso del tiempo tiene sus formas, pero las formas pueden subordinarse a los colores. En Colores, no son los colores los que adquieren formas: son las formas las que adquieren colores. Ver colores es la modernidad, el registro del posmomento, el instante que perdura.

En Emoción, el color se une al sentimiento, y las formas se subordinan a los colores por sus aspectos psicológicos y emocionales. Es el lugar de la abstracción y del arte contemporáneo, que lleva adelante lo que el fauvismo empezó al liberar el color de la forma, y que no se limita a los materiales con que se hace el color.

Pero la forma también es imposición. La imposición impregna la mente, y la mente tiene muchas maneras de ver la forma. Psique muestra que el marco no contiene el registro: la imagen se pierde en el imaginario, y eso es lo que la mente guarda. El arte siempre ha sido una incógnita del pensamiento sobre sí mismo y sobre la realidad. Dalí presintió la Guerra Civil española en Construcción blanda con judías hervidas, de 1936.

Y Mujeres artistas devuelve el marco a quienes, durante siglos, estuvieron más dentro de él que frente a él: mujeres que pintaron su tiempo con su propia mirada.

¡VIVA el instante que aún vamos a percibir!`,

  it:
`Tra diritti e persone: così è nata GERMANUS.Art.

La rappresentazione è il ritratto sociale che nasce dall'individuo: la sua volontà di farsi materia fuori dal tempo. Crediamo che la filosofia dell'arte nasca dalla rottura dell'individuo di fronte all'oggetto d'arte. Ciò che si pone sulla tela è la definizione stessa dell'arte come volontà.

Per questo le gallerie cominciano dalla rappresentazione della persona, con Ritratti. È il percorso più intuitivo, anche se le opere più antiche della nostra collezione sono sacre. Cominciare dal ritratto è una scelta. L'Essere, la persona, la costruzione di sé sono l'inizio della collezione: lo spazio della persona umana delimitato da una cornice.

Ma l'arte dell'ego non muore nella cornice: trabocca nella storia. Personaggi celebri è la rappresentazione dell'ego e delle sue conquiste, che risuonano per l'eternità su una tela dipinta.

La persona, però, esiste indipendentemente dalla storia. L'essere vivente racconta la storia attraverso il contesto sociale, e la società è uno scontro di esiti né giusti né certi, sporchi nell'essenza, romantici nello sguardo. Gente del popolo è la galleria che cerca questo contesto: dove e quando accade, il lavoro, la forma, il dolore, la vita in cornice.

La storia non è un istante: trabocca dalla cornice e contamina lo sguardo. Il sociale non la determina, ne è determinato. Così Storia registra, onora e cataloga il tempo, e non il contrario.

Che cosa sta dentro una cornice? Il tempo, la società, le persone, le loro storie? Il contesto delle cose dice il motivo della storia e del tempo. Le cose determinano l'uomo; per questo egli le crea e le ammira. Oggetti è la storia dell'arte in semiotica primitiva.

La persona non è solo ego e storia; è anche determinazione dello spazio, e la cornice dice ciò che si vede. Natura è il ritratto dell'immutabile, dell'indeterminabile: la natura indomabile che determina l'essere umano.

La natura è indomabile, ma i luoghi che plasmano la persona sono la cornice che dà senso. Luoghi celebri custodisce ciò che ha ancora significato e rilevanza in sé e che dura nel tempo oltre la propria storia.

Il significato non è solo orizzontale: fa risuonare costumi, vite e ciò che dice più di quanto riusciamo a esprimere. A questa incompiutezza risponde Arte sacra, che potrebbe ben chiamarsi religiosa, perché cerca il nostro legame con l'indicibile. E, come rappresentazione allegorica dell'indicibile, c'è Esoterismo, dove il mito è la rappresentazione stessa della realtà.

L'indicibile deve avere un senso e perpetuare il senso della vita. Vita domestica riunisce il mistico e il sacro in un'unica cornice. La famiglia non è solo una presentazione sociale: porta con sé, nella pittura, i significati mistici, religiosi e filosofici di ogni tempo.

Il corpo umano è forma, e la forma chiede di essere rappresentata. In Nudi femminili il corpo è senza tempo, ispiratore e cospiratore, ma fu soprattutto la testimonianza di corpi di donne modellati sui valori e sulle idee di ogni epoca.

Architettura raccoglie testimonianze, accademiche o no, di costruzioni spesso considerate minori dalla storia, ma che sono documento di ingegneria e di cultura.

Prospettiva non parla propriamente di angoli di costruzione, ma di angoli di formazione: la vita vista da altre origini, il tratto dritto che forma nuove realtà. La persona non è prodotto di sé stessa, ma di forme che si sommano e creano nuove realtà.

Luce del sole ci ricorda che il tempo è un istante nella memoria di chi sa vedere. La luce è istante; la forma è soggetta alla luce. Ogni istante è una forma illuminata, traccia sensibile di chi sa che il tempo è breve. Basta VEDERE!

Il passare del tempo ha le sue forme, ma le forme possono sottomettersi ai colori. In Colori non sono i colori a prendere forma: sono le forme a prendere colore. Vedere i colori è la modernità, la traccia del dopo-istante, l'istante che dura.

In Emozione il colore si unisce al sentimento, e le forme si sottomettono ai colori per i loro aspetti psicologici ed emotivi. È il luogo dell'astrazione e dell'arte contemporanea, che porta avanti ciò che il fauvismo aveva cominciato liberando il colore dalla forma, e che non si limita ai materiali di cui il colore è fatto.

Ma la forma è anche imposizione. L'imposizione impregna la mente, e la mente ha molti modi di vedere la forma. Psiche mostra che la cornice non contiene la traccia: l'immagine si perde nell'immaginario, ed è questo che la mente conserva. L'arte è sempre stata un'incognita del pensiero su sé stesso e sulla realtà. Dalí presentì la guerra civile spagnola in Costruzione molle con fagioli bolliti, del 1936.

E Artiste donne restituisce la cornice a chi, per secoli, vi è stata più dentro che davanti: donne che hanno dipinto il loro tempo con il proprio sguardo.

VIVA l'istante che dobbiamo ancora percepire!`,

  de:
`Zwischen Rechten und Menschen – so entstand GERMANUS.Art.

Darstellung ist das gesellschaftliche Bildnis, das aus dem Einzelnen hervorgeht: sein Wille, jenseits der Zeit Gestalt anzunehmen. Wir glauben, dass die Philosophie der Kunst mit dem Bruch des Einzelnen vor dem Kunstobjekt entsteht. Was auf die Leinwand gebracht wird, ist die Definition der Kunst als Wille schlechthin.

Deshalb beginnen die Galerien mit der Darstellung des Menschen, in der Galerie Porträts. Das ist der intuitivste Weg, auch wenn die ältesten Werke unserer Sammlung sakral sind. Mit dem Porträt zu beginnen, ist eine Entscheidung. Das Sein, die Persona, ihr persönlicher Aufbau ist der Anfang der Sammlung: der Raum des Menschen, begrenzt von einem Rahmen.

Doch die Kunst des Egos stirbt nicht im Rahmen; sie fließt in die Geschichte über. Die Galerie Berühmte Menschen zeigt das Ego und seine Eroberungen, die auf einer bemalten Leinwand in Ewigkeit widerhallen.

Die Persona existiert jedoch unabhängig von der Geschichte. Der lebende Mensch erzählt Geschichte durch seinen gesellschaftlichen Kontext, und die Gesellschaft ist ein Ringen um Ergebnisse, weder gerecht noch sicher, schmutzig im Wesen, romantisch im Blick. Einfache Leute ist die Galerie, die diesen Kontext sucht: wo und wann es geschieht, die Arbeit, die Form, der Schmerz, das Leben im Rahmen.

Geschichte ist kein Augenblick: Sie fließt über den Rahmen hinaus und färbt den Blick. Das Gesellschaftliche bestimmt sie nicht, es wird von ihr bestimmt. So hält die Galerie Geschichte die Zeit fest, ehrt und katalogisiert sie – und nicht umgekehrt.

Was passt in einen Rahmen? Die Zeit, die Gesellschaft, die Menschen, ihre Geschichten? Der Kontext der Dinge nennt den Grund der Geschichte und der Zeit. Die Dinge bestimmen den Menschen; darum erschafft und bewundert er sie. Die Galerie Objekte ist Kunstgeschichte als ursprüngliche Semiotik.

Die Persona ist nicht nur Ego und Geschichte; sie ist auch Bestimmung des Raums, und der Rahmen sagt, was man sieht. Die Galerie Natur ist das Bildnis des Unveränderlichen, des Unbestimmbaren: der unbezähmbaren Natur, die den Menschen bestimmt.

Die Natur ist unbezähmbar, doch die Orte, die die Persona prägen, sind der bedeutungsvolle Rahmen. Die Galerie Berühmte Orte bewahrt, was in sich selbst noch Bedeutung und Gewicht hat und über die eigene Geschichte hinaus in der Zeit fortbesteht.

Bedeutung ist nicht nur horizontal; sie lässt Bräuche, Leben und all das nachklingen, was mehr sagt, als wir auszudrücken vermögen. Auf diese Unvollständigkeit antwortet die Galerie Sakrale Kunst, die ebenso gut „Religiöse Kunst“ heißen könnte, denn sie sucht unsere Verbindung zum Unsagbaren. Und als allegorische Darstellung des Unsagbaren gibt es die Galerie Esoterik, in der der Mythos die Darstellung der Wirklichkeit selbst ist.

Das Unsagbare braucht einen Sinn und muss den Sinn des Lebens fortführen. Die Galerie Häusliches Leben vereint das Mystische und das Heilige in einem einzigen Rahmen. Die Familie ist nicht nur eine gesellschaftliche Inszenierung: Sie trägt, in Farbe, die mystischen, religiösen und philosophischen Bedeutungen jeder Zeit.

Der menschliche Körper ist Form, und die Form verlangt nach Darstellung. In der Galerie Weibliche Akte ist der Körper zeitlos, inspirierend und verschwörerisch, vor allem aber war er Zeugnis weiblicher Körper, geformt nach den Werten und Vorstellungen der jeweiligen Epoche.

Die Galerie Architektur versammelt Zeugnisse, akademische wie nichtakademische, von Bauten, die in der Geschichte oft als nebensächlich galten, aber Dokumente der Ingenieurskunst und der Kultur sind.

Die Galerie Perspektive handelt nicht eigentlich von Winkeln der Konstruktion, sondern von Winkeln der Formung: das Leben, gesehen von anderen Ursprüngen aus, die gerade Linie, die neue Wirklichkeiten formt. Die Persona ist nicht ihr eigenes Produkt, sondern das von Formen, die sich addieren und neue Wirklichkeiten schaffen.

Die Galerie Sonnenlicht erinnert uns daran, dass die Zeit ein Augenblick im Gedächtnis derer ist, die zu sehen wissen. Licht ist Augenblick; die Form ist dem Licht unterworfen. Jeder Augenblick ist eine erleuchtete Form, ein feinfühliges Zeugnis dessen, der weiß, dass die Zeit kurz ist. Man muss nur SEHEN!

Das Vergehen der Zeit hat seine Formen, doch die Formen können sich den Farben unterordnen. In der Galerie Farben sind es nicht die Farben, die Formen annehmen: Es sind die Formen, die Farben annehmen. Farben zu sehen ist die Moderne, das Zeugnis des Nach-Augenblicks, der Augenblick, der bleibt.

In der Galerie Emotion verbindet sich die Farbe mit dem Gefühl, und die Formen ordnen sich den Farben unter – wegen ihrer psychologischen und emotionalen Kraft. Sie ist der Ort der Abstraktion und der zeitgenössischen Kunst, die fortführt, was der Fauvismus begann, als er die Farbe von der Form befreite, und die sich nicht auf die Materialien beschränkt, aus denen Farbe gemacht ist.

Doch die Form ist auch Zwang. Der Zwang durchdringt den Geist, und der Geist kennt viele Arten, die Form zu sehen. Die Galerie Psyche zeigt, dass der Rahmen das Festgehaltene nicht fasst: Das Bild verliert sich im Imaginären, und eben das bewahrt der Geist. Die Kunst war immer ein Rätsel des Denkens über sich selbst und über die Wirklichkeit. Dalí ahnte den Spanischen Bürgerkrieg voraus in „Weiche Konstruktion mit gekochten Bohnen“, 1936.

Und die Galerie Künstlerinnen gibt den Rahmen jenen zurück, die jahrhundertelang öfter in ihm standen als vor ihm: Frauen, die ihre Zeit mit dem eigenen Blick malten.

ES LEBE der Augenblick, den wir noch wahrnehmen werden!`,
};

// Compara textos ignorando maiúsculas, acentos, pontuação, espaços e o título no começo.
function normalizar(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "").replace(/^nossomos/, "");
}

// Traduções que versões anteriores deste arquivo gravaram — podem ser trocadas pela atual.
// Uma tradução que André escreveu ou editou no painel nunca é sobrescrita.
function traducoesNossas(slug, L) {
  return [
    TRAD_PADRAO[slug]?.[L],
    TRAD_V1[slug]?.[`texto_${L}`],
    slug === "nos-somos" ? MANIFESTO[L] : null,
  ].filter(Boolean);
}

// Preenche títulos vazios e as traduções do texto que está no ar (padrão ou texto novo do
// Nós Somos). Roda no boot e depois de cada gravação no painel.
async function sincronizarTraducoes(pool) {
  const { rows } = await pool.query(`SELECT * FROM paginas`);
  let mudou = 0;
  for (const p of rows) {
    if (!PAGINAS_PADRAO[p.slug]) continue;
    let fonte = null;
    if (p.texto === PAGINAS_PADRAO[p.slug].texto) fonte = TRAD_PADRAO[p.slug];
    else if (p.slug === "nos-somos" && normalizar(p.texto) === normalizar(MANIFESTO.pt)) fonte = MANIFESTO;
    for (const L of OUTROS_IDIOMAS) {
      const sets = [], vals = [p.slug];
      if (!p[`titulo_${L}`] && TITULOS[p.slug]?.[L]) {
        vals.push(TITULOS[p.slug][L]); sets.push(`titulo_${L}=$${vals.length}`);
      }
      const novo = fonte?.[L];
      const atual = p[`texto_${L}`] || "";
      if (novo && atual !== novo && (!atual || traducoesNossas(p.slug, L).includes(atual))) {
        vals.push(novo); sets.push(`texto_${L}=$${vals.length}`);
      }
      if (sets.length) {
        await pool.query(`UPDATE paginas SET ${sets.join(", ")} WHERE slug=$1`, vals);
        mudou++;
      }
    }
  }
  return mudou;
}

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
      // Idiomas: EN, FR, ES, IT e DE ao lado do português
      for (const L of OUTROS_IDIOMAS)
        for (const col of [`titulo_${L}`, `texto_${L}`])
          await pool.query(`ALTER TABLE paginas ADD COLUMN IF NOT EXISTS ${col} TEXT NOT NULL DEFAULT ''`);
      // Nós Somos: publica uma única vez o texto de André nos 6 idiomas (pedido de 19/11/2026).
      // Depois disso vale o que ele editar no painel. O texto que estava antes fica guardado
      // em paginas_migracoes.anterior.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS paginas_migracoes (
          id          TEXT PRIMARY KEY,
          aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          anterior    TEXT
        )`);
      const feita = await pool.query(`SELECT 1 FROM paginas_migracoes WHERE id=$1`, ["nos-somos-texto-andre"]);
      if (!feita.rows.length) {
        const atual = await pool.query(`SELECT texto FROM paginas WHERE slug=$1`, ["nos-somos"]);
        const vals = ["nos-somos", MANIFESTO.pt], sets = ["texto=$2"];
        for (const L of OUTROS_IDIOMAS) { vals.push(MANIFESTO[L]); sets.push(`texto_${L}=$${vals.length}`); }
        await pool.query(`UPDATE paginas SET ${sets.join(", ")}, atualizada_em=NOW() WHERE slug=$1`, vals);
        await pool.query(`INSERT INTO paginas_migracoes (id, anterior) VALUES ($1,$2)`,
          ["nos-somos-texto-andre", atual.rows[0]?.texto || ""]);
        console.log("📰 Nós Somos — texto de André publicado nos 6 idiomas");
      }
      const n = await sincronizarTraducoes(pool);
      if (n) console.log(`📰 Páginas — ${n} tradução(ões) atualizada(s)`);
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
      const lang = OUTROS_IDIOMAS.includes(req.query.lang) ? req.query.lang : "pt";
      // Sem tradução gravada: inglês (idioma principal) e, por fim, o português
      const titulo = lang === "pt" ? p.titulo : (p[`titulo_${lang}`] || "");
      const texto  = lang === "pt" ? p.texto  : (p[`texto_${lang}`] || p.texto_en || p.texto);
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
      const { rows } = await pool.query(`SELECT * FROM paginas ORDER BY slug`);
      res.json({ paginas: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/paginas/salvar", async (req, res) => {
    if (!autorizado(req, res)) return;
    try {
      const b = req.body || {};
      const slug = b.slug;
      if (!PAGINAS_PADRAO[slug]) return res.status(400).json({ error: "página desconhecida" });
      const cols = ["titulo", "texto"], vals = [String(b.titulo || PAGINAS_PADRAO[slug].titulo), String(b.texto || "")];
      for (const L of OUTROS_IDIOMAS) {
        cols.push(`titulo_${L}`, `texto_${L}`);
        vals.push(String(b[`titulo_${L}`] || ""), String(b[`texto_${L}`] || ""));
      }
      await pool.query(`
        INSERT INTO paginas (slug, ${cols.join(", ")}, atualizada_em)
        VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, NOW())
        ON CONFLICT (slug) DO UPDATE SET ${cols.map(c => `${c}=EXCLUDED.${c}`).join(", ")}, atualizada_em=NOW()`,
        [slug, ...vals]);
      await sincronizarTraducoes(pool);
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

var IDIOMAS_PAG = [['', 'PORTUGUÊS — texto original'], ['en', 'ENGLISH — idioma principal do site'],
  ['fr', 'FRANÇAIS'], ['es', 'ESPAÑOL'], ['it', 'ITALIANO'], ['de', 'DEUTSCH']];
async function carregarPaginas(){
  mostrar('paginas'); g('paginas').innerHTML = '<p class="vazio">carregando…</p>';
  var d = await api('/api/paginas/painel');
  var ordem = ['nos-somos','direitos','loja','contatos'];
  var ps = (d.paginas||[]).sort(function(a,b){ return ordem.indexOf(a.slug)-ordem.indexOf(b.slug); });
  g('paginas').innerHTML =
    '<p style="font-size:12px;color:#666;margin:0 0 14px;line-height:1.5">Ao mudar o texto em português, os outros idiomas não mudam sozinhos — atualize-os aqui. ' +
    'Um idioma sem texto mostra o inglês ao visitante.</p>' +
    ps.map(function(p){
      var campos = IDIOMAS_PAG.map(function(par){
        var suf = par[0];
        var tit = suf ? p['titulo_'+suf] : p.titulo, txt = suf ? p['texto_'+suf] : p.texto;
        return '<details' + (suf === '' || suf === 'en' ? ' open' : '') +
          ' style="margin:10px 0 14px;padding-top:8px;border-top:1px dashed #ddd">' +
          '<summary style="font-size:11px;font-weight:700;cursor:pointer">' + par[1] +
          (txt ? '' : ' · <span style="color:#b00;font-weight:400">sem texto</span>') + '</summary>' +
          '<label>título</label><input id="pt'+suf+'_'+p.slug+'" value="'+e(tit||'')+'">' +
          '<label>texto (parágrafos separados por linha em branco)</label>' +
          '<textarea id="px'+suf+'_'+p.slug+'" style="min-height:'+(suf ? 140 : 200)+'px">'+e(txt||'')+'</textarea></details>';
      }).join('');
      return '<div class="box"><h3>/'+e(p.slug)+'</h3>' + campos +
        '<button class="b go" onclick="salvarPagina(\\''+p.slug+'\\')">salvar</button> '+
        '<a href="/'+p.slug+'" target="_blank" style="font-size:10px;margin-left:8px">ver ↗</a>'+
        '<span id="pm_'+p.slug+'" style="font-size:11px;color:#666;margin-left:8px"></span></div>';
    }).join('');
}
async function salvarPagina(slug){
  g('pm_'+slug).textContent = 'salvando…';
  var b = { slug: slug };
  IDIOMAS_PAG.forEach(function(par){
    var suf = par[0];
    b[suf ? 'titulo_'+suf : 'titulo'] = g('pt'+suf+'_'+slug).value;
    b[suf ? 'texto_'+suf : 'texto'] = g('px'+suf+'_'+slug).value;
  });
  var d = await api('/api/paginas/salvar', b);
  if (d.ok) { await carregarPaginas(); g('pm_'+slug).textContent = 'salvo ✓'; }
  else g('pm_'+slug).textContent = 'erro: '+(d.error||'');
}

carregar();
</script>
</body></html>`;
}

module.exports = { montarNoticias };
