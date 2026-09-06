# Mini Card

Tessera **piccola** e **personalizzabile** per Home Assistant: un dispositivo o una stanza, un'icona curata a mano, i sensori che vuoi. Pensata per dashboard da telefono — parte piccola, ma icona e testo si ridimensionano da soli se la allarghi (drag nella scheda "Layout" dell'editor, o `grid_options` in YAML).

## Pacchetto icone

14 icone animate curate a mano (niente icone mdi piatte, niente emoji — sono disegni SVG con gradienti e luci vere):

| Icona | Uso tipico |
|---|---|
| 🔌 Generica | presa, dispositivo qualsiasi |
| 🌡️ Clima | temperatura/umidità di una stanza |
| 🛋️ Soggiorno | TV, salotto |
| 🛏️ Camera da letto | luce/presa camera |
| 🫖 Cucina | bollitore, piccoli elettrodomestici |
| 🔥 Forno | forno da incasso |
| ❄️ Frigorifero | frigo con LED dispenser |
| 🚿 Bagno | boiler, scaldabagno, luce bagno |
| 💡 Ufficio/studio | lampada da scrivania |
| 🪴 Giardino/esterno | irrigazione, luci esterne |
| 📷 Sicurezza | telecamera, allarme |
| 🚧 Cancello | cancello/cancelletto motorizzato |
| 🌀 Ventilatore | ventilatore (le pale girano quando è acceso) |
| 🤖 Aspirapolvere | robot aspirapolvere |

Ogni icona si accende/anima quando il dispositivo collegato è acceso (o quando il sensore di potenza supera la soglia impostata). Scrivendo il nome del dispositivo (es. "Forno") l'icona giusta viene proposta da sola.

Nell'editor l'icona si sceglie da una **griglia con l'anteprima vera** di ogni disegno (non un menu a tendina con emoji), e i sensori si scelgono con un **campo di ricerca che filtra** mentre scrivi (utile con centinaia di sensori in HA).

## Cosa si configura

- Nome
- Icona (una delle 14 sopra, scelta dalla griglia con anteprima)
- Presa/interruttore/luce da accendere (opzionale — supporta `switch.`, `light.`, `input_boolean.`, cercabile)
- Sensore di potenza (opzionale — abilita anche lo storico consumi al tocco della card)
- Sensore di temperatura e umidità (opzionali)
- Soglie freddo/caldo (per il colore del termometro)
- Prezzo energia e giorni di storico

Nessun campo obbligatorio oltre al nome: puoi usarla come semplice etichetta decorativa, o collegarla a tutti i sensori che vuoi.

## Installazione (HACS)

1. HACS → Frontend → menu (⋮) → Repository personalizzate → aggiungi `https://github.com/cristianwebonline/ha-mini-card` come "Dashboard"
2. Installa "Mini Card"
3. Aggiungi una card, tipo `Custom: Mini Card`

## Sicurezza

Questa card **non ha nessun blocco**: la presa/luce collegata si accende e spegne sempre liberamente. Per frigorifero e congelatore (dove spegnere per sbaglio è un problema) usa invece [Centro Elettrodomestici Card](https://github.com/cristianwebonline/ha-centro-elettrodomestici-card), che ha quel blocco di sicurezza dedicato.
