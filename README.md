# Mini Card

Tessera **piccola** e **personalizzabile** per Home Assistant: un dispositivo o una stanza, un'icona curata a mano, i sensori che vuoi. Pensata per dashboard da telefono — parte piccola, ma icona e testo si ridimensionano da soli se la allarghi (drag nella scheda "Layout" dell'editor, o `grid_options` in YAML).

## Pacchetto icone

9 icone animate curate a mano (niente icone mdi piatte):

| Icona | Uso tipico |
|---|---|
| 🔌 Generica | presa, dispositivo qualsiasi |
| 🌡️ Clima | temperatura/umidità di una stanza |
| 🛋️ Soggiorno | TV, salotto |
| 🛏️ Camera da letto | luce/presa camera |
| 🫖 Cucina | bollitore, piccoli elettrodomestici |
| 🚿 Bagno | boiler, scaldabagno, luce bagno |
| 💡 Ufficio/studio | lampada da scrivania |
| 🪴 Giardino/esterno | irrigazione, luci esterne |
| 📷 Sicurezza | telecamera, allarme |

Ogni icona si accende/anima quando il dispositivo collegato è acceso (o quando il sensore di potenza supera la soglia impostata).

## Cosa si configura

- Nome
- Icona (una delle 9 sopra)
- Presa/interruttore/luce da accendere (opzionale — supporta `switch.`, `light.`, `input_boolean.`)
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
