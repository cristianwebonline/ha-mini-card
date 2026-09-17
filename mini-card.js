/*! Mini Card — tessera piccola e personalizzabile per dispositivi/ambienti
 *  (luce, presa, TV, clima di una stanza...). Pensata per dashboard da
 *  telefono: parte piccola, ma icona e testo si ridimensionano da soli in
 *  base a quanto la allarghi (drag nella scheda "Layout" dell'editor).
 *  Scegli icona, sensori (potenza/energia/temperatura/umidità) e presa/luce
 *  da accendere: il resto lo fa la card. Gira nel browser, nessun server.
 */
const MC_VERSION = "1.47.1";
console.info(`%c MINI-CARD %c v${MC_VERSION} `,
  "color:#0b1f2b;background:#4fd1c5;font-weight:700;border-radius:4px 0 0 4px",
  "color:#d6fbf7;background:#1a1b21;border-radius:0 4px 4px 0");

const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

// Lo stato che vuol dire "acceso", dominio per dominio.
const MC_MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

// Da "2026-08-20" alla mezzanotte di quel giorno, ora locale.
function MC_data(iso) {
  const p = String(iso).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

// LEGGERE UNA DATA SCRITTA A MANO. Riconosce "20 agosto", "il 20 di agosto",
// "20/08", "20-08-2025" e, dentro un intervallo, anche il solo "10" che prende
// mese e anno dall'altro estremo ("dal 10 al 20 agosto").
// Restituisce "AAAA-MM-GG", oppure null se non c'e nessuna data.
// Senza anno prende quello in corso, e se la data cadrebbe nel futuro prende
// l'anno prima: a settembre "20 dicembre" vuol dire il dicembre passato.
function MC_leggiData(testo, riferimento) {
  const t = " " + String(testo || "").toLowerCase() + " ";
  const oggi = new Date();
  let g = null, m = null, a = null;
  let x = t.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?\b/);
  if (x) {
    g = +x[1]; m = +x[2] - 1;
    if (x[3]) a = +x[3] < 100 ? 2000 + +x[3] : +x[3];
  } else {
    const nome = MC_MESI.findIndex(n => t.includes(n));
    const gx = t.match(/\b(\d{1,2})\b(?!\s*(?:kwh|w\b|%|ore|giorni))/);
    if (nome >= 0 && gx) { g = +gx[1]; m = nome; }
    else if (gx && riferimento) { g = +gx[1]; const r = riferimento.split("-"); a = +r[0]; m = +r[1] - 1; }
    else return null;
    const ax = t.match(/\b(20\d{2})\b/);
    if (ax) a = +ax[1];
  }
  if (!(g >= 1 && g <= 31) || !(m >= 0 && m <= 11)) return null;
  if (a == null) {
    a = oggi.getFullYear();
    if (new Date(a, m, g) > oggi) a--;
  }
  const d = new Date(a, m, g);
  if (d.getDate() !== g || d.getMonth() !== m) return null;   // 31 febbraio e simili
  return a + "-" + String(m + 1).padStart(2, "0") + "-" + String(g).padStart(2, "0");
}

const MC_STATI_ACCESI = {
  valve: ["open", "opening"],
  cover: ["open", "opening"],
  lock: ["unlocked", "open", "opening"],
  vacuum: ["cleaning", "returning"],
  media_player: ["playing", "on", "paused", "buffering"],
  fan: ["on"],
};

// LE FASI DI UN CICLO, LETTE DAI CONSUMI.
// Misurato sulla lavatrice vera: carico 5 min a 41 W, riscaldamento 12 min a
// 2140 W, lavaggio 24 min sui 60 W con spunti a 222 W, risciacqui 14 min,
// centrifuga 8 min a 245 W, scarico 2 min. Le fasce sotto vengono da li.
const MC_FASCIA_ALTA = 1200;   // resistenza che scalda
const MC_FASCIA_MEDIA = 150;   // motore sotto sforzo (cesto, centrifuga)
const MC_FASCIA_BASSA = 8;     // pompe, valvole, elettronica

// Per ogni tipo di apparecchio, come si chiamano le fasi.
// prima = fascia bassa prima del primo riscaldamento; dopo = la bassa subito
// dopo; poi = le basse successive; forte = la fascia media; ultimaForte = la
// fascia media finale; coda = la bassa breve in fondo.
const MC_FASI_NOMI = {
  lavatrice: { prima: "carico acqua", alta: "riscaldamento", dopo: "lavaggio", poi: "risciacquo",
    forte: "movimento cesto", ultimaForte: "centrifuga", coda: "scarico" },
  lavastoviglie: { prima: "carico acqua", alta: "riscaldamento", dopo: "lavaggio", poi: "risciacquo",
    forte: "pompa di lavaggio", ultimaForte: "pompa di lavaggio", coda: "scarico", ultimaBassa: "asciugatura" },
  asciugatrice: { prima: "avvio", alta: "riscaldamento", dopo: "asciugatura", poi: "asciugatura",
    forte: "tamburo", ultimaForte: "tamburo", coda: "raffreddamento" },
  forno: { prima: "avvio", alta: "riscaldamento", dopo: "mantiene la temperatura", poi: "mantiene la temperatura",
    forte: "riscaldamento", ultimaForte: "riscaldamento", coda: "raffreddamento" },
  generico: { prima: "avvio", alta: "riscaldamento", dopo: "lavoro", poi: "lavoro",
    forte: "motore", ultimaForte: "motore", coda: "fine" },
};

// QUANTO DOVREBBE CONSUMARE. Valori di targa dei modelli in commercio
// (kWh all'anno), presi dalle schede energetiche: servono solo a dire se un
// numero e nella norma, non sono la targa dell'apparecchio di casa.
//   Frigo combinato 60 cm con cassetti freezer: classe A 92-114, C 176, E 265.
//   Congelatore verticale ~190 L (60x60x120): classe D 180, E 210, F 246.
const MC_FREDDO = {
  frigo: { atteso: 265, alto: 400, nome: "un frigo combinato di classe E",
    scala: "classe A 92-114 · C 176 · E 265 kWh all'anno" },
  congelatore: { atteso: 246, alto: 330, nome: "un congelatore verticale da 190 litri di classe F",
    scala: "classe D 180 · E 210 · F 246 kWh all'anno" },
};

const MC_DEFAULTS = {
  name: "Dispositivo", icon_type: "generic", custom_icon_svg: "", custom_icon_id: "", icona: "auto",
  power: "",
  riferimento: "",          // kWh all'anno di targa (frigo/congelatore)
  tema: "auto",             // auto | chiaro | scuro
  pausa_max: "",            // minuti di calma che chiudono un'accensione
  freddo_tipo: "auto",      // auto | frigo | congelatore | no
  soglia_media: 35,         // % sopra la sua media che fa scattare l'avviso
  soglia_targa: 1.5,        // quante volte la targa prima di gridare energy: "", switch: "", temp: "", humidity: "", climate: "", device_id: "", path: "", group: "", mode: "device",
  soglia: 10, soglia_freddo: 18, soglia_caldo: 26, prezzo_kwh: 0.30, storico_giorni: 14,
  taglia: "normale",
  // Di serie chiede conferma prima di accendere o spegnere: il tocco sulla
  // pill sta a un dito da quello che apre la card, e sbagliare vuol dire
  // staccare davvero la corrente a un elettrodomestico.
  conferma_accensione: true,
  // L'orologio dentro la card: non tutte le prese ne hanno bisogno, quindi
  // di serie non c'e e si accende dalla Configura di quella card.
  mostra_timer: false,
};

// Un contatore per pagina, non per card: garantisce un suffisso diverso a
// ogni istanza anche se due card usano LO STESSO SVG incollato (altrimenti
// gli id dei gradienti si scontrerebbero e una card "ruberebbe" i colori
// all'altra — lo stesso bug già visto nelle card sorelle di questa famiglia).
let _mcCustomIconSeq = 0;

// Un'icona personalizzata (incollata dal "Creatore Icone") può portare i
// suoi <linearGradient>/<radialGradient> con id qualsiasi — rinominiamo id
// e riferimenti url(#...) con un suffisso unico per istanza, così l'icona
// resta sicura anche se compare più volte sulla stessa dashboard.
function mcNamespaceCustomSvg(svg) {
  const suffix = `_mci${(_mcCustomIconSeq++).toString(36)}`;
  const ids = new Set();
  svg.replace(/\bid="([^"]+)"/g, (_, id) => { ids.add(id); return ""; });
  let out = svg;
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`id="${safe}"`, "g"), `id="${id}${suffix}"`)
             .replace(new RegExp(`url\\(#${safe}\\)`, "g"), `url(#${id}${suffix})`);
  }
  return out;
}

// Etichette leggibili per il picker visivo nell'editor (niente emoji come
// "icona": qui sono solo la didascalia sotto l'anteprima disegnata vera).
const MC_ICON_LABELS = {
  generic: "Generica", climate: "Clima", livingroom: "Soggiorno", bedroom: "Camera",
  kitchen: "Cucina", oven: "Forno", fridge: "Frigorifero", bathroom: "Bagno",
  office: "Ufficio", garden: "Giardino", security: "Sicurezza", gate: "Cancello",
  fan: "Ventilatore", vacuum: "Aspirapolvere", washer: "Lavatrice", dryer: "Asciugatrice",
  dishwasher: "Lavastoviglie", tv: "TV", router: "Router", alarm: "Allarme",
};

// Suggerisce l'icona dal nome che l'utente sta scrivendo (es. "Forno" → 🔥
// forno, non genericamente "cucina"). Solo un suggerimento: se l'utente
// sceglie un'icona a mano, non viene più toccata (vedi _iconManuallySet
// nell'editor). L'ordine conta: il primo che matcha vince, quindi le parole
// più specifiche (forno, frigo, telecamera...) stanno prima di quelle più
// generiche che le contengono (es. "telecamera" contiene "camera").
const MC_ICON_KEYWORDS = [
  ["oven", ["forno"]],
  ["fridge", ["frigo", "frigorifero"]],
  ["washer", ["lavatrice"]],
  ["dryer", ["asciugatrice"]],
  ["dishwasher", ["lavastoviglie", "lavapiatti"]],
  ["kitchen", ["cucina", "bollitore", "microonde", "tostapane", "friggitrice", "piastra", "caffè", "caffe", "frullatore", "impastatrice", "spremi"]],
  ["bathroom", ["bagno", "doccia", "vasca", "boiler", "scaldabagno", "phon", "asciugacapelli"]],
  ["office", ["ufficio", "studio", "scrivania", "stampante", "monitor"]],
  ["garden", ["giardino", "esterno", "balcone", "irrigazione", "pergola", "terrazzo", "orto"]],
  ["gate", ["cancello", "cancelletto", "portone"]],
  ["fan", ["ventilatore", "ventola"]],
  ["vacuum", ["aspirapolvere", "robot"]],
  ["router", ["router", "modem", "internet", "wifi"]],
  ["alarm", ["allarme"]],
  ["security", ["telecamera", "sicurezza", "videocamera", "cam"]],
  ["tv", ["televisione", " tv", "tv "]],
  ["livingroom", ["soggiorno", "salotto", "divano"]],
  ["bedroom", ["camera", "letto", "comodino", "armadio"]],
  ["climate", ["clima", "termostato", "condizionatore", "climatizzatore", "temperatura"]],
];

// Suggerisce anche i SENSORI (non solo l'icona) cercando nel nome delle
// entità vere di Cristian le parole scritte nel campo Nome — es. scrivendo
// "Lavatrice" trova da solo switch.lavatrice_xxx e sensor.lavatrice_power
// se esistono, invece di lasciarli vuoti. Punteggio semplice: un punto per
// ogni parola del nome (>2 lettere) trovata nell'entity_id o friendly_name;
// vince l'entità col punteggio più alto (a parità, la prima trovata).
function mcSuggestEntities(name, hass) {
  const words = (name || "").toLowerCase().split(/[^a-zàèéìòù0-9]+/).filter(w => w.length > 2);
  if (!words.length || !hass) return {};
  const states = hass.states;
  const score = id => {
    const fn = ((states[id].attributes && states[id].attributes.friendly_name) || "").toLowerCase();
    const hay = fn + " " + id.toLowerCase();
    return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  const best = prefixes => {
    let bestId = null, bestScore = 0;
    for (const id of Object.keys(states)) {
      if (!prefixes.some(p => id.startsWith(p))) continue;
      const s = score(id);
      if (s > bestScore) { bestScore = s; bestId = id; }
    }
    return bestId;
  };
  return {
    switch: best(["switch.", "light.", "input_boolean."]),
    power: best(["sensor."]),
  };
}
function mcSuggestIcon(name) {
  // Stesso elenco usato per disegnare (vedi mcIconaIntelligente): prima gli
  // oggetti, poi le stanze. MC_ICON_KEYWORDS resta per chi lo usasse ancora.
  return mcTrovaParole(name, MC_PAROLE_OGGETTI) || mcTrovaParole(name, MC_PAROLE_STANZE);
}

// Elenca tutte le viste di tutte le dashboard (titolo + percorso vero) per il
// picker del campo "Collegamento" — invece di far scrivere a memoria un path
// tipo /dashboard-tablet/soggiorno-tablet, si cerca "soggiorno" come per
// qualunque altro campo. Una sola chiamata all'apertura dell'editor (non ad
// ogni carattere digitato): vedi il guard in MiniCardEditor.set hass().
async function mcLoadNavTargets(hass) {
  if (!hass || typeof hass.callWS !== "function") return [];
  const targets = [];
  let dashboards;
  try {
    dashboards = await hass.callWS({ type: "lovelace/dashboards/list" });
  } catch (e) { dashboards = []; }
  const all = [{ url_path: null, title: "Dashboard predefinita" }, ...(dashboards || [])];
  for (const d of all) {
    try {
      const cfg = await hass.callWS({ type: "lovelace/config", url_path: d.url_path || undefined });
      (cfg.views || []).forEach((v, i) => {
        const viewPath = v.path || String(i);
        const base = d.url_path || "lovelace";
        targets.push({ path: `/${base}/${viewPath}`, label: `${d.title || base} · ${v.title || viewPath}` });
        // Le pagine di un pannello Faber Home non sono viste di Lovelace: sono
        // pagine interne, e si raggiungono col cancelletto. Senza cercarle qui
        // non comparivano affatto fra le mete, ed era impossibile collegare
        // una card a una stanza.
        (v.cards || []).forEach(c => {
          if (!c || c.type !== "custom:faber-home") return;
          (c.pages || []).forEach(pg => {
            if (!pg || !pg.id) return;
            targets.push({
              path: `/${base}/${viewPath}#${pg.id}`,
              label: `${v.title || viewPath} \u00b7 ${pg.title || pg.id}`,
            });
          });
        });
      });
    } catch (e) { /* dashboard non leggibile (yaml/strategy) o non accessibile: salta */ }
  }
  return targets;
}

// ---- pacchetto icone: 14 disegni curati a mano (non mdi, non emoji) -------
// Funzioni indipendenti (non metodi di classe) così sia la card sia l'editor
// (per l'anteprima nel picker) possono richiamarle senza un'istanza.

function mcIconGeneric() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcPlugBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4150"/><stop offset=".5" stop-color="#2a3040"/><stop offset="1" stop-color="#1c212b"/></linearGradient>
      <linearGradient id="mcPlugFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5261"/><stop offset="1" stop-color="#333a46"/></linearGradient>
      <radialGradient id="mcLed" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#ffe29a"/><stop offset=".5" stop-color="#ffb020"/><stop offset="1" stop-color="#e6890a"/></radialGradient>
      <radialGradient id="mcPlugGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#ffb020" stop-opacity=".4"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadow3" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="30" ry="26" fill="url(#mcPlugGlow)"/>
    <ellipse cx="50" cy="88" rx="21" ry="4.5" fill="url(#mcShadow3)"/>
    <rect x="26" y="16" width="48" height="60" rx="16" fill="url(#mcPlugBody)" stroke="#0f1319" stroke-width="1.5"/>
    <rect x="30" y="19" width="40" height="8" rx="4" fill="#fff" opacity=".08"/>
    <rect x="32" y="22" width="36" height="38" rx="12" fill="url(#mcPlugFace)"/>
    <circle cx="42" cy="35" r="4" fill="#1c212b"/><circle cx="58" cy="35" r="4" fill="#1c212b"/>
    <rect x="45" y="46" width="10" height="12" rx="3" fill="#1c212b"/>
    <circle class="mc-bolt" cx="50" cy="67" r="9" fill="url(#mcLed)"/>
    <path class="mc-bolt" d="M52 61.5 L46.5 68.5 L49.5 68.5 L48 74.5 L54 66.8 L50.8 66.8 Z" fill="#7a4a00"/>
  </svg>`;
}

function mcIconClimate() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcThermStem" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2a3040"/><stop offset=".45" stop-color="#3a4150"/><stop offset="1" stop-color="#232833"/>
      </linearGradient>
      <linearGradient id="mcThermGlass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="mcMercuryComfy" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
      <linearGradient id="mcMercuryCold" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f8fd6"/><stop offset="1" stop-color="#7ecbff"/></linearGradient>
      <linearGradient id="mcMercuryHot" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e6432b"/><stop offset="1" stop-color="#ff8a63"/></linearGradient>
      <radialGradient id="mcBulbComfy" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffd166"/><stop offset=".55" stop-color="#ff8a3d"/><stop offset="1" stop-color="#e8662a"/></radialGradient>
      <radialGradient id="mcBulbCold" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#bfe4ff"/><stop offset=".55" stop-color="#4aa8e6"/><stop offset="1" stop-color="#2f7fc2"/></radialGradient>
      <radialGradient id="mcBulbHot" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffb199"/><stop offset=".55" stop-color="#ef4b30"/><stop offset="1" stop-color="#c1341e"/></radialGradient>
      <radialGradient id="mcThermGlow" cx="50%" cy="55%" r="52%"><stop offset="0" stop-color="#ff9a4d" stop-opacity=".28"/><stop offset="1" stop-color="#ff9a4d" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="50" cy="60" rx="34" ry="30" fill="url(#mcThermGlow)"/>
    <ellipse cx="50" cy="90" rx="19" ry="4.5" fill="url(#mcShadow)"/>
    <rect x="41" y="14" width="18" height="50" rx="9" fill="url(#mcThermStem)" stroke="#4a5261" stroke-width="1.4"/>
    <rect x="43" y="15" width="4" height="46" rx="2" fill="url(#mcThermGlass)"/>
    <circle cx="50" cy="72" r="17" fill="url(#mcThermStem)" stroke="#4a5261" stroke-width="1.4"/>
    <rect data-role="mercury" x="46.3" y="30" width="7.4" height="46" rx="3.7" fill="url(#mcMercuryComfy)"/>
    <circle data-role="bulb" cx="50" cy="72" r="11" fill="url(#mcBulbComfy)"/>
    <ellipse cx="45.5" cy="66.5" rx="3" ry="4.5" fill="#fff" opacity=".35"/>
    <g stroke="#5a6472" stroke-width="1.6" stroke-linecap="round">
      <line x1="61" y1="24" x2="65" y2="24"/><line x1="61" y1="32" x2="68" y2="32"/>
      <line x1="61" y1="40" x2="65" y2="40"/><line x1="61" y1="48" x2="68" y2="48"/><line x1="61" y1="56" x2="65" y2="56"/>
    </g>
  </svg>`;
}

function mcIconLivingroom() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcSofaBack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6472"/><stop offset=".5" stop-color="#454d5a"/><stop offset="1" stop-color="#343b46"/></linearGradient>
      <linearGradient id="mcSofaArm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5b6472"/><stop offset="1" stop-color="#3a4150"/></linearGradient>
      <linearGradient id="mcSofaCush" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#636c79"/><stop offset="1" stop-color="#454d5a"/></linearGradient>
      <linearGradient id="mcTvBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2e38"/><stop offset="1" stop-color="#12141a"/></linearGradient>
      <radialGradient id="mcScreen" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#8fd6ff"/><stop offset=".55" stop-color="#47b5ff"/><stop offset="1" stop-color="#1e7fd6"/></radialGradient>
      <radialGradient id="mcSofaGlow" cx="50%" cy="55%" r="52%"><stop offset="0" stop-color="#47b5ff" stop-opacity=".28"/><stop offset="1" stop-color="#47b5ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadow2" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="42" ry="30" fill="url(#mcSofaGlow)"/>
    <ellipse cx="50" cy="86" rx="35" ry="5" fill="url(#mcShadow2)"/>
    <rect x="30" y="12" width="40" height="27" rx="4" fill="url(#mcTvBody)" stroke="#050608" stroke-width="1.5"/>
    <rect class="mc-screen" x="33.5" y="15.5" width="33" height="20" rx="2" fill="url(#mcScreen)"/>
    <rect class="mc-screen" x="37" y="19" width="18" height="2.6" rx="1.3" fill="#fff" opacity=".55"/>
    <rect class="mc-screen" x="37" y="24" width="24" height="2.6" rx="1.3" fill="#fff" opacity=".35"/>
    <rect x="46" y="39" width="8" height="4" fill="#12141a"/>
    <rect x="38" y="42" width="24" height="3" rx="1.5" fill="#12141a"/>
    <path d="M16 58 a8 8 0 0 1 8 -8 h52 a8 8 0 0 1 8 8 v10 h-68 z" fill="url(#mcSofaBack)"/>
    <rect x="16" y="36" width="13" height="34" rx="6.5" fill="url(#mcSofaArm)"/>
    <rect x="71" y="36" width="13" height="34" rx="6.5" fill="url(#mcSofaArm)"/>
    <rect x="20" y="58" width="60" height="16" rx="7" fill="url(#mcSofaCush)"/>
    <line x1="40" y1="60" x2="40" y2="72" stroke="#343b46" stroke-width="1.3" opacity=".6"/>
    <line x1="60" y1="60" x2="60" y2="72" stroke="#343b46" stroke-width="1.3" opacity=".6"/>
    <rect x="20" y="70" width="60" height="7" rx="3.5" fill="#3a4150"/>
  </svg>`;
}

function mcIconBedroom() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcBedHead" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b5643"/><stop offset=".5" stop-color="#4a3b2e"/><stop offset="1" stop-color="#382c22"/></linearGradient>
      <linearGradient id="mcBedFrame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6472"/><stop offset="1" stop-color="#3a4150"/></linearGradient>
      <radialGradient id="mcPillow" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#eef1f5"/><stop offset="1" stop-color="#ccd3db"/></radialGradient>
      <linearGradient id="mcDuvet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc9f5"/><stop offset=".5" stop-color="#7dbcf5"/><stop offset="1" stop-color="#5a9de0"/></linearGradient>
      <radialGradient id="mcBedGlow" cx="50%" cy="55%" r="55%"><stop offset="0" stop-color="#ff8a3d" stop-opacity=".3"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadow4" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="58" rx="40" ry="28" fill="url(#mcBedGlow)"/>
    <ellipse cx="50" cy="86" rx="37" ry="5" fill="url(#mcShadow4)"/>
    <rect x="15" y="26" width="12" height="46" rx="4" fill="url(#mcBedHead)" stroke="#2b2119" stroke-width="1.3"/>
    <rect x="18" y="30" width="6" height="38" rx="2" fill="#000" opacity=".15"/>
    <rect x="20" y="46" width="62" height="24" rx="7" fill="url(#mcBedFrame)"/>
    <rect x="20" y="46" width="62" height="6" rx="3" fill="#fff" opacity=".12"/>
    <ellipse cx="34" cy="50" rx="13" ry="8.5" fill="url(#mcPillow)"/>
    <path d="M23 50 q11 -5 22 0" stroke="#c7cfd8" stroke-width="1.2" fill="none" opacity=".7"/>
    <rect x="46" y="52" width="34" height="18" rx="7" fill="url(#mcDuvet)"/>
    <path d="M50 58 q14 4 28 0" stroke="#4d7fb8" stroke-width="1.2" fill="none" opacity=".5"/>
    <path d="M50 64 q14 4 28 0" stroke="#4d7fb8" stroke-width="1.2" fill="none" opacity=".35"/>
    <rect x="24" y="70" width="4" height="8" rx="1.5" fill="#2f3542"/>
    <rect x="74" y="70" width="4" height="8" rx="1.5" fill="#2f3542"/>
  </svg>`;
}

function mcIconKitchen() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcKettleBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dfe4e9"/><stop offset=".45" stop-color="#f5f7f9"/><stop offset="1" stop-color="#c3cbd3"/></linearGradient>
      <linearGradient id="mcKettleBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5261"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
      <radialGradient id="mcKettleGlow" cx="50%" cy="55%" r="55%"><stop offset="0" stop-color="#ff9a4d" stop-opacity=".32"/><stop offset="1" stop-color="#ff9a4d" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowK" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="30" ry="26" fill="url(#mcKettleGlow)"/>
    <ellipse cx="50" cy="88" rx="24" ry="4.5" fill="url(#mcShadowK)"/>
    <path d="M32 40 Q32 22 50 22 Q68 22 68 40 L68 66 Q68 78 50 78 Q32 78 32 66 Z" fill="url(#mcKettleBody)" stroke="#8a94a1" stroke-width="1.2"/>
    <path d="M25 46 Q14 46 14 58 Q14 68 25 68" fill="none" stroke="#8a94a1" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M68 42 L82 34 L78 44 L68 50 Z" fill="url(#mcKettleBody)" stroke="#8a94a1" stroke-width="1.2"/>
    <ellipse cx="50" cy="23" rx="13" ry="5" fill="#c3cbd3" stroke="#8a94a1" stroke-width="1.2"/>
    <circle cx="50" cy="20" r="4" fill="#4a5261"/>
    <rect x="38" y="74" width="24" height="8" rx="3" fill="url(#mcKettleBase)"/>
    <g class="mc-steam" stroke="#cfe8ff" stroke-width="2.4" stroke-linecap="round" fill="none">
      <path d="M76 30 q4 -6 0 -12"/><path d="M84 32 q4 -6 0 -12"/>
    </g>
  </svg>`;
}

// Forno: sportello con oblò, manopole, bagliore interno quando è acceso.
function mcIconOven() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcOvenBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a94a1"/><stop offset=".5" stop-color="#dfe4e9"/><stop offset="1" stop-color="#5b6472"/></linearGradient>
      <linearGradient id="mcOvenDoor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3040"/><stop offset="1" stop-color="#0f1115"/></linearGradient>
      <radialGradient id="mcOvenHeat" cx="50%" cy="55%" r="65%"><stop offset="0" stop-color="#ffb27a"/><stop offset=".55" stop-color="#ff6a3d"/><stop offset="100%" stop-color="#c1341e" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcOvenGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#ff8a3d" stop-opacity=".35"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowOv" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcOvenGlow)"/>
    <ellipse cx="50" cy="90" rx="28" ry="4.5" fill="url(#mcShadowOv)"/>
    <rect x="18" y="14" width="64" height="72" rx="7" fill="url(#mcOvenBody)" stroke="#3a4150" stroke-width="1.5"/>
    <rect x="24" y="20" width="52" height="9" rx="2" fill="#12141a"/>
    <circle cx="31" cy="24.5" r="2.6" fill="#5b6472"/><circle cx="41" cy="24.5" r="2.6" fill="#5b6472"/>
    <rect x="24" y="34" width="52" height="46" rx="4" fill="url(#mcOvenDoor)" stroke="#050608" stroke-width="1.4"/>
    <rect x="29" y="39" width="42" height="36" rx="3" fill="#050608"/>
    <circle class="mc-heat" cx="50" cy="57" r="15" fill="url(#mcOvenHeat)"/>
    <rect x="24" y="78" width="12" height="4" rx="1.5" fill="#3a4150"/>
    <rect x="64" y="78" width="12" height="4" rx="1.5" fill="#3a4150"/>
  </svg>`;
}

// Frigorifero: due sportelli, LED del dispenser che si accende con la presa.
function mcIconFridge() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcFridgeBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c3cbd3"/><stop offset=".45" stop-color="#f5f7f9"/><stop offset="1" stop-color="#8a94a1"/></linearGradient>
      <radialGradient id="mcFridgeLed" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#cdeeff"/><stop offset=".5" stop-color="#7ecbff"/><stop offset="1" stop-color="#3f9fd9"/></radialGradient>
      <radialGradient id="mcFridgeGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#7ecbff" stop-opacity=".3"/><stop offset="1" stop-color="#7ecbff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowFr" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="28" ry="27" fill="url(#mcFridgeGlow)"/>
    <ellipse cx="50" cy="90" rx="24" ry="4.5" fill="url(#mcShadowFr)"/>
    <rect x="26" y="10" width="48" height="80" rx="8" fill="url(#mcFridgeBody)" stroke="#5b6472" stroke-width="1.4"/>
    <line x1="26" y1="38" x2="74" y2="38" stroke="#5b6472" stroke-width="1.4"/>
    <rect x="63" y="16" width="4" height="16" rx="2" fill="#3a4150"/>
    <rect x="63" y="45" width="4" height="30" rx="2" fill="#3a4150"/>
    <circle class="mc-bolt" cx="36" cy="50" r="3.4" fill="url(#mcFridgeLed)"/>
  </svg>`;
}

// Doccia: acqua che scende quando è acceso (boiler/scaldabagno/luce bagno).
function mcIconBathroom() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcShowerArm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a94a1"/><stop offset="1" stop-color="#5b6472"/></linearGradient>
      <radialGradient id="mcShowerHead" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f5f7f9"/><stop offset=".6" stop-color="#c3cbd3"/><stop offset="1" stop-color="#8a94a1"/></radialGradient>
      <linearGradient id="mcWaterDrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe4ff"/><stop offset="1" stop-color="#4aa8e6"/></linearGradient>
      <radialGradient id="mcShowerGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#4aa8e6" stop-opacity=".3"/><stop offset="1" stop-color="#4aa8e6" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowB" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="58" rx="30" ry="26" fill="url(#mcShowerGlow)"/>
    <ellipse cx="50" cy="90" rx="22" ry="4.5" fill="url(#mcShadowB)"/>
    <path d="M50 12 L50 30" stroke="url(#mcShowerArm)" stroke-width="5" stroke-linecap="round"/>
    <path d="M50 30 Q50 40 62 42" stroke="url(#mcShowerArm)" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="62" cy="46" rx="22" ry="10" fill="url(#mcShowerHead)" stroke="#5b6472" stroke-width="1.5" transform="rotate(10 62 46)"/>
    <g fill="#5b6472"><circle cx="50" cy="50" r="1.6"/><circle cx="58" cy="52" r="1.6"/><circle cx="66" cy="52" r="1.6"/><circle cx="74" cy="50" r="1.6"/><circle cx="54" cy="45" r="1.6"/><circle cx="70" cy="45" r="1.6"/></g>
    <g class="mc-water" stroke-linecap="round">
      <line x1="50" y1="56" x2="47" y2="72" stroke="url(#mcWaterDrop)" stroke-width="2.4"/>
      <line x1="58" y1="58" x2="56" y2="76" stroke="url(#mcWaterDrop)" stroke-width="2.4"/>
      <line x1="66" y1="58" x2="65" y2="76" stroke="url(#mcWaterDrop)" stroke-width="2.4"/>
      <line x1="74" y1="56" x2="74" y2="72" stroke="url(#mcWaterDrop)" stroke-width="2.4"/>
    </g>
  </svg>`;
}

// Lampada da scrivania: si accende con luce calda (studio/ufficio).
function mcIconOffice() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcLampArm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6472"/><stop offset="1" stop-color="#3a4150"/></linearGradient>
      <radialGradient id="mcLampShade" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#f5f7f9"/><stop offset=".6" stop-color="#c3cbd3"/><stop offset="1" stop-color="#8a94a1"/></radialGradient>
      <radialGradient id="mcLampBulb" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#fff6d8"/><stop offset=".55" stop-color="#ffd166"/><stop offset="1" stop-color="#e8a52a"/></radialGradient>
      <radialGradient id="mcLampGlow" cx="55%" cy="42%" r="60%"><stop offset="0" stop-color="#ffd166" stop-opacity=".4"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowO" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="mcLampBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5261"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
    </defs>
    <ellipse class="mc-glow" cx="55" cy="48" rx="30" ry="26" fill="url(#mcLampGlow)"/>
    <ellipse cx="50" cy="88" rx="26" ry="4.5" fill="url(#mcShadowO)"/>
    <rect x="30" y="78" width="30" height="8" rx="3" fill="url(#mcLampBase)"/>
    <path d="M40 78 L40 60" stroke="url(#mcLampArm)" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 60 L60 44" stroke="url(#mcLampArm)" stroke-width="5" stroke-linecap="round"/>
    <path d="M60 44 L70 40" stroke="url(#mcLampArm)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="40" cy="60" r="4" fill="#2a3040"/><circle cx="60" cy="44" r="4" fill="#2a3040"/>
    <path d="M68 26 L92 34 L80 48 L60 40 Z" fill="url(#mcLampShade)" stroke="#5b6472" stroke-width="1.2"/>
    <circle class="mc-bulb2" cx="76" cy="37" r="7" fill="url(#mcLampBulb)"/>
  </svg>`;
}

// Pianta in vaso: gocce d'acqua quando l'irrigazione/luce giardino è attiva.
function mcIconGarden() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcPotBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c98a5c"/><stop offset="1" stop-color="#8f5a37"/></linearGradient>
      <linearGradient id="mcLeaf1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd99a"/><stop offset="1" stop-color="#4a9a5a"/></linearGradient>
      <linearGradient id="mcLeaf2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fc47f"/><stop offset="1" stop-color="#347c44"/></linearGradient>
      <radialGradient id="mcGardenGlow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#8fd99a" stop-opacity=".3"/><stop offset="1" stop-color="#8fd99a" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowG" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="mcDrop2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe4ff"/><stop offset="1" stop-color="#4aa8e6"/></linearGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcGardenGlow)"/>
    <ellipse cx="50" cy="88" rx="26" ry="4.5" fill="url(#mcShadowG)"/>
    <path d="M50 62 Q30 60 26 34 Q46 34 50 56 Z" fill="url(#mcLeaf1)"/>
    <path d="M50 62 Q70 58 76 32 Q54 34 50 56 Z" fill="url(#mcLeaf2)"/>
    <path d="M50 62 Q46 44 50 24 Q56 44 50 62 Z" fill="url(#mcLeaf1)"/>
    <path d="M38 66 L62 66 L58 86 L42 86 Z" fill="url(#mcPotBody)" stroke="#6b3f24" stroke-width="1.2"/>
    <rect x="35" y="62" width="30" height="7" rx="2.5" fill="#a86a41" stroke="#6b3f24" stroke-width="1"/>
    <line class="mc-water" x1="20" y1="30" x2="18" y2="42" stroke="url(#mcDrop2)" stroke-width="2.4" stroke-linecap="round"/>
    <line class="mc-water" x1="82" y1="26" x2="80" y2="38" stroke="url(#mcDrop2)" stroke-width="2.4" stroke-linecap="round" style="animation-delay:.4s"/>
  </svg>`;
}

// Telecamera a cupola: LED rosso acceso quando la sicurezza è attiva.
function mcIconSecurity() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcCamBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6472"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
      <radialGradient id="mcCamLens" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#4a5261"/><stop offset=".6" stop-color="#1c212b"/><stop offset="1" stop-color="#050608"/></radialGradient>
      <radialGradient id="mcCamLed" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ff9a92"/><stop offset=".5" stop-color="#e6432b"/><stop offset="1" stop-color="#a32412"/></radialGradient>
      <radialGradient id="mcCamGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#e6432b" stop-opacity=".3"/><stop offset="1" stop-color="#e6432b" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowS" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="30" ry="26" fill="url(#mcCamGlow)"/>
    <ellipse cx="50" cy="88" rx="24" ry="4.5" fill="url(#mcShadowS)"/>
    <path d="M28 44 Q28 24 50 24 Q72 24 72 44 Z" fill="url(#mcCamBody)" stroke="#1c212b" stroke-width="1.4"/>
    <ellipse cx="50" cy="44" rx="24" ry="8" fill="#1c212b"/>
    <circle cx="50" cy="44" r="15" fill="url(#mcCamLens)" stroke="#050608" stroke-width="1.4"/>
    <circle cx="45" cy="40" r="4" fill="#fff" opacity=".25"/>
    <circle class="mc-bolt" cx="66" cy="30" r="5" fill="url(#mcCamLed)"/>
    <rect x="40" y="14" width="20" height="6" rx="3" fill="#1c212b"/>
  </svg>`;
}

// Cancello: LED del motore/sensore acceso quando è attivo.
function mcIconGate() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcGateBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a94a1"/><stop offset="1" stop-color="#4a5261"/></linearGradient>
      <radialGradient id="mcGateLed" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#ffe29a"/><stop offset=".5" stop-color="#ffb020"/><stop offset="1" stop-color="#e6890a"/></radialGradient>
      <radialGradient id="mcGateGlow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#ffb020" stop-opacity=".3"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowGt" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcGateGlow)"/>
    <ellipse cx="50" cy="88" rx="30" ry="4.5" fill="url(#mcShadowGt)"/>
    <rect x="14" y="30" width="6" height="52" rx="2" fill="url(#mcGateBar)"/>
    <rect x="80" y="30" width="6" height="52" rx="2" fill="url(#mcGateBar)"/>
    <rect x="20" y="34" width="60" height="6" rx="2" fill="url(#mcGateBar)"/>
    <rect x="20" y="76" width="60" height="6" rx="2" fill="url(#mcGateBar)"/>
    <g stroke="url(#mcGateBar)" stroke-width="4.5" stroke-linecap="round">
      <line x1="28" y1="40" x2="28" y2="76"/><line x1="38" y1="40" x2="38" y2="76"/>
      <line x1="48" y1="40" x2="48" y2="76"/><line x1="62" y1="40" x2="62" y2="76"/>
      <line x1="72" y1="40" x2="72" y2="76"/>
    </g>
    <circle class="mc-bolt" cx="50" cy="58" r="5" fill="url(#mcGateLed)"/>
  </svg>`;
}

// Ventilatore: le pale girano quando è acceso.
function mcIconFan() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcFanBlade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3cbd3"/><stop offset="1" stop-color="#8a94a1"/></linearGradient>
      <radialGradient id="mcFanGlow" cx="50%" cy="42%" r="55%"><stop offset="0" stop-color="#8fd6ff" stop-opacity=".3"/><stop offset="1" stop-color="#8fd6ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowFn" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="44" rx="30" ry="27" fill="url(#mcFanGlow)"/>
    <ellipse cx="50" cy="88" rx="20" ry="4.5" fill="url(#mcShadowFn)"/>
    <rect x="46" y="66" width="8" height="18" rx="3" fill="#5b6472"/>
    <rect x="34" y="84" width="32" height="6" rx="3" fill="#3a4150"/>
    <circle cx="50" cy="44" r="34" fill="none" stroke="#8a94a1" stroke-width="3"/>
    <g class="mc-fan-blades" style="transform-origin:50px 44px">
      <path d="M50 44 Q50 16 66 14 Q70 32 50 44 Z" fill="url(#mcFanBlade)"/>
      <path d="M50 44 Q78 44 82 60 Q64 66 50 44 Z" fill="url(#mcFanBlade)"/>
      <path d="M50 44 Q40 70 24 70 Q24 52 50 44 Z" fill="url(#mcFanBlade)"/>
      <path d="M50 44 Q22 36 22 20 Q40 22 50 44 Z" fill="url(#mcFanBlade)"/>
      <circle cx="50" cy="44" r="7" fill="#5b6472"/>
    </g>
  </svg>`;
}

// Aspirapolvere robot: vista dall'alto, LED che si accende in funzione.
function mcIconVacuum() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="mcVacBody" cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="#5b6472"/><stop offset=".6" stop-color="#2a3040"/><stop offset="1" stop-color="#12141a"/></radialGradient>
      <radialGradient id="mcVacGlow" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#47b5ff" stop-opacity=".3"/><stop offset="1" stop-color="#47b5ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowVa" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="34" ry="30" fill="url(#mcVacGlow)"/>
    <ellipse cx="50" cy="82" rx="32" ry="6" fill="url(#mcShadowVa)"/>
    <circle cx="50" cy="52" r="36" fill="url(#mcVacBody)" stroke="#050608" stroke-width="1.4"/>
    <circle cx="50" cy="52" r="30" fill="none" stroke="#050608" stroke-width="1" opacity=".5"/>
    <circle class="mc-bolt" cx="50" cy="46" r="6" fill="#8fd6ff"/>
    <rect x="34" y="66" width="32" height="5" rx="2.5" fill="#050608" opacity=".6"/>
  </svg>`;
}

// Lavatrice: oblò che gira quando è in funzione (riusa l'animazione delle
// pale del ventilatore: stesso effetto di rotazione).
function mcIconWasher() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcWashBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c3cbd3"/><stop offset=".5" stop-color="#f5f7f9"/><stop offset="1" stop-color="#8a94a1"/></linearGradient>
      <radialGradient id="mcWashDoor" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#4a5261"/><stop offset=".6" stop-color="#1c212b"/><stop offset="1" stop-color="#050608"/></radialGradient>
      <radialGradient id="mcWashGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#47b5ff" stop-opacity=".3"/><stop offset="1" stop-color="#47b5ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowW" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcWashGlow)"/>
    <ellipse cx="50" cy="90" rx="28" ry="4.5" fill="url(#mcShadowW)"/>
    <rect x="18" y="14" width="64" height="72" rx="7" fill="url(#mcWashBody)" stroke="#5b6472" stroke-width="1.5"/>
    <rect x="24" y="19" width="52" height="8" rx="2" fill="#5b6472" opacity=".5"/>
    <circle cx="50" cy="55" r="24" fill="url(#mcWashDoor)" stroke="#050608" stroke-width="2"/>
    <circle cx="50" cy="55" r="18" fill="none" stroke="#3a4150" stroke-width="1.4"/>
    <g class="mc-fan-blades" style="transform-origin:50px 55px">
      <path d="M50 55 Q56 40 46 38 Q40 48 50 55 Z" fill="#5b6472" opacity=".8"/>
      <path d="M50 55 Q66 58 62 68 Q50 66 50 55 Z" fill="#5b6472" opacity=".6"/>
    </g>
  </svg>`;
}

// Asciugatrice: stesso corpo della lavatrice, vapore caldo invece del cestello che gira.
function mcIconDryer() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcDryBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c3cbd3"/><stop offset=".5" stop-color="#f5f7f9"/><stop offset="1" stop-color="#8a94a1"/></linearGradient>
      <radialGradient id="mcDryDoor" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#4a5261"/><stop offset=".6" stop-color="#1c212b"/><stop offset="1" stop-color="#050608"/></radialGradient>
      <radialGradient id="mcDryGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#ff9a4d" stop-opacity=".3"/><stop offset="1" stop-color="#ff9a4d" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowDr" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcDryGlow)"/>
    <ellipse cx="50" cy="90" rx="28" ry="4.5" fill="url(#mcShadowDr)"/>
    <rect x="18" y="14" width="64" height="72" rx="7" fill="url(#mcDryBody)" stroke="#5b6472" stroke-width="1.5"/>
    <rect x="24" y="19" width="52" height="8" rx="2" fill="#5b6472" opacity=".5"/>
    <circle cx="50" cy="55" r="24" fill="url(#mcDryDoor)" stroke="#050608" stroke-width="2"/>
    <circle cx="50" cy="55" r="18" fill="none" stroke="#3a4150" stroke-width="1.4"/>
    <g class="mc-steam" stroke="#ffceac" stroke-width="2.4" stroke-linecap="round" fill="none">
      <path d="M42 30 q4 -6 0 -12"/><path d="M58 30 q4 -6 0 -12"/>
    </g>
  </svg>`;
}

// Lavastoviglie: pannello comandi con LED, oblò a vista chiusa.
function mcIconDishwasher() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcDishBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c3cbd3"/><stop offset=".5" stop-color="#f5f7f9"/><stop offset="1" stop-color="#8a94a1"/></linearGradient>
      <radialGradient id="mcDishLed" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#bfe4ff"/><stop offset=".5" stop-color="#47b5ff"/><stop offset="1" stop-color="#1e7fd6"/></radialGradient>
      <radialGradient id="mcDishGlow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#47b5ff" stop-opacity=".3"/><stop offset="1" stop-color="#47b5ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowDi" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="32" ry="27" fill="url(#mcDishGlow)"/>
    <ellipse cx="50" cy="90" rx="28" ry="4.5" fill="url(#mcShadowDi)"/>
    <rect x="18" y="14" width="64" height="72" rx="7" fill="url(#mcDishBody)" stroke="#5b6472" stroke-width="1.5"/>
    <rect x="24" y="22" width="52" height="10" rx="2" fill="#1c212b"/>
    <circle class="mc-bolt" cx="66" cy="27" r="3" fill="url(#mcDishLed)"/>
    <rect x="24" y="40" width="52" height="38" rx="3" fill="#dfe4e9" stroke="#8a94a1" stroke-width="1"/>
    <line x1="24" y1="58" x2="76" y2="58" stroke="#8a94a1" stroke-width="1"/>
  </svg>`;
}

// TV a schermo piatto: icona dedicata (diversa da "Soggiorno", che è il
// divano davanti alla TV) per una TV/monitor da camera o ufficio.
function mcIconTv() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcTv2Body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2e38"/><stop offset="1" stop-color="#12141a"/></linearGradient>
      <radialGradient id="mcTv2Screen" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#8fd6ff"/><stop offset=".55" stop-color="#47b5ff"/><stop offset="1" stop-color="#1e7fd6"/></radialGradient>
      <radialGradient id="mcTv2Glow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#47b5ff" stop-opacity=".3"/><stop offset="1" stop-color="#47b5ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowTv" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="42" rx="36" ry="24" fill="url(#mcTv2Glow)"/>
    <ellipse cx="50" cy="86" rx="26" ry="4.5" fill="url(#mcShadowTv)"/>
    <rect x="14" y="16" width="72" height="48" rx="4" fill="url(#mcTv2Body)" stroke="#050608" stroke-width="1.5"/>
    <rect class="mc-screen" x="18" y="20" width="64" height="40" rx="2" fill="url(#mcTv2Screen)"/>
    <rect class="mc-screen" x="24" y="26" width="30" height="4" rx="2" fill="#fff" opacity=".5"/>
    <rect x="44" y="64" width="12" height="10" fill="#12141a"/>
    <rect x="30" y="74" width="40" height="5" rx="2.5" fill="#3a4150"/>
  </svg>`;
}

// Router/modem: LED che lampeggiano quando è collegato/attivo.
function mcIconRouter() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcRouterBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5261"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
      <radialGradient id="mcShadowRt" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="50" cy="78" rx="30" ry="5" fill="url(#mcShadowRt)"/>
    <line x1="30" y1="46" x2="20" y2="18" stroke="#8a94a1" stroke-width="3" stroke-linecap="round"/>
    <line x1="70" y1="46" x2="80" y2="18" stroke="#8a94a1" stroke-width="3" stroke-linecap="round"/>
    <rect x="18" y="46" width="64" height="26" rx="6" fill="url(#mcRouterBody)" stroke="#050608" stroke-width="1.4"/>
    <circle class="mc-bolt-green" cx="30" cy="59" r="3" fill="#8ff0b4"/>
    <circle class="mc-bolt-green" cx="42" cy="59" r="3" fill="#8ff0b4" style="animation-delay:.3s"/>
    <circle class="mc-bolt-green" cx="54" cy="59" r="3" fill="#8ff0b4" style="animation-delay:.6s"/>
  </svg>`;
}

// Allarme: scudo con segno di spunta, si accende di rosso quando attivo.
function mcIconAlarm() {
  return `
  <svg viewBox="0 0 100 100" class="mc-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mcShieldBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6472"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
      <radialGradient id="mcAlarmLed" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#ff9a92"/><stop offset=".5" stop-color="#e6432b"/><stop offset="1" stop-color="#a32412"/></radialGradient>
      <radialGradient id="mcAlarmGlow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#e6432b" stop-opacity=".32"/><stop offset="1" stop-color="#e6432b" stop-opacity="0"/></radialGradient>
      <radialGradient id="mcShadowAl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse class="mc-glow" cx="50" cy="55" rx="30" ry="26" fill="url(#mcAlarmGlow)"/>
    <ellipse cx="50" cy="90" rx="22" ry="4.5" fill="url(#mcShadowAl)"/>
    <path d="M50 14 L80 26 V52 Q80 76 50 88 Q20 76 20 52 V26 Z" fill="url(#mcShieldBody)" stroke="#050608" stroke-width="1.6"/>
    <path d="M50 20 L74 30 V52 Q74 71 50 81 Q26 71 26 52 V30 Z" fill="none" stroke="#8a94a1" stroke-width="1.2" opacity=".5"/>
    <circle class="mc-bolt" cx="50" cy="52" r="10" fill="url(#mcAlarmLed)"/>
    <path d="M46 52 L49 56 L56 47" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
  </svg>`;
}

const MC_ICON_RENDER = {
  generic: mcIconGeneric, climate: mcIconClimate, livingroom: mcIconLivingroom, bedroom: mcIconBedroom,
  kitchen: mcIconKitchen, oven: mcIconOven, fridge: mcIconFridge, bathroom: mcIconBathroom,
  office: mcIconOffice, garden: mcIconGarden, security: mcIconSecurity, gate: mcIconGate,
  fan: mcIconFan, vacuum: mcIconVacuum, washer: mcIconWasher, dryer: mcIconDryer,
  dishwasher: mcIconDishwasher, tv: mcIconTv, router: mcIconRouter, alarm: mcIconAlarm,
};
function mcIconFor(type) { return (MC_ICON_RENDER[type] || mcIconGeneric)(); }

// =========================================================================
// ICONE DI OGGETTI (1.34.0)
// Il pacchetto era fatto di STANZE (cucina, bagno, ufficio): per un oggetto
// preciso — una presa, la stampante 3D, la macchina del caffe — l'icona della
// stanza non diceva niente, e in giardino ogni presa aveva il vaso. Queste
// sono disegnate nello stesso stile (corpo scuro, ombra, luci con le stesse
// classi animate) e passano da mcNamespaceCustomSvg: i loro gradienti hanno
// id brevi uguali fra icone diverse e senza suffisso si ruberebbero i colori.
// =========================================================================
const MC_SVG_OGGETTI = {"presa": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"bi\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fbfcfd\"/><stop offset=\"1\" stop-color=\"#d9dde3\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#8ff0b4\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#8ff0b4\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"50\" rx=\"42\" ry=\"42\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"88\" rx=\"28\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"20\" y=\"16\" width=\"60\" height=\"68\" rx=\"16\" fill=\"url(#bi)\" stroke=\"#050608\" stroke-width=\"1.5\"/><circle cx=\"50\" cy=\"50\" r=\"21\" fill=\"#eef0f3\" stroke=\"#8a94a1\" stroke-width=\"1.4\"/><rect x=\"47.5\" y=\"29\" width=\"5\" height=\"6\" rx=\"1.2\" fill=\"#8a94a1\"/><rect x=\"47.5\" y=\"65\" width=\"5\" height=\"6\" rx=\"1.2\" fill=\"#8a94a1\"/><circle cx=\"41\" cy=\"50\" r=\"3.6\" fill=\"#1b1f28\"/><circle cx=\"59\" cy=\"50\" r=\"3.6\" fill=\"#1b1f28\"/><circle class=\"mc-bolt-green\" cx=\"66\" cy=\"26\" r=\"2.6\" fill=\"#38e08a\"/></svg>", "ciabatta": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#8ff0b4\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#8ff0b4\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"76\" rx=\"40\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"12\" y=\"44\" width=\"76\" height=\"24\" rx=\"9\" fill=\"#e8ebef\" stroke=\"#050608\" stroke-width=\"1.4\"/><g transform=\"translate(26 56)\"><circle r=\"7\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1\"/><circle cx=\"-2.4\" r=\"1.2\" fill=\"#8a94a1\"/><circle cx=\"2.4\" r=\"1.2\" fill=\"#8a94a1\"/></g><g transform=\"translate(44 56)\"><circle r=\"7\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1\"/><circle cx=\"-2.4\" r=\"1.2\" fill=\"#8a94a1\"/><circle cx=\"2.4\" r=\"1.2\" fill=\"#8a94a1\"/></g><g transform=\"translate(62 56)\"><circle r=\"7\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1\"/><circle cx=\"-2.4\" r=\"1.2\" fill=\"#8a94a1\"/><circle cx=\"2.4\" r=\"1.2\" fill=\"#8a94a1\"/></g><rect x=\"75\" y=\"50\" width=\"8\" height=\"12\" rx=\"3\" fill=\"#ff6a6a\" stroke=\"#050608\" stroke-width=\"1\"/><circle class=\"mc-bolt-green\" cx=\"79\" cy=\"53\" r=\"1.8\" fill=\"#8ff0b4\"/><path d=\"M12 56 q-8 0 -8 14 q0 12 10 14\" stroke=\"#3a4150\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/></svg>", "lampadina": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffd166\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ffd166\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"40\" rx=\"38\" ry=\"38\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"88\" rx=\"16\" ry=\"4\" fill=\"url(#om)\"/><path class=\"mc-bulb2\" d=\"M50 12 Q72 12 72 36 Q72 50 60 58 V66 H40 V58 Q28 50 28 36 Q28 12 50 12 Z\" fill=\"#fff4cf\" stroke=\"#050608\" stroke-width=\"1.5\"/><path d=\"M44 48 L47 38 L50 46 L53 38 L56 48\" stroke=\"#c89a2b\" stroke-width=\"1.6\" fill=\"none\"/><rect x=\"40\" y=\"66\" width=\"20\" height=\"12\" rx=\"2\" fill=\"#8a94a1\" stroke=\"#050608\" stroke-width=\"1.2\"/><path d=\"M40 70 H60 M40 74 H60\" stroke=\"#050608\" stroke-width=\"1\"/></svg>", "led": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffd166\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ffd166\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"56\" rx=\"46\" ry=\"26\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"80\" rx=\"40\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"8\" y=\"50\" width=\"84\" height=\"14\" rx=\"7\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.4\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:0.0s\" cx=\"16\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:0.2s\" cx=\"27\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:0.4s\" cx=\"38\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:0.6s\" cx=\"49\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:0.8s\" cx=\"60\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:1.0s\" cx=\"71\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><circle class=\"mc-bolt-green\" style=\"animation-delay:1.2s\" cx=\"82\" cy=\"57\" r=\"3\" fill=\"#ffd166\"/><path d=\"M26 40 q24 -18 48 0\" stroke=\"#8a94a1\" stroke-width=\"1.6\" fill=\"none\" stroke-dasharray=\"3 4\" opacity=\".6\"/></svg>", "luci_esterne": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffd166\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#ffd166\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"52\" rx=\"46\" ry=\"30\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"86\" rx=\"36\" ry=\"4.5\" fill=\"url(#om)\"/><path d=\"M6 30 Q50 72 94 30\" stroke=\"#4a5261\" stroke-width=\"2.4\" fill=\"none\"/><line x1=\"14\" y1=\"34\" x2=\"14\" y2=\"39\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:0.00s\" cx=\"14\" cy=\"44\" rx=\"4.2\" ry=\"5.5\" fill=\"#ffd166\"/><line x1=\"26\" y1=\"44\" x2=\"26\" y2=\"49\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:0.25s\" cx=\"26\" cy=\"54\" rx=\"4.2\" ry=\"5.5\" fill=\"#ff7a7a\"/><line x1=\"38\" y1=\"50\" x2=\"38\" y2=\"55\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:0.50s\" cx=\"38\" cy=\"60\" rx=\"4.2\" ry=\"5.5\" fill=\"#7ab8ff\"/><line x1=\"50\" y1=\"52\" x2=\"50\" y2=\"57\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:0.75s\" cx=\"50\" cy=\"62\" rx=\"4.2\" ry=\"5.5\" fill=\"#8ff0b4\"/><line x1=\"62\" y1=\"50\" x2=\"62\" y2=\"55\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:1.00s\" cx=\"62\" cy=\"60\" rx=\"4.2\" ry=\"5.5\" fill=\"#ffd166\"/><line x1=\"74\" y1=\"44\" x2=\"74\" y2=\"49\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:1.25s\" cx=\"74\" cy=\"54\" rx=\"4.2\" ry=\"5.5\" fill=\"#e7a1ff\"/><line x1=\"86\" y1=\"34\" x2=\"86\" y2=\"39\" stroke=\"#3a4150\" stroke-width=\"2\"/><ellipse class=\"mc-bolt-green\" style=\"animation-delay:1.50s\" cx=\"86\" cy=\"44\" rx=\"4.2\" ry=\"5.5\" fill=\"#ff7a7a\"/><rect x=\"10\" y=\"74\" width=\"80\" height=\"6\" rx=\"3\" fill=\"#2a3040\" stroke=\"#050608\" stroke-width=\"1\"/></svg>", "stampante3d": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#39c6ff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#39c6ff\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"88\" rx=\"36\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"16\" y=\"14\" width=\"68\" height=\"72\" rx=\"6\" fill=\"none\" stroke=\"#4a5261\" stroke-width=\"4\"/><rect x=\"16\" y=\"76\" width=\"68\" height=\"10\" rx=\"3\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.2\"/><rect x=\"30\" y=\"64\" width=\"40\" height=\"6\" rx=\"1.5\" fill=\"#6b7482\"/><path d=\"M42 64 L46 52 H54 L58 64 Z\" fill=\"#ffb020\" opacity=\".9\"/><rect x=\"18\" y=\"30\" width=\"64\" height=\"5\" rx=\"2\" fill=\"#8a94a1\"/><g class=\"mc-corpo3d\"><rect x=\"44\" y=\"34\" width=\"12\" height=\"10\" rx=\"2\" fill=\"#2a3040\" stroke=\"#050608\" stroke-width=\"1\"/><path d=\"M50 44 V50\" stroke=\"#ff6a3d\" stroke-width=\"2\"/><circle class=\"mc-bolt-green\" cx=\"50\" cy=\"51\" r=\"1.8\" fill=\"#ff6a3d\"/></g><rect class=\"mc-screen\" x=\"66\" y=\"78\" width=\"12\" height=\"6\" rx=\"1\" fill=\"#39c6ff\"/></svg>", "caffe": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffb020\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ffb020\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"88\" rx=\"30\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"24\" y=\"12\" width=\"52\" height=\"16\" rx=\"5\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.4\"/><rect x=\"24\" y=\"26\" width=\"14\" height=\"58\" rx=\"3\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.4\"/><rect x=\"24\" y=\"78\" width=\"52\" height=\"8\" rx=\"3\" fill=\"#3a4150\" stroke=\"#050608\" stroke-width=\"1.2\"/><rect x=\"48\" y=\"28\" width=\"12\" height=\"7\" rx=\"2\" fill=\"#6b7482\"/><path d=\"M46 56 H62 V70 Q62 76 54 76 Q46 76 46 70 Z\" fill=\"#f6f7f9\" stroke=\"#050608\" stroke-width=\"1.2\"/><path d=\"M62 60 q6 0 6 5 q0 5 -6 5\" stroke=\"#f6f7f9\" stroke-width=\"2.4\" fill=\"none\"/><g class=\"mc-steam\" stroke=\"#c89a6a\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"><path d=\"M51 52 q-3 -5 0 -10\"/><path d=\"M57 52 q-3 -5 0 -10\"/></g><circle class=\"mc-bolt-green\" cx=\"68\" cy=\"20\" r=\"2\" fill=\"#8ff0b4\"/></svg>", "echo": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#39c6ff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#39c6ff\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"46\" rx=\"42\" ry=\"26\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"80\" rx=\"31\" ry=\"5\" fill=\"url(#om)\"/><path d=\"M18 46 V62 Q18 75 50 75 Q82 75 82 62 V46\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><ellipse cx=\"50\" cy=\"46\" rx=\"32\" ry=\"12\" fill=\"#5b6472\" stroke=\"#050608\" stroke-width=\"1.5\"/><ellipse class=\"mc-glow\" cx=\"50\" cy=\"46\" rx=\"29\" ry=\"10\" fill=\"none\" stroke=\"#39c6ff\" stroke-width=\"3\"/><g fill=\"#2a3040\"><circle cx=\"39\" cy=\"46\" r=\"1.7\"/><circle cx=\"50\" cy=\"42.5\" r=\"1.7\"/><circle cx=\"61\" cy=\"46\" r=\"1.7\"/><circle cx=\"50\" cy=\"49.5\" r=\"1.7\"/></g></svg>", "cassa": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffb020\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ffb020\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"50\" rx=\"40\" ry=\"40\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"88\" rx=\"24\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"27\" y=\"14\" width=\"46\" height=\"70\" rx=\"10\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><circle cx=\"50\" cy=\"34\" r=\"9\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1.3\"/><circle cx=\"50\" cy=\"34\" r=\"3.5\" fill=\"#3a4150\"/><circle cx=\"50\" cy=\"62\" r=\"13\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1.3\"/><circle cx=\"50\" cy=\"62\" r=\"5.5\" fill=\"#3a4150\"/><circle class=\"mc-bolt-green\" cx=\"65\" cy=\"21\" r=\"2.2\" fill=\"#8ff0b4\"/></svg>", "bt": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#5aa9ff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#5aa9ff\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"52\" rx=\"42\" ry=\"34\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"84\" rx=\"30\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"16\" y=\"34\" width=\"68\" height=\"44\" rx=\"22\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><g fill=\"#1b1f28\"><circle cx=\"30\" cy=\"48\" r=\"1.6\"/><circle cx=\"30\" cy=\"56\" r=\"1.6\"/><circle cx=\"30\" cy=\"64\" r=\"1.6\"/><circle cx=\"38\" cy=\"48\" r=\"1.6\"/><circle cx=\"38\" cy=\"56\" r=\"1.6\"/><circle cx=\"38\" cy=\"64\" r=\"1.6\"/><circle cx=\"46\" cy=\"48\" r=\"1.6\"/><circle cx=\"46\" cy=\"56\" r=\"1.6\"/><circle cx=\"46\" cy=\"64\" r=\"1.6\"/><circle cx=\"54\" cy=\"48\" r=\"1.6\"/><circle cx=\"54\" cy=\"56\" r=\"1.6\"/><circle cx=\"54\" cy=\"64\" r=\"1.6\"/><circle cx=\"62\" cy=\"48\" r=\"1.6\"/><circle cx=\"62\" cy=\"56\" r=\"1.6\"/><circle cx=\"62\" cy=\"64\" r=\"1.6\"/><circle cx=\"70\" cy=\"48\" r=\"1.6\"/><circle cx=\"70\" cy=\"56\" r=\"1.6\"/><circle cx=\"70\" cy=\"64\" r=\"1.6\"/></g><path class=\"mc-glow\" d=\"M46 12 L56 20 L46 28 V4 L56 12 L46 20\" fill=\"none\" stroke=\"#5aa9ff\" stroke-width=\"2.6\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/></svg>", "gamepad": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#5aa9ff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#5aa9ff\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"82\" rx=\"34\" ry=\"5\" fill=\"url(#om)\"/><path d=\"M30 32 H70 Q86 32 89 52 Q92 72 80 74 Q72 75 66 64 H34 Q28 75 20 74 Q8 72 11 52 Q14 32 30 32 Z\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.6\"/><rect class=\"mc-glow\" x=\"40\" y=\"35\" width=\"20\" height=\"3\" rx=\"1.5\" fill=\"#5aa9ff\"/><path d=\"M25 47 v12 M19 53 h12\" stroke=\"#8a94a1\" stroke-width=\"3.2\" stroke-linecap=\"round\"/><g stroke-width=\"1.6\" fill=\"none\"><circle cx=\"73\" cy=\"46\" r=\"3\" stroke=\"#6fd3a3\"/><circle cx=\"80\" cy=\"53\" r=\"3\" stroke=\"#ff7a7a\"/><circle cx=\"66\" cy=\"53\" r=\"3\" stroke=\"#e7a1ff\"/><circle cx=\"73\" cy=\"60\" r=\"3\" stroke=\"#7ab8ff\"/></g><circle cx=\"40\" cy=\"61\" r=\"5\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1\"/><circle cx=\"60\" cy=\"61\" r=\"5\" fill=\"#1b1f28\" stroke=\"#8a94a1\" stroke-width=\"1\"/></svg>", "tablet": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><linearGradient id=\"sc\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#2c6fb0\"/><stop offset=\"1\" stop-color=\"#153a63\"/></linearGradient></defs><ellipse cx=\"50\" cy=\"86\" rx=\"30\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"20\" y=\"12\" width=\"60\" height=\"72\" rx=\"8\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><rect class=\"mc-screen\" x=\"25\" y=\"18\" width=\"50\" height=\"58\" rx=\"3\" fill=\"url(#sc)\"/><path class=\"mc-bolt\" d=\"M53 34 L42 50 H50 L46 62 L58 45 H50 Z\" fill=\"#ffd166\"/><circle cx=\"50\" cy=\"80\" r=\"1.6\" fill=\"#8a94a1\"/></svg>", "orologio": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><linearGradient id=\"sc\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#1e3350\"/><stop offset=\"1\" stop-color=\"#0d1624\"/></linearGradient></defs><ellipse cx=\"50\" cy=\"86\" rx=\"28\" ry=\"4.5\" fill=\"url(#om)\"/><ellipse cx=\"50\" cy=\"76\" rx=\"26\" ry=\"8\" fill=\"#3a4150\" stroke=\"#050608\" stroke-width=\"1.2\"/><rect x=\"40\" y=\"8\" width=\"20\" height=\"14\" rx=\"4\" fill=\"#3a4150\"/><rect x=\"40\" y=\"60\" width=\"20\" height=\"12\" rx=\"4\" fill=\"#3a4150\"/><rect x=\"30\" y=\"20\" width=\"40\" height=\"44\" rx=\"12\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><rect class=\"mc-screen\" x=\"35\" y=\"25\" width=\"30\" height=\"34\" rx=\"8\" fill=\"url(#sc)\"/><path d=\"M50 32 V42 L56 46\" stroke=\"#8ff0b4\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/><rect x=\"70\" y=\"36\" width=\"4\" height=\"10\" rx=\"2\" fill=\"#6b7482\"/></svg>", "caricatore": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ffb020\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ffb020\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"50\" rx=\"40\" ry=\"36\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"84\" rx=\"32\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"18\" y=\"44\" width=\"64\" height=\"34\" rx=\"7\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><g stroke=\"#050608\" stroke-width=\"1.3\"><rect x=\"30\" y=\"18\" width=\"14\" height=\"36\" rx=\"3\" fill=\"#6b7482\"/><rect x=\"56\" y=\"18\" width=\"14\" height=\"36\" rx=\"3\" fill=\"#6b7482\"/><rect x=\"34\" y=\"14\" width=\"6\" height=\"5\" rx=\"1.5\" fill=\"#8a94a1\"/><rect x=\"60\" y=\"14\" width=\"6\" height=\"5\" rx=\"1.5\" fill=\"#8a94a1\"/></g><path class=\"mc-bolt\" d=\"M52 58 L45 68 H51 L47 76 L56 65 H50 Z\" fill=\"#ffb020\"/></svg>", "usb": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#8ff0b4\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#8ff0b4\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"80\" rx=\"34\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"14\" y=\"36\" width=\"72\" height=\"36\" rx=\"9\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><g fill=\"#101319\" stroke=\"#8a94a1\" stroke-width=\"1\"><rect x=\"24\" y=\"48\" width=\"14\" height=\"8\" rx=\"1.5\"/><rect x=\"43\" y=\"48\" width=\"14\" height=\"8\" rx=\"1.5\"/><rect x=\"62\" y=\"48\" width=\"14\" height=\"8\" rx=\"1.5\"/></g><g fill=\"#8a94a1\"><rect x=\"26.5\" y=\"50\" width=\"9\" height=\"2.5\"/><rect x=\"45.5\" y=\"50\" width=\"9\" height=\"2.5\"/><rect x=\"64.5\" y=\"50\" width=\"9\" height=\"2.5\"/></g><circle class=\"mc-bolt-green\" cx=\"78\" cy=\"42\" r=\"2.2\" fill=\"#8ff0b4\"/><path d=\"M50 14 V30 M50 14 l-4 5 M50 14 l4 5 M44 24 l6 4 l6 -6\" stroke=\"#8a94a1\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>", "broadlink": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ff6a6a\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ff6a6a\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"84\" rx=\"22\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"34\" y=\"36\" width=\"32\" height=\"46\" rx=\"13\" fill=\"#e8ebef\" stroke=\"#050608\" stroke-width=\"1.5\"/><ellipse cx=\"50\" cy=\"38\" rx=\"16\" ry=\"6\" fill=\"#f6f7f9\" stroke=\"#050608\" stroke-width=\"1.2\"/><circle class=\"mc-bolt-green\" cx=\"50\" cy=\"56\" r=\"3\" fill=\"#39c6ff\"/><g class=\"mc-glow\" stroke=\"#ff6a6a\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"><path d=\"M38 26 q12 -10 24 0\"/><path d=\"M32 18 q18 -15 36 0\"/></g></svg>", "scaldaletto": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><linearGradient id=\"cop\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6b4d8a\"/><stop offset=\"1\" stop-color=\"#3b2a52\"/></linearGradient></defs><ellipse cx=\"50\" cy=\"84\" rx=\"38\" ry=\"5\" fill=\"url(#om)\"/><rect x=\"10\" y=\"52\" width=\"80\" height=\"26\" rx=\"6\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><rect x=\"14\" y=\"38\" width=\"22\" height=\"16\" rx=\"6\" fill=\"#d9dde3\" stroke=\"#050608\" stroke-width=\"1.2\"/><path d=\"M34 44 H86 Q90 44 90 50 V62 H34 Z\" fill=\"url(#cop)\" stroke=\"#050608\" stroke-width=\"1.4\"/><path class=\"mc-heat\" d=\"M40 53 l5 -5 l5 5 l5 -5 l5 5 l5 -5 l5 5 l5 -5 l5 5\" stroke=\"#ff6a3d\" stroke-width=\"2.2\" fill=\"none\" stroke-linejoin=\"round\"/><g class=\"mc-steam\" stroke=\"#ffb020\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"><path d=\"M52 34 q-4 -6 0 -12\"/><path d=\"M64 34 q-4 -6 0 -12\"/></g></svg>", "stufetta": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ff6a3d\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ff6a3d\" stop-opacity=\"0\"/></radialGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"48\" rx=\"42\" ry=\"36\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"86\" rx=\"30\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"22\" y=\"24\" width=\"56\" height=\"56\" rx=\"10\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.5\"/><g stroke=\"#8a94a1\" stroke-width=\"1.2\" opacity=\".7\"><line x1=\"30\" y1=\"34\" x2=\"70\" y2=\"34\"/><line x1=\"30\" y1=\"40\" x2=\"70\" y2=\"40\"/><line x1=\"30\" y1=\"46\" x2=\"70\" y2=\"46\"/><line x1=\"30\" y1=\"52\" x2=\"70\" y2=\"52\"/><line x1=\"30\" y1=\"58\" x2=\"70\" y2=\"58\"/><line x1=\"30\" y1=\"64\" x2=\"70\" y2=\"64\"/></g><path class=\"mc-heat\" d=\"M30 70 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4\" stroke=\"#ff6a3d\" stroke-width=\"2.2\" fill=\"none\"/><g class=\"mc-steam\" stroke=\"#ffb020\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"><path d=\"M38 20 q-4 -6 0 -12\"/><path d=\"M50 20 q-4 -6 0 -12\"/><path d=\"M62 20 q-4 -6 0 -12\"/></g><circle cx=\"72\" cy=\"30\" r=\"2\" fill=\"#ffb020\"/></svg>", "telecamera": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#ff5c5c\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#ff5c5c\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"50\" cy=\"86\" rx=\"24\" ry=\"4.5\" fill=\"url(#om)\"/><path d=\"M44 62 L40 82 H60 L56 62\" fill=\"#3a4150\" stroke=\"#050608\" stroke-width=\"1.2\"/><circle cx=\"50\" cy=\"40\" r=\"26\" fill=\"#e8ebef\" stroke=\"#050608\" stroke-width=\"1.5\"/><circle cx=\"50\" cy=\"40\" r=\"15\" fill=\"#1b1f28\" stroke=\"#4a5261\" stroke-width=\"2\"/><circle cx=\"50\" cy=\"40\" r=\"7\" fill=\"#2c6fb0\"/><circle cx=\"47\" cy=\"37\" r=\"2.2\" fill=\"#cfe6ff\"/><circle class=\"mc-bolt-green\" cx=\"50\" cy=\"20\" r=\"2.2\" fill=\"#ff5c5c\"/></svg>", "irrigatore": "<svg viewBox=\"0 0 100 100\" class=\"mc-svg\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"om\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#000\" stop-opacity=\".4\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"al\" cx=\"50%\" cy=\"50%\" r=\"55%\"><stop offset=\"0\" stop-color=\"#5aa9ff\" stop-opacity=\".45\"/><stop offset=\"1\" stop-color=\"#5aa9ff\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"co\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a5261\"/><stop offset=\"1\" stop-color=\"#232833\"/></linearGradient></defs><ellipse class=\"mc-glow\" cx=\"50\" cy=\"60\" rx=\"40\" ry=\"30\" fill=\"url(#al)\"/><ellipse cx=\"50\" cy=\"88\" rx=\"34\" ry=\"4.5\" fill=\"url(#om)\"/><rect x=\"10\" y=\"30\" width=\"34\" height=\"12\" rx=\"4\" fill=\"url(#co)\" stroke=\"#050608\" stroke-width=\"1.3\"/><rect x=\"40\" y=\"22\" width=\"30\" height=\"30\" rx=\"9\" fill=\"#3b8cf6\" stroke=\"#050608\" stroke-width=\"1.4\"/><rect x=\"46\" y=\"28\" width=\"18\" height=\"10\" rx=\"2\" fill=\"#0d1624\"/><circle class=\"mc-bolt-green\" cx=\"55\" cy=\"45\" r=\"2.4\" fill=\"#8ff0b4\"/><path d=\"M62 52 V60 Q62 64 58 64 H52\" stroke=\"#4a5261\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\"/><g fill=\"#5aa9ff\"><path class=\"mc-water\" d=\"M50 70 q-3 5 0 8 q3 -3 0 -8Z\"/><path class=\"mc-water\" style=\"animation-delay:.3s\" d=\"M44 74 q-3 5 0 8 q3 -3 0 -8Z\"/><path class=\"mc-water\" style=\"animation-delay:.6s\" d=\"M56 76 q-3 5 0 8 q3 -3 0 -8Z\"/></g><path d=\"M20 84 q6 -10 12 0 M68 84 q6 -12 12 0\" stroke=\"#4caf50\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/></svg>"};
Object.keys(MC_SVG_OGGETTI).forEach(k => { MC_ICON_RENDER[k] = () => mcNamespaceCustomSvg(MC_SVG_OGGETTI[k]); });
Object.assign(MC_ICON_LABELS, {
  presa: "Presa", ciabatta: "Ciabatta", lampadina: "Luce", led: "Striscia LED", luci_esterne: "Luci esterne",
  stampante3d: "Stampante 3D", caffe: "Caffè", echo: "Alexa", cassa: "Cassa", bt: "Cassa Bluetooth",
  gamepad: "Console", tablet: "Tablet", orologio: "Orologio", caricatore: "Caricatore", usb: "USB",
  broadlink: "Broadlink", scaldaletto: "Scaldaletto", stufetta: "Stufetta", telecamera: "Telecamera", irrigatore: "Irrigatore",
});

// L'ICONA SI SCEGLIE DAL NOME, OGNI VOLTA CHE SI DISEGNA (non solo mentre si
// scrive nell'editor). Vince l'oggetto piu preciso: "Presa caffe" e la
// macchina del caffe, "Presa TV" e la TV, "Presa bagno" e una presa. Per
// questo presa e ciabatta stanno in fondo: sono il nome generico di quasi
// tutto. Una parola con * vale anche come inizio ("lampad*" prende lampada e
// lampadina); le altre devono essere parole intere ("tv" non deve scattare
// dentro "tavolo").
const MC_PAROLE_OGGETTI = [
  ["luci_esterne", ["luci esterne", "luci natale", "luci di natale", "luminarie", "albero di natale", "ghirland*"]],
  ["led", ["led", "striscia*", "strip"]],
  ["lampadina", ["luce", "luci", "lampad*", "faretto", "faretti", "plafoniera", "applique", "abat jour", "abatjour", "lume"]],
  ["scaldaletto", ["scaldaletto", "scalda letto", "scalda coperta", "termocoperta", "coperta"]],
  ["stufetta", ["stufetta", "termoventilatore", "termoconvettore", "radiatore", "calorifero", "scaldino", "termosifone"]],
  ["climate", ["clima", "condizionatore", "climatizzatore", "split", "termostato", "stufa", "pellet", "pompa di calore", "caldaia", "temperatura", "umidita", "termometro"]],
  ["oven", ["forno", "microonde", "induzione", "piano cottura", "fornelli", "friggitrice"]],
  ["fridge", ["frigo*", "congelatore", "freezer", "cantinetta"]],
  ["washer", ["lavatrice"]],
  ["dryer", ["asciugatrice"]],
  ["dishwasher", ["lavastoviglie", "lavapiatti"]],
  ["caffe", ["caffe", "espresso", "moka", "nespresso"]],
  ["stampante3d", ["stampante*", "3d", "plotter"]],
  ["telecamera", ["telecamer*", "videocamer*", "webcam", "ipcam"]],
  ["echo", ["alexa", "echo", "google home", "smart speaker"]],
  ["bt", ["bluetooth"]],
  ["cassa", ["cassa", "casse", "bose", "soundbar", "altoparlant*", "speaker", "stereo", "amplificatore", "hifi", "subwoofer"]],
  ["gamepad", ["playstation", "play station", "ps4", "ps5", "xbox", "console", "nintendo"]],
  ["tv", ["tv", "televisore", "televisione", "decoder", "digitale terrestre", "fire tv", "firestick", "chromecast", "sky", "proiettore"]],
  ["tablet", ["tablet", "ipad"]],
  ["orologio", ["orologio", "smartwatch", "watch"]],
  ["caricatore", ["carica*", "caricabatter*", "batterie"]],
  ["usb", ["usb"]],
  ["broadlink", ["broadlink", "infrarossi", "ir blaster"]],
  ["router", ["router", "modem", "wifi", "wi fi", "deco", "nas", "access point"]],
  ["vacuum", ["aspirapolvere", "robot", "roomba"]],
  ["fan", ["ventilatore", "ventola"]],
  ["gate", ["cancello", "cancelletto", "portone", "basculante"]],
  ["alarm", ["allarme", "sirena"]],
  ["security", ["sicurezza", "serratura", "porta blindata", "movimento"]],
  ["irrigatore", ["irrigator*", "irrigazione", "annaffi*", "sprinkler"]],
  ["ciabatta", ["ciabatta", "multipresa"]],
  ["presa", ["presa", "prese", "spina", "plug", "socket"]],
];
// Le stanze servono solo quando dal nome non esce nessun oggetto (una card
// che dice "Bagno" e basta) e per le card Stanza.
const MC_PAROLE_STANZE = [
  ["kitchen", ["cucina"]], ["bathroom", ["bagno", "doccia", "vasca", "boiler", "scaldabagno"]],
  ["office", ["ufficio", "studio", "scrivania"]], ["garden", ["giardino", "esterno", "balcone", "terrazzo", "orto", "piscina", "gazebo"]],
  ["livingroom", ["soggiorno", "salotto", "sala", "divano"]], ["bedroom", ["camera", "letto", "comodino", "armadio", "como"]],
];
function mcNormalizza(s) {
  return " " + String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim() + " ";
}
function mcTrovaParole(testo, elenco) {
  const t = mcNormalizza(testo);
  if (!t.trim()) return null;
  for (const [tipo, parole] of elenco) {
    for (const p of parole) {
      const w = mcNormalizza(p.replace("*", "")).trim();
      if (p.endsWith("*") ? t.includes(" " + w) : t.includes(" " + w + " ")) return tipo;
    }
  }
  return null;
}
// Dal nome della card; se il nome non dice niente, dall'entita comandata (il
// suo id e il suo nome in Home Assistant: "Non disturbare" non dice che e
// un'Alexa, "switch.echo_show_camera_..." si); poi dal tipo di entita: una
// luce, una valvola, una presa che Home Assistant dichiara "outlet".
function mcIconaIntelligente(cfg, hass) {
  const n = mcTrovaParole(cfg.name, MC_PAROLE_OGGETTI);
  if (n) return n;
  const id = String(cfg.switch || "");
  const st = hass && id && hass.states ? hass.states[id] : null;
  const altro = id.replace(/^[a-z_]+\./, "").replace(/_/g, " ") + " " + ((st && st.attributes && st.attributes.friendly_name) || "");
  const e = mcTrovaParole(altro, MC_PAROLE_OGGETTI);
  if (e) return e;
  const dom = id.split(".")[0];
  const dc = st && st.attributes ? st.attributes.device_class : "";
  if (dom === "light") return "lampadina";
  if (dom === "valve") return "irrigatore";
  if (dom === "vacuum") return "vacuum";
  if (dom === "climate" || cfg.climate) return "climate";
  if (dom === "camera") return "telecamera";
  if (dom === "lock") return "security";
  if (dom === "media_player") return dc === "tv" ? "tv" : "echo";
  if (dc === "outlet") return "presa";
  return null;
}

// Segnaposto per il pulsante "Personalizzata" nella griglia dell'editor —
// non è un'icona del pacchetto, solo un simbolo (tavolozza) che apre il
// campo per incollare l'SVG creato col Creatore Icone.
// LA RACCOLTA DELLE ICONE FATTE IN CASA.
// Prima un'icona disegnata viveva solo dentro la card in cui era stata
// incollata: per rimetterla su un'altra card bisognava ritrovare il codice e
// reincollarlo, e cancellando la card l'icona era persa. Ora si salvano in una
// raccolta che sta SUL SERVER (le preferenze del frontend di Home Assistant),
// non nel browser: un'icona disegnata dal telefono si ritrova dal tablet, e
// svuotare la cache non porta via niente.
const MC_CHIAVE_ICONE = "faber_icone";
let MC_ICONE_MIE = null;      // una lettura per sessione, poi si tiene qui
let MC_ICONE_ATTESA = null;   // se due editor la chiedono insieme, una sola chiamata

async function mcIconeCarica(hass) {
  if (MC_ICONE_MIE) return MC_ICONE_MIE;
  if (MC_ICONE_ATTESA) return MC_ICONE_ATTESA;
  MC_ICONE_ATTESA = (async () => {
    try {
      const r = await hass.callWS({ type: "frontend/get_user_data", key: MC_CHIAVE_ICONE });
      const v = r && r.value;
      MC_ICONE_MIE = Array.isArray(v && v.icone) ? v.icone : [];
    } catch (e) {
      // Meglio nessuna raccolta che un editor che non si apre.
      console.warn("[mini-card] raccolta icone non leggibile:", e);
      MC_ICONE_MIE = [];
    }
    MC_ICONE_ATTESA = null;
    return MC_ICONE_MIE;
  })();
  return MC_ICONE_ATTESA;
}

async function mcIconeSalva(hass, icone) {
  MC_ICONE_MIE = icone;
  await hass.callWS({ type: "frontend/set_user_data", key: MC_CHIAVE_ICONE, value: { icone } });
}

function mcIconeId() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const MC_CUSTOM_BADGE_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="mcCustomBadge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb020"/><stop offset="1" stop-color="#47b5ff"/></linearGradient></defs>
  <path d="M50 12 A38 38 0 1 0 88 50 C88 44 84 40 78 40 L68 40 C63 40 60 36 60 32 C60 20 56 12 50 12 Z" fill="url(#mcCustomBadge)" opacity=".85"/>
  <circle cx="36" cy="42" r="6" fill="#1c212b" opacity=".55"/>
  <circle cx="34" cy="62" r="6" fill="#1c212b" opacity=".55"/>
  <circle cx="56" cy="70" r="6" fill="#1c212b" opacity=".55"/>
</svg>`;

// Impedisce a librerie tipo "hass-swipe-navigation" di leggere un tocco dentro
// la card come uno swipe di cambio-vista. In modalità modifica dashboard
// (URL con "edit=1") non blocchiamo nulla, altrimenti l'editor di HA non
// riceve più il gesto e la card non si può trascinare per riordinarla o
// ridimensionarla (bug trovato dopo su un'altra card della stessa famiglia).
// hass-swipe-navigation stesso ignora già i gesti dentro <hui-card-edit-mode>
// (il wrapper che HA mette intorno alle card quando la dashboard è in
// modifica, per non rubare il drag-and-drop di riordino) — controllando lì
// dentro NON dobbiamo bloccare nulla noi. Il tentativo precedente (guardare
// "edit=1" nell'URL) era sbagliato: le dashboard "sections" non cambiano
// l'URL entrando in modifica, per questo il riordino restava bloccato.
function mcInEditMode(e) {
  const path = e.composedPath ? e.composedPath() : [];
  return path.some(n => n.tagName === "HUI-CARD-EDIT-MODE");
}
function stopSwipeNavHijack(el) {
  ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove"].forEach(evt =>
    el.addEventListener(evt, e => { if (!mcInEditMode(e)) e.stopPropagation(); }, { passive: true }));
}

class MiniCard extends HTMLElement {
  setConfig(config) {
    this._cfg = Object.assign({}, MC_DEFAULTS, config || {});
    this._built = false;
    this._hist = null;
    this._histLoading = false;
    this._histTs = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._build(); this._built = true; this._loadHistory(); }
    this._update();
    if (!this._histLoading && Date.now() - this._histTs > 10 * 60 * 1000) this._loadHistory();
  }

  getCardSize() { return 2; }
  // Di default piccola (2x2): pensata per stare tante per riga su telefono.
  // Ridimensionabile dalla scheda "Layout" dell'editor: icona e testo
  // seguono la larghezza reale grazie alle container query nel CSS.
  getLayoutOptions() {
    return { grid_rows: 3, grid_columns: 2, grid_min_rows: 2, grid_max_rows: 8, grid_min_columns: 1, grid_max_columns: 6 };
  }
  static getConfigElement() { return document.createElement("mini-card-editor"); }
  static getStubConfig() { return JSON.parse(JSON.stringify(MC_DEFAULTS)); }

  // Quando un comando e ACCESO. Il dominio decide: una valvola aperta dice
  // "open", una serratura "unlocked", un aspirapolvere "cleaning". Prima si
  // guardava solo "on" e gli irrigatori (valve) risultavano sempre spenti
  // anche mentre stavano irrigando.
  _acceso(st) {
    if (!st) return false;
    const dom = String(st.entity_id || "").split(".")[0];
    if (["climate", "humidifier", "water_heater"].includes(dom)) return !["off", "unavailable", "unknown"].includes(st.state);
    const acceso = MC_STATI_ACCESI[dom];
    return acceso ? acceso.includes(st.state) : st.state === "on";
  }

  _num(entity) {
    const s = this._hass && this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }
  _fmt(x) { return (Math.round(x * 100) / 100).toLocaleString("it-IT", { minimumFractionDigits: x < 10 ? 2 : 1, maximumFractionDigits: 2 }); }
  _fmtE(k) { return "≈ " + (k * (parseFloat(this._cfg.prezzo_kwh) || 0)).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  _dkey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  _dlabel(d) { return `${WD[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
  _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---- storico (integra la potenza nel tempo, come per frigo/congelatore
  // del Centro Elettrodomestici — qui non ci si può affidare a un sensore di
  // energia perché spesso non esiste per un dispositivo "minore" tipo una luce). ---
  async _loadHistory() {
    if (!this._hass || !this._cfg.power) { this._hist = null; return; }
    this._histLoading = true;
    const days = parseInt(this._cfg.storico_giorni) || 14;
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    try {
      // Prima qui si scaricavano 14 giorni di letture GREZZE per ogni card che
      // avesse un sensore di potenza. Su questo impianto sono decine di
      // migliaia di righe a card (i sensori scrivono ogni 15 secondi), e la
      // home ne ha cinque: e da li che veniva l'attesa infinita.
      // Per i kWh al giorno basta la media oraria, che il registratore ha gia
      // pronta: media in watt per un'ora = wattora. 336 righe invece di 28.000.
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(), end_time: now.toISOString(),
        statistic_ids: [this._cfg.power], period: "hour", types: ["mean"],
      });
      const medie = (st && st[this._cfg.power]) || [];
      if (medie.length) {
        this._hist = this._giornoDaMedie(medie);
      } else {
        // Sensore senza statistiche: si ripiega sul grezzo, ma su due giorni.
        const dopo = new Date(now.getTime() - Math.min(days, 2) * 86400000);
        const res = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: dopo.toISOString(), end_time: now.toISOString(),
          entity_ids: [this._cfg.power], minimal_response: true, no_attributes: true,
        });
        this._hist = this._integratePower((res && res[this._cfg.power]) || []);
      }
    } catch (e) {
      this._hist = null;
      console.warn("[mini-card] storico non disponibile:", e);
    }
    this._histLoading = false;
    this._histTs = Date.now();
    this._update();
  }

  // Media oraria in watt -> kWh per giorno (un'ora di media W vale W/1000 kWh).
  _giornoDaMedie(rows) {
    const MAX_W = 2500;
    const daily = {};
    for (const r of rows) {
      const w = parseFloat(r.mean);
      if (!isFinite(w)) continue;
      const k = this._dkey(new Date(r.start));
      daily[k] = (daily[k] || 0) + Math.min(MAX_W, Math.max(0, w)) / 1000;
    }
    return daily;
  }

  // Le accensioni di UN giorno, chieste solo quando servono davvero: stanno
  // dentro il foglio, e il foglio si apre di rado. Un giorno di letture grezze
  // sono circa duemila righe invece delle ventottomila di quattordici giorni.
  async _caricaGiorno(giorno) {
    if (!this._hass || !this._cfg.power) return;
    if (!this._sess) this._sess = {};
    if (this._sess[giorno] !== undefined) return;
    this._sess[giorno] = null;          // "sto arrivando", non "niente"
    const [a, m, g] = giorno.split("-").map(Number);
    const da = new Date(a, m - 1, g, 0, 0, 0, 0);
    const al = new Date(a, m - 1, g, 23, 59, 59, 999);
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: da.toISOString(), end_time: al.toISOString(),
        entity_ids: [this._cfg.power], minimal_response: true, no_attributes: true,
      });
      const rows = (res && res[this._cfg.power]) || [];
      const norm = r => r.s !== undefined
        ? { t: r.lu * 1000, w: parseFloat(r.s) }
        : { t: new Date(r.last_updated || r.lu).getTime(), w: parseFloat(r.state) };
      const pts = rows.map(norm).filter(x => !isNaN(x.w) && !isNaN(x.t))
        .map(x => ({ t: x.t, w: Math.min(2500, Math.max(0, x.w)) }))
        .sort((x, y) => x.t - y.t);
      const tutte = this._sessioniDa(pts);
      this._sess[giorno] = (tutte && tutte[giorno]) || [];
    } catch (e) {
      this._sess[giorno] = [];
    }
    if (this._ridisegnaFoglio) this._ridisegnaFoglio();
  }

  _integratePower(rows) {
    const MAX_W = 2500;
    const MAX_GAP_S = 2 * 3600;
    const norm = r => r.s !== undefined
      ? { t: r.lu * 1000, w: parseFloat(r.s) }
      : { t: new Date(r.last_updated || r.lu).getTime(), w: parseFloat(r.state) };
    const pts = rows.map(norm).filter(p => !isNaN(p.w) && !isNaN(p.t))
      .map(p => ({ t: p.t, w: Math.min(MAX_W, Math.max(0, p.w)) }))
      .sort((a, b) => a.t - b.t);
    const daily = {};
    for (let i = 0; i < pts.length - 1; i++) {
      const dtS = Math.min(MAX_GAP_S, (pts[i + 1].t - pts[i].t) / 1000);
      if (dtS <= 0) continue;
      const kwh = (pts[i].w * dtS) / 3600 / 1000;
      const k = this._dkey(new Date(pts[i].t));
      daily[k] = (daily[k] || 0) + kwh;
    }
    // Le stesse letture dicono anche QUANDO ha lavorato: quando siamo qui
    // (ripiego senza statistiche) si tengono, che e gratis.
    this._sess = Object.assign(this._sess || {}, this._sessioniDa(pts));
    return daily;
  }

  // Da una fila di letture di potenza alle accensioni vere e proprie.
  //
  // Il punto delicato e la PAUSA: una lavastoviglie fra il riscaldamento e il
  // risciacquo sta ferma anche dieci minuti, e spezzare li il ciclo darebbe
  // "sei accensioni da un quarto d'ora" invece di "un lavaggio da due ore".
  // Quindi sotto soglia non si chiude subito: si aspetta, e solo se il silenzio
  // dura piu di PAUSA_MAX il ciclo si considera finito davvero.
  _sessioniDa(pts) {
    const soglia = parseFloat(this._cfg.soglia) || 10;
    const strappi = this._impulsivo();
    // Quanto silenzio chiude un'accensione. Una lavastoviglie si ferma dieci
    // minuti fra riscaldamento e risciacquo e il ciclo non e finito; una
    // pompa che si ferma, si e fermata davvero.
    const PAUSA_MAX = parseFloat(this._cfg.pausa_max) > 0
      ? parseFloat(this._cfg.pausa_max) * 60000
      : (strappi ? 30 * 1000 : 12 * 60 * 1000);
    // Sotto questa durata e un colpo di corrente e non si conta. Ma
    // un'autoclave parte per trenta secondi: con un minuto sparivano tutte.
    const MINIMA = strappi ? 8 * 1000 : 60 * 1000;
    // Fin dove si allunga un'accensione dopo l'ultima lettura sopra soglia.
    // Un sensore che scrive solo quando cambia puo tacere per un quarto d'ora:
    // senza questo tetto, un avvio di trenta secondi diventava "17 minuti".
    const GRAZIA = 90 * 1000;
    const MAX_GAP_S = 2 * 3600;
    const out = {};
    let cur = null;
    const chiudi = fine => {
      if (!cur) return;
      const durata = (cur.ultimoSopra || cur.da) - cur.da;
      if (durata >= MINIMA) {
        const k = this._dkey(new Date(cur.da));
        let prof = cur.prof || [];
        if (prof.length > 200) {        // assottiglio: al minuto basta e avanza
          const passo = Math.ceil(prof.length / 200);
          prof = prof.filter((x, i) => i % passo === 0);
        }
        (out[k] = out[k] || []).push({ da: cur.da, a: cur.ultimoSopra || cur.da, kwh: cur.kwh, picco: cur.picco, prof });
      }
      cur = null;
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const succ = pts[i + 1];
      const dtS = succ ? Math.min(MAX_GAP_S, (succ.t - p.t) / 1000) : 0;
      const sopra = p.w > soglia;
      if (sopra) {
        // Un'accensione nuova dopo un lungo silenzio chiude quella prima.
        // Senza questo, un sensore che scrive solo quando cambia (manda 680,
        // poi 0, poi tace fino alla volta dopo) non produceva mai la lettura
        // "bassa e tardiva" che chiudeva il ciclo: quattro avvii da mezzo
        // minuto diventavano una sola accensione lunga quattordici ore.
        if (cur && p.t - cur.ultimoSopra > PAUSA_MAX) chiudi();
        if (!cur) cur = { da: p.t, kwh: 0, picco: 0, prof: [] };
        cur.ultimoSopra = succ ? Math.min(succ.t, p.t + GRAZIA) : p.t;
        cur.picco = Math.max(cur.picco, p.w);
      } else if (cur && p.t - cur.ultimoSopra > PAUSA_MAX) {
        chiudi();
      }
      // L'energia si somma comunque finche il ciclo e aperto: le pause di un
      // lavaggio fanno parte del lavaggio.
      if (cur && dtS > 0) cur.kwh += (p.w * dtS) / 3600 / 1000;
      if (cur) cur.prof.push({ t: p.t, w: p.w });
    }
    chiudi();
    return out;
  }

  // Che apparecchio e: lo decide il nome, come per l'icona.
  _tipoApparecchio() {
    const n = [this._cfg.name, this._cfg.switch, this._cfg.power, this._cfg.device_id]
      .filter(Boolean).join(" ").toLowerCase();
    if (/lavastovigl|dishwash/.test(n)) return "lavastoviglie";
    if (/asciugatric|dryer/.test(n)) return "asciugatrice";
    if (/lavatric|lavabianch|washer/.test(n)) return "lavatrice";
    if (/forno|oven/.test(n)) return "forno";
    if (/congelator|freezer|surgelat/.test(n)) return "congelatore";
    if (/frigo|fridge/.test(n)) return "frigo";
    return "generico";
  }

  // LE FASI DEL CICLO. Non le dice l'apparecchio: si ricavano dalla forma dei
  // consumi, raggruppando i minuti per fascia di potenza e dando un nome al
  // gruppo in base a dove si trova nel ciclo (prima o dopo il riscaldamento,
  // e se e l'ultimo tratto sotto sforzo).
  _fasi(sess) {
    const prof = (sess && sess.prof) || [];
    if (prof.length < 4) return [];
    // Un valore al minuto: le letture arrivano ogni 10-15 secondi e i minuti
    // rendono il quadro leggibile invece di un pettine.
    const minuti = [];
    prof.forEach(p => {
      const m = Math.floor(p.t / 60000);
      const u = minuti[minuti.length - 1];
      if (u && u.m === m) { u.v.push(p.w); return; }
      minuti.push({ m, v: [p.w] });
    });
    const fascia = w => w >= MC_FASCIA_ALTA ? 3 : w >= MC_FASCIA_MEDIA ? 2 : w >= MC_FASCIA_BASSA ? 1 : 0;
    let seg = [];
    minuti.forEach(x => {
      const media = x.v.reduce((a, b) => a + b, 0) / x.v.length;
      const picco = Math.max.apply(null, x.v);
      const f = fascia(media);
      const u = seg[seg.length - 1];
      if (u && u.f === f) { u.fine = x.m; u.w.push(media); u.picco = Math.max(u.picco, picco); return; }
      seg.push({ f, da: x.m, fine: x.m, w: [media], picco });
    });
    // Un minuto isolato non e una fase: si fonde con quella accanto.
    const unito = [];
    seg.forEach(x => {
      const durata = x.fine - x.da + 1;
      const u = unito[unito.length - 1];
      if (durata < 2 && u) { u.fine = x.fine; u.w = u.w.concat(x.w); u.picco = Math.max(u.picco, x.picco); return; }
      unito.push(x);
    });
    seg = unito.filter(x => x.f > 0 || x.fine - x.da + 1 >= 3);
    // Il silenzio in testa e in coda non e una fase: e il prima e il dopo.
    // (Dentro il ciclo invece una pausa conta, per esempio l'ammollo.)
    while (seg.length && seg[0].f === 0) seg.shift();
    while (seg.length && seg[seg.length - 1].f === 0) seg.pop();
    if (!seg.length) return [];
    // I nomi: dipendono da dove sta la fase nel ciclo.
    const nomi = MC_FASI_NOMI[this._tipoApparecchio()] || MC_FASI_NOMI.generico;
    const primaAlta = seg.findIndex(x => x.f === 3);
    let ultimaForte = -1;
    seg.forEach((x, i) => { if (x.f === 2 && x.fine - x.da + 1 >= 3) ultimaForte = i; });
    let basseDopo = 0;
    return seg.map((x, i) => {
      const durata = x.fine - x.da + 1;
      let t;
      if (x.f === 3) t = nomi.alta;
      else if (x.f === 2) t = i === ultimaForte ? nomi.ultimaForte : nomi.forte;
      else if (x.f === 1) {
        if (primaAlta < 0 || i < primaAlta) t = nomi.prima;
        else if (i === seg.length - 1 && durata < 5) t = nomi.coda;
        else if (i === seg.length - 1 && nomi.ultimaBassa) t = nomi.ultimaBassa;
        else t = (basseDopo++ === 0) ? nomi.dopo : nomi.poi;
      } else t = "pausa";
      const media = x.w.reduce((a, b) => a + b, 0) / x.w.length;
      return { t, da: x.da * 60000, a: (x.fine + 1) * 60000, min: durata, media, picco: x.picco,
        kwh: media * durata / 60 / 1000 };
    });
  }

  // Il disegnino della curva: le fasi si vedono prima ancora di leggerle.
  _curvaHTML(sess) {
    const prof = (sess && sess.prof) || [];
    if (prof.length < 4) return "";
    const max = Math.max.apply(null, prof.map(p => p.w)) || 1;
    const t0 = prof[0].t, span = (prof[prof.length - 1].t - t0) || 1;
    const punti = prof.map(p => (100 * (p.t - t0) / span).toFixed(1) + "," + (30 - 29 * p.w / max).toFixed(1)).join(" ");
    return `<svg class="mc-curva" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${punti}" fill="none" stroke="currentColor" stroke-width="1"
        vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }

  _fasiHTML(sess) {
    const f = this._fasi(sess);
    if (!f.length) return `<div class="mc-fasi"><div class="mc-accvuoto">Non ci sono abbastanza letture per ricavare le fasi.</div></div>`;
    return `<div class="mc-fasi">${this._curvaHTML(sess)}
      ${f.map(x => `<div class="mc-fase">
        <span class="mc-faseora">${this._ora(x.da)}</span>
        <span class="mc-fasen">${this._esc(x.t)}</span>
        <span class="mc-fased">${x.min} min</span>
        <span class="mc-fasew">${Math.round(x.media)} W</span></div>`).join("")}
      <div class="mc-fasenota">Fasi ricavate dai consumi, non dichiarate dall'apparecchio.</div></div>`;
  }

  // Che cosa e, per il controllo del freddo: quello scelto nella scheda,
  // se no quello indovinato dal nome.
  _tipoFreddo() {
    const scelto = this._cfg.freddo_tipo || "auto";
    if (scelto === "frigo" || scelto === "congelatore") return scelto;
    if (scelto === "no") return "";
    const t = this._tipoApparecchio();
    return t === "frigo" || t === "congelatore" ? t : "";
  }

  _eFreddo() { return !!this._tipoFreddo(); }

  // A STRAPPI. Una pompa o un compressore non fanno "cicli" con pause dentro:
  // fanno tanti avvii brevissimi. Per loro un minuto di soglia minima
  // cancellerebbe quasi tutte le accensioni, e dodici minuti di pausa le
  // incollerebbe tutte insieme in una sola.
  _impulsivo() {
    if (this._eFreddo()) return true;
    const n = [this._cfg.name, this._cfg.switch, this._cfg.power].filter(Boolean).join(" ").toLowerCase();
    return /autoclave|pompa|pump|compress|caldaia|boiler/.test(n);
  }

  // IL CONTROLLO DEL FREDDO. Un frigo non ha cicli: sta acceso e basta. Le
  // domande giuste sono tre: consuma piu di come faceva LUI le settimane
  // scorse? Consuma piu di un modello equivalente? E il compressore, quanto
  // tempo resta acceso? Un compressore che non si ferma mai e il segnale piu
  // onesto che qualcosa non va (guarnizione, brina, condensatore sporco).
  _controlloFreddo() {
    const giorni = Object.keys(this._hist || {}).sort();
    if (giorni.length < 4) return null;
    const oggi = this._dkey(new Date());
    const pieni = giorni.filter(g => g !== oggi).map(g => ({ g, k: this._hist[g] })).filter(x => x.k > 0);
    if (pieni.length < 3) return null;
    const ieri = pieni[pieni.length - 1];
    const ultimi = pieni.slice(-21).map(x => x.k).sort((a, b) => a - b);
    const mediana = ultimi[Math.floor(ultimi.length / 2)];
    const sett = pieni.slice(-7);
    const mediaSett = sett.reduce((a, x) => a + x.k, 0) / sett.length;
    const anno = mediaSett * 365;
    // Il valore di targa dell'apparecchio VERO, se e stato scritto nella
    // scheda, vince sul valore generico della classe: il frigo di casa e un
    // Haier HFR5720EWMG da 477 litri, 302 kWh all'anno dichiarati.
    const base = MC_FREDDO[this._tipoFreddo()] || MC_FREDDO.frigo;
    const targa = parseFloat(this._cfg.riferimento);
    const volte = parseFloat(this._cfg.soglia_targa) > 0 ? parseFloat(this._cfg.soglia_targa) : 1.5;
    const rif = targa > 0
      ? { atteso: targa, alto: Math.round(targa * volte), nome: "la sua targa", scala: targa + " kWh all'anno dichiarati dal costruttore" }
      : { atteso: base.atteso, alto: Math.round(base.atteso * volte), nome: base.nome, scala: base.scala };
    // Il compressore: dalle accensioni del giorno piu completo che ho.
    let acceso = null, partenze = null;
    const cicli = (this._sess || {})[ieri.g];
    if (cicli && cicli.length) {
      const ms = cicli.reduce((a, x) => a + (x.a - x.da), 0);
      acceso = Math.min(100, Math.round(100 * ms / 86400000));
      partenze = cicli.length;
    }
    const scostamento = mediana > 0 ? Math.round(100 * (ieri.k - mediana) / mediana) : 0;
    const guai = [];
    const sogliaMedia = parseFloat(this._cfg.soglia_media) > 0 ? parseFloat(this._cfg.soglia_media) : 35;
    if (scostamento >= sogliaMedia) guai.push(`ieri ha consumato il ${scostamento}% in piu della sua media delle ultime settimane`);
    // Il compressore sempre acceso NON e di per se un guaio: i compressori
    // inverter (il frigo di casa e uno di questi) sono fatti apposta per
    // girare piano e di continuo invece di partire e fermarsi. Diventa un
    // segnale solo se in piu sta consumando piu del suo solito.
    if (acceso != null && acceso >= 85 && scostamento >= Math.min(15, sogliaMedia))
      guai.push(`il compressore non si e quasi mai fermato (${acceso}% del tempo) e intanto il consumo e salito: vale la pena guardare guarnizioni e aerazione`);
    if (anno > rif.alto) guai.push(`di questo passo fa ${Math.round(anno)} kWh all'anno, molto piu di ${rif.nome} (${rif.atteso})`);
    let avviso = "";
    if (anno > rif.atteso * 1.15 && anno <= rif.alto) avviso = `fa circa ${Math.round(anno)} kWh all'anno: sopra ${rif.nome} (${rif.atteso}), ma nei limiti di un apparecchio non recente`;
    return { ieri: ieri.k, mediana, mediaSett, anno, scostamento, acceso, partenze, guai, avviso, rif, sogliaMedia };
  }

  _freddoHTML() {
    if (!this._eFreddo()) return "";     // controllo spento nella scheda
    const c = this._controlloFreddo();
    if (!c) return "";
    const male = c.guai.length > 0;
    const col = male ? "#ff8a3d" : "#4ade80";
    return `<div class="mc-accgruppo">Controllo consumo</div>
      <div class="mc-freddo" style="--f-c:${col}">
        <div class="mc-freddot">${male ? "Qualcosa non torna" : "Consumo nella norma"}</div>
        ${male ? `<ul class="mc-freddol">${c.guai.map(g => `<li>${this._esc(g)}</li>`).join("")}</ul>`
          : c.avviso ? `<div class="mc-freddon">${this._esc(c.avviso)}</div>` : ""}
        <div class="mc-freddor">
          <div><b>${this._fmt(c.ieri)}</b><small>ieri</small></div>
          <div><b>${this._fmt(c.mediana)}</b><small>la sua media</small></div>
          <div><b>${Math.round(c.anno)}</b><small>kWh all'anno</small></div>
          ${c.acceso != null ? `<div><b>${c.acceso}%</b><small>compressore acceso</small></div>` : ""}
          ${c.partenze != null ? `<div><b>${c.partenze}</b><small>partenze al giorno</small></div>` : ""}
        </div>
        <div class="mc-fasenota">Riferimento: ${this._esc(c.rif.scala)}. Avvisa oltre +${c.sogliaMedia}% sulla sua media
          o oltre ${c.rif.alto} kWh all'anno. Il consumo sale d'estate e con la porta aperta spesso.</div>
      </div>`;
  }


  // =========================================================================
  // L'INTERVISTA.
  // Un apparecchio sa un sacco di cose su di se ma non le dice: i numeri
  // stanno nelle statistiche di Home Assistant e bisogna andarseli a pescare.
  // Qui gli si fanno domande e risponde in prima persona, con i suoi dati.
  //
  // Tutto esce da UNA chiamata sola: le medie orarie del sensore di potenza
  // nel periodo scelto. Da quelle si ricava il totale, il profilo delle 24
  // ore, i giorni, il giorno peggiore e il confronto con il periodo prima.
  // =========================================================================
  _periodo(nome) {
    // (MC_data e in fondo al file, accanto al lettore delle domande)
    const ora = new Date();
    const g0 = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate());
    const meno = n => new Date(g0.getTime() - n * 86400000);
    if (nome === "oggi") return { da: g0, a: ora, t: "oggi", giorni: 1 };
    if (nome === "ieri") return { da: meno(1), a: g0, t: "ieri", giorni: 1 };
    if (nome === "mese") return { da: new Date(ora.getFullYear(), ora.getMonth(), 1), a: ora, t: "questo mese", giorni: ora.getDate() };
    if (nome === "mesescorso") {
      const d = new Date(ora.getFullYear(), ora.getMonth() - 1, 1);
      const f = new Date(ora.getFullYear(), ora.getMonth(), 1);
      return { da: d, a: f, t: d.toLocaleDateString("it-IT", { month: "long" }), giorni: Math.round((f - d) / 86400000) };
    }
    if (/^m\d+$/.test(nome)) {            // un mese preciso: m0 = gennaio
      const m = parseInt(nome.slice(1), 10);
      const anno = m > ora.getMonth() ? ora.getFullYear() - 1 : ora.getFullYear();
      const d = new Date(anno, m, 1), f = new Date(anno, m + 1, 1);
      return { da: d, a: f > ora ? ora : f, t: d.toLocaleDateString("it-IT", { month: "long" }), giorni: Math.round(((f > ora ? ora : f) - d) / 86400000) };
    }
    if (nome.indexOf("g:") === 0) {                 // un giorno solo
      const d = MC_data(nome.slice(2));
      const f = new Date(d.getTime() + 86400000);
      return { da: d, a: f > ora ? ora : f, giorni: 1,
        t: "il " + d.toLocaleDateString("it-IT", { day: "numeric", month: "long" }) };
    }
    if (nome.indexOf("r:") === 0) {                 // dal ... al ...
      const pezzi = nome.slice(2).split("|");
      const d = MC_data(pezzi[0]);
      const f = new Date(MC_data(pezzi[1]).getTime() + 86400000);   // il giorno finale e compreso
      const fine = f > ora ? ora : f;
      const opz = { day: "numeric", month: "long" };
      return { da: d, a: fine, giorni: Math.max(1, Math.round((fine - d) / 86400000)),
        t: "dal " + d.toLocaleDateString("it-IT", opz) + " al " + new Date(f.getTime() - 86400000).toLocaleDateString("it-IT", opz) };
    }
    const n = parseInt(nome, 10) || 7;
    return { da: meno(n), a: ora, t: "negli ultimi " + n + " giorni", giorni: n };
  }

  async _statOre(da, a) {
    const h = this._hass, id = this._cfg.power;
    if (!h || !id) return null;
    const res = await h.callWS({
      type: "recorder/statistics_during_period",
      start_time: da.toISOString(), end_time: a.toISOString(),
      statistic_ids: [id], period: "hour", types: ["mean"],
    });
    const righe = (res && res[id]) || [];
    return righe.map(r => ({
      t: typeof r.start === "number" ? r.start : new Date(r.start).getTime(),
      w: r.mean == null ? 0 : r.mean,
    })).filter(x => isFinite(x.t));
  }

  // Tutto quello che serve alle risposte, in un colpo solo.
  async _dati(nomePeriodo) {
    this._cache = this._cache || {};
    if (this._cache[nomePeriodo]) return this._cache[nomePeriodo];
    const p = this._periodo(nomePeriodo);
    const ore = await this._statOre(p.da, p.a);
    if (!ore || !ore.length) return null;
    const perOra = new Array(24).fill(0), quanteOra = new Array(24).fill(0);
    const giorni = {};
    let tot = 0;
    ore.forEach(x => {
      const kwh = x.w / 1000;                   // media oraria in W -> kWh di quell'ora
      tot += kwh;
      const d = new Date(x.t);
      perOra[d.getHours()] += kwh;
      quanteOra[d.getHours()]++;
      const k = this._dkey(d);
      giorni[k] = (giorni[k] || 0) + kwh;
    });
    const mediaOra = perOra.map((v, i) => quanteOra[i] ? v / quanteOra[i] : 0);
    const elenco = Object.keys(giorni).sort().map(k => ({ k, v: giorni[k] }));
    // I giorni su cui fare la media sono quelli del periodo chiesto, non le
    // caselle di calendario toccate: "ultimi 7 giorni" ne tocca 8 perche oggi
    // e a meta, e dire "su 8 giorni" dopo aver detto "ultimi 7" confonde.
    // "Ultimi 7 giorni" vuol dire 7, anche se tocca 8 caselle di calendario
    // perche oggi e a meta: la media si fa sui giorni chiesti.
    const durata = Math.max(1, p.giorni || Math.round((p.a - p.da) / 86400000) || 1);
    const r = { p, tot, perOra, mediaOra, giorni: elenco, nGiorni: durata, nGiorniVisti: elenco.length };
    this._cache[nomePeriodo] = r;
    return r;
  }

  _nomeSuo() { return this._cfg.name || "questo apparecchio"; }

  async _accensioniPeriodo(p) {
    const h = this._hass, id = this._cfg.power;
    if (!h || !id) return null;
    if ((p.a - p.da) > 8.5 * 86400000) return "troppo";
    const res = await h.callWS({
      type: "history/history_during_period",
      start_time: p.da.toISOString(), end_time: p.a.toISOString(),
      entity_ids: [id], minimal_response: true, no_attributes: true,
    });
    const righe = (res && res[id]) || [];
    const pts = righe.map(r => r.s !== undefined
      ? { t: r.lu * 1000, w: parseFloat(r.s) }
      : { t: new Date(r.last_updated || r.lu).getTime(), w: parseFloat(r.state) })
      .filter(x => !isNaN(x.w) && !isNaN(x.t))
      .map(x => ({ t: x.t, w: Math.min(2500, Math.max(0, x.w)) }))
      .sort((a, b) => a.t - b.t);
    const perGiorno = this._sessioniDa(pts);
    const tutte = [];
    Object.keys(perGiorno).forEach(k => (perGiorno[k] || []).forEach(x => tutte.push(x)));
    return tutte.sort((a, b) => a.da - b.da);
  }

  _dataLunga(k) {
    const [a, m, g] = k.split("-").map(Number);
    return new Date(a, m - 1, g).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  }

  // Il grafichino delle 24 ore dentro la risposta.
  _oreHTML(mediaOra) {
    const mx = Math.max.apply(null, mediaOra) || 1;
    return `<div class="mc-oregraf">${mediaOra.map((v, i) => `<i style="height:${Math.max(3, Math.round(v / mx * 100))}%"
      title="ore ${i}"></i>`).join("")}</div>
      <div class="mc-oreetichette"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`;
  }

  async _rispondi(intento, nomePeriodo) {
    const d = await this._dati(nomePeriodo);
    if (!d) return "Di quel periodo non ho registrazioni: Home Assistant tiene i dati dettagliati per un po' di tempo, poi li riassume.";
    const p = d.p;
    const media = d.nGiorni ? d.tot / d.nGiorni : 0;
    if (intento === "ore") {
      const ordinate = d.mediaOra.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).filter(x => x.v > 0);
      if (!ordinate.length) return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} non ho mai lavorato.`;
      const top = ordinate.slice(0, 3).map(x => `<b>${String(x.i).padStart(2, "0")}:00</b> (${this._fmt(x.v)} kWh)`);
      return `Lavoro soprattutto verso le ${top.join(", ")}. Questo e il mio profilo di una giornata tipo ${p.t}:
        ${this._oreHTML(d.mediaOra)}`;
    }
    if (intento === "perche") {
      const ordinate = d.mediaOra.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).filter(x => x.v > 0);
      const peg = d.giorni.slice().sort((a, b) => b.v - a.v)[0];
      const ore = ordinate.slice(0, 2).map(x => String(x.i).padStart(2, "0") + ":00").join(" e le ");
      return `Il perche non lo so dire: vedo solo la mia corrente, non cosa succede in casa.
        Quello che posso dirti e <b>quando</b>: ${p.t} ho consumato ${this._fmt(d.tot)} kWh,
        ${ordinate.length ? `soprattutto verso le ${ore}` : "senza un'ora di punta"}${peg
          ? `, e il giorno piu carico e stato il ${this._esc(this._dataLunga(peg.k))} con ${this._fmt(peg.v)} kWh` : ""}.
        ${ordinate.length ? this._oreHTML(d.mediaOra) : ""}`;
    }
    if (intento === "tempo") {
      const acc = await this._accensioniPeriodo(p);
      if (acc === "troppo") return `Su un periodo cosi lungo non riesco a sommare i minuti uno per uno:
        chiedimelo su una settimana o su un giorno preciso.`;
      if (!acc || !acc.length) return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} non ho lavorato.`;
      const durata = acc.reduce((a, x) => a + (x.a - x.da), 0);
      return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} ho lavorato <b>${this._durata(durata)}</b> in tutto,
        divisi in ${acc.length === 1 ? "una accensione" : acc.length + " accensioni"},
        e mi sono mangiato ${this._fmt(d.tot)} kWh.`;
    }
    if (intento === "accensioni") {
      const acc = await this._accensioniPeriodo(p);
      if (acc === "troppo") return `Su un periodo cosi lungo non riesco a contarle una per una:
        chiedimelo su una settimana o su un giorno preciso.`;
      if (!acc) return "Non riesco a leggere le mie accensioni: manca il sensore di potenza.";
      if (!acc.length) return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} non mi sono mai acceso.`;
      const durata = acc.reduce((a, x) => a + (x.a - x.da), 0);
      const piuLunga = acc.slice().sort((a, b) => (b.a - b.da) - (a.a - a.da))[0];
      const quante = acc.length === 1 ? "una volta sola" : acc.length + " volte";
      if (acc.length === 1) {
        return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} mi sono acceso <b>una volta sola</b>,
          alle ${this._ora(acc[0].da)}, per ${this._durata(durata)}.`;
      }
      return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} mi sono acceso <b>${quante}</b>,
        per ${this._durata(durata)} in tutto: la prima alle ${this._ora(acc[0].da)},
        l'ultima alle ${this._ora(acc[acc.length - 1].da)}, la piu lunga
        ${this._durata(piuLunga.a - piuLunga.da)}.`;
    }
    if (intento === "peggiore") {
      if (!d.giorni.length) return "Non ho giorni da confrontare in quel periodo.";
      const peg = d.giorni.slice().sort((a, b) => b.v - a.v)[0];
      const quanto = media > 0 ? Math.round(100 * (peg.v / media - 1)) : 0;
      return `Il giorno in cui ho lavorato di piu e stato <b>${this._esc(this._dataLunga(peg.k))}</b>:
        ${this._fmt(peg.v)} kWh, il ${quanto}% sopra la mia media di quel periodo.`;
    }
    if (intento === "costo") {
      const prezzo = parseFloat(this._cfg.prezzo_kwh) || 0;
      const mese = media * 30;
      return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} ti sono costato <b>${this._fmtE(d.tot).replace("≈ ", "")}</b>.
        Di questo passo sono ${this._fmtE(mese).replace("≈ ", "")} al mese e ${this._fmtE(media * 365).replace("≈ ", "")} all'anno,
        contando ${prezzo.toLocaleString("it-IT", { minimumFractionDigits: 2 })} € al kWh.`;
    }
    if (intento === "confronto") {
      const n = p.giorni;
      const fine = p.da;
      const inizio = new Date(fine.getTime() - n * 86400000);
      const ore = await this._statOre(inizio, fine);
      if (!ore || !ore.length) return "Non ho abbastanza storia per confrontarmi con il periodo prima.";
      const prima = ore.reduce((a, x) => a + x.w / 1000, 0);
      if (prima <= 0) return "Nel periodo precedente non risulto aver lavorato, quindi il confronto non direbbe niente.";
      const diff = Math.round(100 * (d.tot / prima - 1));
      const verso = diff > 3 ? "di piu" : diff < -3 ? "di meno" : "uguale";
      return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} ho consumato ${this._fmt(d.tot)} kWh; nello stesso numero di giorni
        prima ne avevo consumati ${this._fmt(prima)}. Quindi sto consumando <b>${verso}</b>${Math.abs(diff) > 3 ? `, del ${Math.abs(diff)}%` : ""}.`;
    }
    if (intento === "acceso") {
      const soglia = (parseFloat(this._cfg.soglia) || 10) / 1000;
      const attive = d.mediaOra.filter(v => v > soglia).length;
      const prima = d.mediaOra.findIndex(v => v > soglia);
      let ultima = -1;
      d.mediaOra.forEach((v, i) => { if (v > soglia) ultima = i; });
      if (prima < 0) return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} non mi sono praticamente mai acceso.`;
      return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} risulto al lavoro in circa <b>${attive} ore su 24</b>,
        di solito fra le ${String(prima).padStart(2, "0")}:00 e le ${String(ultima).padStart(2, "0")}:00.
        ${this._oreHTML(d.mediaOra)}`;
    }
    // totale, che e anche la risposta di riserva
    return `${p.t.charAt(0).toUpperCase() + p.t.slice(1)} ho consumato <b>${this._fmt(d.tot)} kWh</b>
      (${this._fmtE(d.tot).replace("≈ ", "circa ")}), in media ${this._fmt(media)} kWh al giorno su ${d.nGiorni}
      ${d.nGiorni === 1 ? "giorno" : "giorni"}.`;
  }

  // Capire una domanda scritta a mano. Niente intelligenza artificiale: si
  // cercano le parole che contano, e se non si capisce lo si dice.
  _capisci(testo) {
    const t = " " + String(testo || "").toLowerCase().trim() + " ";
    const mesi = MC_MESI;
    let periodo = null;
    // Prima gli intervalli e i giorni precisi: sono i piu specifici, e se
    // cercassi "agosto" per primo "il 20 di agosto" finirebbe su tutto agosto.
    // La seconda parte si prende tutta la coda: in "dal 10 al 20 agosto" il
    // mese sta DOPO il secondo numero, e tagliando corto si perdeva.
    const intervallo = t.match(/\bdal\s+(.{1,40}?)\s+al\s+(.{1,40})/);
    if (intervallo) {
      const b = MC_leggiData(intervallo[2], null);
      const a1 = MC_leggiData(intervallo[1], b);
      if (a1 && b) periodo = "r:" + a1 + "|" + b;
    }
    if (!periodo) {
      const g1 = MC_leggiData(t, null);
      if (g1) periodo = "g:" + g1;
    }
    const gg = t.match(/ultimi?\s+(\d{1,3})\s*giorni/);
    if (!periodo && gg) periodo = gg[1];
    else if (periodo) { /* gia trovato sopra */ }
    else if (/\boggi\b/.test(t)) periodo = "oggi";
    else if (/\bieri\b/.test(t)) periodo = "ieri";
    else if (/mese scorso|scorso mese/.test(t)) periodo = "mesescorso";
    else if (/questo mese|\bmese\b/.test(t)) periodo = "mese";
    else if (/settimana/.test(t)) periodo = "7";
    else {
      const m = mesi.findIndex(x => t.includes(x));
      if (m >= 0) periodo = "m" + m;
    }
    let intento = null;
    if (/quanto hai lavorato|quanto hai funzionato|quanto sei stato acceso|quanto tempo/.test(t)) intento = "tempo";
    else if (/perche|perché|come mai/.test(t)) intento = "perche";
    else if (/accension|quante volte|quanti cicli|partenz|avvii|si e acceso/.test(t)) intento = "accensioni";
    else if (/che ?or|quali ?or|\bore\b|orari|quando consum|fascia/.test(t)) intento = "ore";
    else if (/peggior|massim|record|giorno piu|giorno più/.test(t)) intento = "peggiore";
    else if (/cost|euro|spes|bolletta|soldi/.test(t)) intento = "costo";
    else if (/cambiat|confront|rispetto|prima|meno di|piu di|più di/.test(t)) intento = "confronto";
    else if (/quando ti accendi|quanto stai acceso|acceso|lavori/.test(t)) intento = "acceso";
    else if (/quanto|consum|kwh/.test(t)) intento = "totale";
    // Una domanda che comincia con una parola interrogativa che non sappiamo
    // leggere non va servita con la risposta sbagliata: meglio dire di no.
    // (Senza questo, "quante accensioni hai fatto ieri" riconosceva solo
    // "ieri" e rispondeva con il consumo totale, come se nulla fosse.)
    // "Chi" e "dove" non sono cose che sappia di se: vede la propria
    // corrente, non chi ha premuto il tasto ne in che stanza si trova.
    if (/\bchi\b|\bdove\b/.test(t)) intento = null;
    const dubbio = !intento && /\b(quante|quanti|perche|perché|come|chi|dove|quale|cosa)\b/.test(t);
    return { intento, periodo, dubbio };
  }

  _intervistaHTML() {
    const dom = [
      ["totale", "Quanto hai consumato?"],
      ["ore", "In quali ore consumi di piu?"],
      ["peggiore", "Qual e stato il giorno peggiore?"],
      ["costo", "Quanto mi costi?"],
      ["confronto", "Sei cambiato?"],
      ["acceso", "Quando sei al lavoro?"],
      ["accensioni", "Quante volte ti sei acceso?"],
    ];
    const per = [["oggi", "oggi"], ["ieri", "ieri"], ["7", "7 giorni"], ["30", "30 giorni"],
      ["mese", "questo mese"], ["mesescorso", "mese scorso"]];
    const attuale = this._perNome || "7";
    const chat = (this._chat || []).map(m => m.chi === "io"
      ? `<div class="mc-bolla mc-mia">${this._esc(m.t)}</div>`
      : `<div class="mc-bolla mc-sua">${m.t}</div>`).join("");
    return `<div class="mc-intervista">
      <div class="mc-accgruppo">Chiedi a ${this._esc(this._nomeSuo())}</div>
      <div class="mc-chips">${per.map(([k, t]) => `<button type="button" class="mc-chip${k === attuale ? " sel" : ""}"
        data-per="${k}">${t}</button>`).join("")}</div>
      <div class="mc-chat">${chat || `<div class="mc-bolla mc-sua">Chiedimi quello che vuoi sui miei consumi.
        Posso guardare indietro fino a dove arriva la memoria di Home Assistant.</div>`}</div>
      <div class="mc-chips">${dom.map(([k, t]) => `<button type="button" class="mc-chip" data-dom="${k}">${t}</button>`).join("")}</div>
      <div class="mc-riga-chiedi">
        <input id="mc_chiedi" placeholder="scrivi: quanto hai consumato il 20 agosto?" autocomplete="off">
        <button type="button" class="mc-chip sel" data-invia>Chiedi</button>
      </div>
    </div>`;
  }

  // GIORNO O NOTTE. Lo dice chi ospita la card: il pannello Faber Home mette
  // "chiaro" su di se quando e giorno, e la card si adegua. Chi la usa da
  // sola puo forzarla con il campo "tema" nella scheda.
  _aggiornaTema() {
    const root = this.querySelector(".mc");
    if (!root) return;
    const scelto = this._cfg.tema || "auto";
    const chiaro = scelto === "chiaro" ? true
      : scelto === "scuro" ? false
      : !!(this.closest(".fh-app.chiaro") || this.classList.contains("chiaro"));
    root.classList.toggle("chiaro", chiaro);
  }

  _durata(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? h + "h " + r + "m" : h + "h";
  }

  _ora(ms) {
    return new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }

  // "Quanto ci ha messo la lavastoviglie" e una domanda a cui il totale del
  // giorno non risponde. Qui ci sono gli orari veri: quando e partito, quanto
  // e durato, quanta corrente ha preso quel ciclo.
  _accensioniHTML(giorno, etichetta) {
    const cache = this._sess || {};
    if (cache[giorno] === undefined) {      // mai chiesto: lo chiedo adesso
      this._caricaGiorno(giorno);
      return `<div class="mc-accgruppo">Accensioni</div>
        <div class="mc-accvuoto">Cerco le accensioni di questo giorno...</div>`;
    }
    if (cache[giorno] === null) {           // richiesta in volo
      return `<div class="mc-accgruppo">Accensioni</div>
        <div class="mc-accvuoto">Cerco le accensioni di questo giorno...</div>`;
    }
    const s = cache[giorno] || [];
    if (!s.length) {
      return `<div class="mc-accgruppo">Accensioni</div>
        <div class="mc-accvuoto">Nessuna accensione registrata ${etichetta === "Oggi" ? "oggi" : "in questo giorno"}.</div>`;
    }
    const totMs = s.reduce((a, x) => a + (x.a - x.da), 0);
    const righe = s.map((x, i) => {
      const aperto = this._cicloAperto === giorno + "|" + i;
      return `<div class="mc-acc${x.prof && x.prof.length ? " apribile" : ""}${aperto ? " aperto" : ""}" data-ciclo="${i}">
      <div class="mc-accora">${this._ora(x.da)}<span>&rarr;</span>${this._ora(x.a)}</div>
      <div class="mc-accdur">${this._durata(x.a - x.da)}</div>
      <div class="mc-acckwh">${this._fmt(x.kwh)} kWh<small>picco ${Math.round(x.picco)} W</small></div>
    </div>${aperto ? this._fasiHTML(x) : ""}`;
    }).join("");
    return `<div class="mc-accgruppo">Accensioni · ${this._esc(etichetta)}</div>
      <div class="mc-accsomma">${s.length === 1 ? "una accensione" : s.length + " accensioni"} · acceso ${this._durata(totMs)} in tutto</div>
      <div class="mc-acclista">${righe}</div>`;
  }

  // Pacchetto icone condiviso (14 disegni curati, vedi funzioni mcIcon* sopra).
  // Un'icona incollata (dal Creatore Icone o a mano) ha sempre la priorità:
  // rende il pacchetto di 20 tipi un punto di partenza, non un tetto.
  _icon() {
    const custom = (this._cfg.custom_icon_svg || "").trim();
    if (custom) return mcNamespaceCustomSvg(custom);
    return mcIconFor(this._tipoIcona());
  }

  // L'icona che si vede: scelta a mano (icon_manuale, o card Stanza) oppure
  // quella che dice il nome. icon_type resta il ripiego quando il nome non
  // dice niente.
  _tipoIcona() {
    const c = this._cfg;
    if (c.mode === "room" || c.icon_manuale) return c.icon_type;
    return mcIconaIntelligente(c, this._hass) || c.icon_type;
  }

  _build() {
    this.innerHTML = `
    <style>
      .mc{--mc-panel:rgba(30,38,48,.72);--mc-stroke:rgba(255,255,255,.09);--mc-ink:#eaf1f8;--mc-muted:#93a1b0;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--mc-ink);
        min-height:100%;display:flex}
      .mc *{box-sizing:border-box}
      .mc-card{container-type:inline-size;container-name:mc;flex:1;background:var(--mc-panel);border:1px solid var(--mc-stroke);
        border-radius:18px;padding:10px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:2px;backdrop-filter:blur(14px);box-shadow:0 8px 20px rgba(0,0,0,.32);position:relative;overflow:hidden;
        transition:background-color .5s ease,border-color .5s ease;cursor:pointer}
      /* Un elemento con display: dichiarato da una classe IGNORA l'attributo
         hidden: il codice lo nascondeva, il CSS lo riaccendeva. E' cosi che
         sulle stanze restava quel pallino col trattino — il tasto acceso/spento
         di un apparecchio che una stanza non ha. Stessa trappola gia vista
         sulla card sicurezza: si chiude una volta per tutte, qui. */
      .mc [hidden]{display:none!important}
      .mc-card::before{content:"";position:absolute;inset:0;border-radius:18px;pointer-events:none;
        background:radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.06),transparent 60%)}
      .mc-iconwrap{width:44px;height:44px;flex:0 0 auto}
      /* Due tagli in meno per le card che servono solo a portare da qualche
         parte: una "stanza" non deve occupare lo spazio di un elettrodomestico
         con tutte le sue misure. "Quadrata" tiene il rapporto 1:1 qualunque
         sia la larghezza della colonna. */
      .mc-card.piccola{padding:8px 6px;border-radius:14px;gap:1px}
      .mc-card.piccola .mc-iconwrap{width:30px;height:30px}
      .mc-card.piccola .mc-name{font-size:10px;margin-top:1px}
      .mc-card.piccola .mc-state,.mc-card.piccola .mc-sub{font-size:9.5px}
      .mc-card.piccola .mc-metric{font-size:13px}
      .mc-card.piccola::before{border-radius:14px}
      .mc-card.quadrata{aspect-ratio:1;padding:6px;border-radius:16px;gap:1px;flex:0 0 auto;width:100%}
      .mc-card.quadrata:not([data-mode="room"]) .mc-iconwrap{width:34px;height:34px}
      .mc-card.quadrata:not([data-mode="room"]) .mc-name{font-size:10px;margin-top:2px}
      .mc-card.quadrata .mc-state,.mc-card.quadrata .mc-sub{font-size:9.5px}
      .mc-card.quadrata .mc-metric{font-size:14px}
      .mc-card.quadrata::before{border-radius:16px}
      @container mc (max-width:120px){
        .mc-card.quadrata:not([data-mode="room"]) .mc-iconwrap{width:28px;height:28px}
        /* Su una STANZA no: temperatura e umidita sono tutto quello che la
           card ha da dire, ed e il motivo per cui le hai messo i sensori.
           La misura la governa il blocco delle stanze, qui sotto. */
        .mc-card.quadrata:not([data-mode="room"]) .mc-sub,
        .mc-card.quadrata:not([data-mode="room"]) .mc-metric{display:none}
      }
      /* Card "Stanza": icona panoramica invece di quadrata (i disegni di
         ambiente/scena sono larghi, es. 500x350 — schiacciati in un quadrato
         diventavano illeggibili). Larghezza legata a quella vera della card
         (min(...)) invece di soglie fisse: su una card larga (es. 12 colonne)
         restava piccola con tanto vuoto intorno anche nella versione precedente. */
      /* L'icona riempie TUTTA la card e le scritte le stanno sopra, come la
         copertina di un album. Prima l'icona era un riquadro in mezzo e nome,
         stato e dati si mettevano in fila sotto: su una card quadrata non ci
         stavano, e siccome la card taglia quello che esce (overflow:hidden),
         il nome spariva — mentre nella card accanto, che aveva meno roba da
         dire, si vedeva. Cosi non c'e piu niente in fila: l'immagine sta
         sotto, il testo sopra, e nessuno dei due ruba spazio all'altro.
         Le misure sono in cqw (percentuale della larghezza della card), quindi
         il testo cresce e cala da solo con la dimensione della tessera. */
      /* Il pacchetto di testo (nome, stato, consumo, watt) e un elemento
         solo nel markup, ma qui — fuori dalla modalita "piena" — non deve
         cambiare niente: "contents" lo rende invisibile all'impaginazione,
         come se i suoi figli fossero ancora attaccati direttamente alla
         card. Serve per avere UN contenitore a cui dare un fondo, in
         "piena", senza toccare come si dispongono le altre due modalita. */
      .mc-textwrap{display:contents}
      /* DIVISIONE VERA: il disegno sopra a tutta larghezza, le info in una
         fascia sotto — mai sovrapposti, come nelle card "Stanza" di prima
         quando avevano poco da dire. Prima il testo galleggiava SOPRA il
         disegno (un velo su tutta la card, poi un fondino fluttuante):
         qualunque cosa si scegliesse per renderlo leggibile, copriva un
         pezzo dell'illustrazione. Qui invece i due non si toccano mai: la
         card si divide in due righe vere, l'icona prende quella che resta
         libera, il testo prende quella che gli serve — mai l'uno sopra
         l'altra. Con un nome corto ("Frigo") il disegno prende quasi tutta
         la card; con uno lungo in maiuscolo la fascia sotto cresce un po',
         ma il disegno sopra resta SEMPRE scoperto, mai coperto. */
      .mc-card[data-icona="piena"]{padding:0;gap:0;align-items:stretch}
      /* Senza un rapporto di base, su una card la cui altezza non e fissata
         da nient'altro (niente "quadrata", niente riga che la tiene bassa)
         l'icona cresceva quanto voleva: prendeva "height:100%" da un
         contenitore la cui altezza dipendeva a sua volta da lei — un giro
         che si scioglieva lasciando che l'SVG imponesse la SUA proporzione
         nativa a piena larghezza, diventando un frigo alto il doppio del
         normale che spingeva la fascia di testo fuori dallo schermo.
         4:3 e una base ragionevole per un'illustrazione, non un tetto: dove
         la card e gia alta per altri motivi (quadrata, una riga alta),
         flex:1 la fa comunque crescere fino a riempire quello spazio. */
      .mc-card[data-icona="piena"] .mc-iconwrap{position:relative;flex:1 1 auto;min-height:0;
        width:100%;aspect-ratio:4/3;margin:0;overflow:hidden;
        display:flex;align-items:center;justify-content:center}
      .mc-card[data-icona="piena"] .mc-svg{width:100%;height:100%;filter:none;display:block}
      .mc-card[data-icona="piena"] .mc-textwrap{display:flex;flex-direction:column;flex:0 0 auto;
        gap:.6cqw;position:relative;z-index:2;width:100%;margin:0;
        padding:2.2cqw 4cqw calc(2.2cqw + env(safe-area-inset-bottom,0px));
        background:rgba(6,10,16,.88)}
      .mc-card[data-icona="piena"] .mc-name{margin:0;padding:0;
        font-size:clamp(13px,9cqw,22px);line-height:1.14;color:#fff;white-space:normal}
      .mc-card[data-icona="piena"] .mc-sub{padding:0;
        font-size:clamp(9.5px,5.6cqw,14px);line-height:1.28;white-space:normal;
        color:rgba(255,255,255,.9)}
      /* Su una STANZA non hanno senso: il tasto acceso/spento (non ha una
         presa), "Apri la vista" (la card si tocca e ci porta, si capisce), e
         i watt (che stanno gia nella riga dei dati). Ma un APPARECCHIO con
         un disegno a tutta card (un frigo vero, disegnato) e uno stato e un
         consumo esattamente come un apparecchio con l'icona piccola — la
         regola era scritta troppo larga, per "piena" invece che per
         "stanza", e cosi il frigo perdeva lo stato e i watt che ogni altra
         card mostra. Restano nascosti solo dove il commento diceva. */
      .mc-card[data-mode="room"] .mc-state,
      .mc-card[data-mode="room"] .mc-metric{display:none!important}
      .mc-card[data-mode="room"] .mc-badge{display:none!important}
      .mc-card[data-icona="piena"] .mc-state{padding:0;
        font-size:clamp(10px,4.8cqw,12px);color:rgba(255,255,255,.85)}
      .mc-card[data-icona="piena"] .mc-metric{padding:0;
        font-size:clamp(14px,7.5cqw,19px);color:#fff}
      .mc-card[data-icona="piena"] .mc-metric small{color:rgba(255,255,255,.7)}
      .mc-card[data-icona="piena"] .mc-info{z-index:3}
      .mc-card[data-icona="piena"] .mc-badge{align-self:flex-start}
      /* Il velo verde di "sta consumando" si vedeva solo dove il disegno
         lasciava un angolo scoperto: ora che il disegno ha la sua riga
         intera, gli si appoggia sopra — sulle stanze resta appena accennato
         come prima. */
      .mc-card[data-icona="piena"].on.lavora .mc-iconwrap::after{content:"";
        position:absolute;inset:0;pointer-events:none;
        background:rgba(56,224,138,calc(var(--mc-intensita,0.5) * 0.22))}

      /* ICONA PICCOLA — il disegno in mezzo e le scritte sotto. Anche qui
         TUTTO segue la larghezza della card: ingrandisci la tessera e crescono
         insieme icona e scritte, la rimpicciolisci e calano insieme. Prima le
         misure erano fisse (44px l'icona, 11px il nome) e cambiavano a scatti
         a certe soglie: una card larga il doppio aveva la stessa iconcina. */
      .mc-card[data-icona="piccola"] .mc-iconwrap{width:clamp(26px,30cqw,110px);height:auto;
        aspect-ratio:1;flex:0 0 auto}
      .mc-card[data-icona="piccola"] .mc-name{font-size:clamp(10px,8cqw,19px);line-height:1.2}
      .mc-card[data-icona="piccola"] .mc-sub{font-size:clamp(10.5px,6.4cqw,16px);line-height:1.3}
      .mc-card[data-icona="piccola"] .mc-state{font-size:clamp(8px,5cqw,13px)}
      .mc-card[data-icona="piccola"] .mc-metric{font-size:clamp(14px,9.5cqw,27px)}
      /* Il tasto accendi/spegni: a 185px di card scendeva a 7px, piu piccolo
         di qualunque altra scritta, e il dito lo mancava. */
      .mc-card[data-icona="piccola"] .mc-badge{font-size:clamp(9.5px,5cqw,12.5px);
        padding:clamp(4px,2.4cqw,7px) clamp(10px,6cqw,16px)}
      .mc-svg{width:100%;height:100%;display:block;filter:drop-shadow(0 4px 7px rgba(0,0,0,.35))}
      .mc-name{font-size:11px;font-weight:800;margin-top:2px;text-align:center;line-height:1.2;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .mc-badge{display:flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;margin-top:3px;
        cursor:pointer;min-height:22px;box-sizing:border-box;
        font-size:10px;font-weight:800;letter-spacing:.2px;background:rgba(255,255,255,.06);border:1px solid var(--mc-stroke);color:var(--mc-muted)}
      .mc-durbox{display:flex;align-items:center;gap:10px}
      .mc-durbox b{font-size:19px;font-weight:900;min-width:52px;text-align:center}
      .mc-durbox b small{font-size:11px;font-weight:700;color:var(--mc-muted);margin-left:2px}
      .mc-durbtn{width:34px;height:34px;border-radius:11px;border:1px solid var(--mc-stroke);background:rgba(255,255,255,.07);
        color:inherit;font:inherit;font-size:19px;font-weight:800;cursor:pointer;line-height:1}
      .mc-durbtn:active{transform:scale(.94)}
      .mc-badge .dot{width:6px;height:6px;border-radius:50%;background:#5a6572;flex:0 0 auto}
      .mc-badge[data-on="1"]{background:rgba(56,224,138,.16);border-color:rgba(56,224,138,.45);color:var(--mc-c-ok,#8ff0b4)}
      .mc-card.lavora .mc-badge[data-on="1"]{animation:mc-blink 3s ease-in-out infinite}
      .mc-badge[data-on="1"] .dot{background:#38e08a;box-shadow:0 0 5px #38e08a}
      .mc-badge[data-on="0"] .dot{background:#5a6572}
      /* ======================= MODALITA GIORNO =======================
         La card e nata solo scura, perche viveva su pannelli scuri. Dentro
         Faber Home invece il tema cambia con il sole, e il foglio restava
         notte in pieno giorno. Qui c'e la versione chiara: cambia i colori
         di base e, dove il codice usa velature bianche (che su fondo chiaro
         sparirebbero), le ribalta in velature nere.
         Si attiva con la classe "chiaro" sulla radice della card.        */
      .mc.chiaro{--mc-panel:rgba(255,255,255,.9);--mc-stroke:rgba(15,30,45,.14);
        --mc-ink:#16202a;--mc-muted:#5c6b78}
      .mc.chiaro .mc-scrim{background:rgba(228,235,242,.66)}
      .mc.chiaro .mc-modal{background:#f4f7fa;border-color:rgba(15,30,45,.14);
        box-shadow:0 -10px 40px rgba(15,30,45,.18)}
      .mc.chiaro .mc-sheet-handle{background:rgba(15,30,45,.22)}
      .mc.chiaro .mc-x,
      .mc.chiaro .mc-chip,
      .mc.chiaro .mc-tab,
      .mc.chiaro .mc-avgrow,
      .mc.chiaro .mc-acc,
      .mc.chiaro .mc-fasi,
      .mc.chiaro .mc-freddo,
      .mc.chiaro .mc-durbtn,
      .mc.chiaro .mc-chiedibtn,
      .mc.chiaro .mc-riga-chiedi input,
      .mc.chiaro .mc-pill{background:rgba(15,30,45,.055);color:var(--mc-ink)}
      .mc.chiaro .mc-sua{background:rgba(15,30,45,.06);color:var(--mc-ink)}
      .mc.chiaro .mc-mia{background:rgba(52,140,205,.18);color:var(--mc-ink)}
      .mc.chiaro .mc-chip.sel{background:rgba(52,140,205,.2);border-color:rgba(52,140,205,.45)}
      .mc.chiaro .mc-tab.sel{background:linear-gradient(135deg,rgba(52,140,205,.24),rgba(52,140,205,.12))}
      .mc.chiaro .mc-chiedibtn{background:rgba(52,140,205,.13)}
      .mc.chiaro .mc-hero-icon .mc-svg{filter:drop-shadow(0 10px 18px rgba(15,30,45,.22))}
      .mc.chiaro .mc-conferma{background:#f4f7fa;color:var(--mc-ink)}
      .mc.chiaro .mc-cbtn{background:rgba(15,30,45,.06);color:var(--mc-ink)}
      .mc.chiaro .mc-scrim.mc-conf{background:rgba(228,235,242,.72)}

      @keyframes mc-blink{0%,100%{opacity:1}50%{opacity:.55}}
      /* Acceso: la velatura verde va SOPRA il pannello, non al suo posto.
         Sostituendo lo sfondo la card restava all'8% di opacita e su un fondo
         chiaro (pannello Faber Home di giorno) diventava quasi bianca, con il
         testo bianco sopra: illeggibile. Cosi il pannello resta scuro quanto
         serve su qualunque sfondo. */
      /* Acceso ma fermo: una velatura appena accennata. In funzione: piena.
         Cosi si distingue con un'occhiata, senza leggere. */
      /* Il bagliore si aggiunge all'ombra di sempre, non la sostituisce:
         box-shadow scritto due volte nella stessa riga vuol dire "questa
         ombra E questo bagliore insieme", non "l'uno o l'altro" — se si
         dimentica l'ombra base la card sembra appiattita, come se avesse
         perso la sua elevazione. */
      /* ACCESO: si deve capire a colpo d'occhio, col bagliore — non
         cercando la scritta. Un tenue verde chiaro basta a dire "e sotto
         corrente"; non e ancora "sta consumando sul serio", quindi resta
         leggero apposta. */
      .mc-card.on{background-image:linear-gradient(rgba(56,224,138,.1),rgba(56,224,138,.1));
        border-color:rgba(56,224,138,.3);
        box-shadow:0 8px 20px rgba(0,0,0,.32),0 0 13px rgba(56,224,138,.4);
        transition:background-color .5s ease,border-color .5s ease,box-shadow .5s ease}
      /* SOPRA SOGLIA (il campo "Soglia attivo" nella Configura della card,
         10W di default, un numero a scelta): non e solo lo stesso verde
         piu carico, e un verde DIVERSO — piu scuro, quasi smeraldo invece
         che chiaro — cosi il passaggio si vede come un salto, non come una
         sfumatura che si confonde con l'acceso-e-basta. Da li in su
         --mc-intensita (scritta da _update() in base a quanto supera la
         soglia) continua a crescere: un apparecchio appena sopra soglia si
         scurisce gia rispetto al semplice "acceso", uno a pieno regime
         arriva al bagliore piu intenso di tutti. */
      .mc-card.on.lavora{
        background-image:linear-gradient(
          rgba(14,159,110,calc(0.16 + var(--mc-intensita,0.5) * 0.34)),
          rgba(14,159,110,calc(0.16 + var(--mc-intensita,0.5) * 0.34)));
        border-color:rgba(14,159,110,calc(0.3 + var(--mc-intensita,0.5) * 0.35));
        box-shadow:0 8px 20px rgba(0,0,0,.32),
          0 0 calc(14px + var(--mc-intensita,0.5) * 20px)
          rgba(14,159,110,calc(0.35 + var(--mc-intensita,0.5) * 0.35))}
      .mc-state{font-size:9.5px;font-weight:700;color:var(--mc-muted)}
      .mc-card.on .mc-state{color:var(--mc-c-ok,#8ff0b4)}
      /* In attesa il testo resta neutro: il verde acceso vuol dire "sta
         lavorando", e usarlo anche per "acceso ma fermo" toglierebbe proprio
         la distinzione che si voleva. */
      .mc-card.on.attesa .mc-state{color:var(--mc-muted)}
      .mc-sub{font-size:11px;color:var(--mc-muted);margin-top:0}
      .mc-metric{font-size:16px;font-weight:850;font-variant-numeric:tabular-nums;color:var(--mc-ink)}
      .mc-metric small{font-size:10.5px;color:var(--mc-muted);font-weight:700;margin-left:2px}
      /* le container query fanno crescere icona e testo quando la card viene allargata */
      /* Qui c'erano tre soglie fisse (130, 170, 220 px) che facevano crescere
         icona e scritte A SCATTI: una card larga il doppio poteva ritrovarsi
         con la stessa iconcina finche non superava la soglia successiva. Ora
         le misure sono in cqw, cioe in percentuale della larghezza della card:
         crescono e calano con continuita insieme alla tessera.
         Qui restava anche la "}" di chiusura di quelle soglie, senza nessun
         blocco da chiudere: il browser buttava via la regola successiva
         (.mc-glow{opacity:.12}) e le icone SPENTE avevano il bagliore pieno,
         come se fossero accese. */
      .mc-badge{font-size:11.5px;padding:5px 13px}
      .mc-state{font-size:12.5px} .mc-sub{font-size:13px} .mc-metric{font-size:26px}
      .mc-glow{opacity:.12;transition:opacity .5s}
      .mc-card.on .mc-glow{opacity:.75}
      .mc-card.lavora .mc-glow{opacity:1;animation:mc-pulse 2.6s ease-in-out infinite}
      @keyframes mc-pulse{0%,100%{opacity:.6}50%{opacity:1}}
      .mc-screen,.mc-bolt{opacity:.25;transition:opacity .4s}
      .mc-card.on .mc-screen{opacity:.8}
      /* Uno schermo acceso non pulsa: resta acceso con un filo di vibrazione,
         come la luce di un display vero. */
      .mc-card.lavora .mc-screen{opacity:1;animation:mc-schermo 4s ease-in-out infinite}
      @keyframes mc-schermo{0%,100%{opacity:1}50%{opacity:.82}}
      .mc-card.on .mc-bolt{opacity:.7}
      /* Un LED lampeggia, non sfuma: acceso, spento, acceso. Con la sfumatura
         dal 75 al 100 per cento non si vedeva NIENTE — ed e esattamente il
         motivo per cui le stanze sembravano ferme anche quando l'animazione
         stava andando. Su una sveglia sono i due punti che battono i secondi,
         su un frigo o un allarme e la spia. */
      .mc-card.lavora .mc-bolt{opacity:1;filter:drop-shadow(0 0 5px #ffb020);
        animation:mc-led 1.6s steps(1,end) infinite}
      @keyframes mc-led{0%,48%{opacity:1}52%,100%{opacity:.16}}
      /* Anche le sfumature vere partono da molto piu in basso, senno sono
         movimenti che solo un grafico con il righello puo accorgersi. */
      @keyframes mc-pulse-fast{0%,100%{opacity:.42}50%{opacity:1}}
      [data-role="mercury"]{transition:height .6s ease,y .6s ease}
      .mc-steam{opacity:0;transition:opacity .4s}
      /* Nei disegni fatti in casa il vapore sta quasi sempre dentro un gruppo
         gia velato (opacity .6): le due trasparenze si moltiplicano, e quello
         che doveva essere all'85% finiva al 51%. */
      .mc-card.lavora .mc-steam{opacity:1;animation:mc-steam-rise 2.4s ease-in-out infinite}
      .mc-card.lavora .mc-steam:nth-of-type(2){animation-delay:.8s}
      .mc-card.lavora .mc-steam:nth-of-type(3){animation-delay:1.6s}
      /* IN PERCENTUALE, non in pixel. Dentro un SVG "10px" non sono dieci
         pixel dello schermo: sono dieci unita del disegno. Sulle icone di
         serie (viewBox 100x100) fanno il 10% dell'altezza e il vapore si
         vedeva salire; su un disegno grande come la cucina di casa
         (viewBox 1000x600) fanno l'1,7%, cioe niente. Ecco perche il vapore
         non usciva dalla pentola. La percentuale invece si misura sul pezzo
         disegnato, quindi vale uguale per qualunque disegno. */
      @keyframes mc-steam-rise{0%{opacity:0;transform:translateY(18%)}40%{opacity:.9}100%{opacity:0;transform:translateY(-55%)}}
      .mc-water{opacity:0;transition:opacity .4s}
      .mc-card.lavora .mc-water{opacity:.85;animation:mc-water-fall 1s linear infinite}
      @keyframes mc-water-fall{0%{opacity:0;transform:translateY(-35%)}50%{opacity:.95}100%{opacity:0;transform:translateY(45%)}}
      .mc-bulb2{opacity:.3;transition:opacity .4s}
      .mc-card.on .mc-bulb2{opacity:.8;filter:drop-shadow(0 0 4px #ffd166)}
      /* Una lampada accesa respira: l'alone si allarga e si stringe piano.
         Il filtro fa parte dell'animazione, senno resta fisso e si muove solo
         la trasparenza — che era il difetto di prima. */
      .mc-card.lavora .mc-bulb2{animation:mc-lampada 3.4s ease-in-out infinite}
      @keyframes mc-lampada{
        0%,100%{opacity:.66;filter:drop-shadow(0 0 2px #ffd166)}
        50%{opacity:1;filter:drop-shadow(0 0 11px #ffd166)}}
      .mc-heat{opacity:.12;transition:opacity .4s}
      .mc-card.on .mc-heat{opacity:.55}
      .mc-card.lavora .mc-heat{opacity:1;filter:drop-shadow(0 0 6px #ff6a3d);animation:mc-pulse-fast 2.2s ease-in-out infinite}
      .mc-fan-blades{transition:opacity .3s}
      .mc-card.lavora .mc-fan-blades{animation:mc-fan-spin 1.1s linear infinite}
      @keyframes mc-fan-spin{to{transform:rotate(360deg)}}
      .mc-bolt-green{opacity:.25;transition:opacity .4s}
      .mc-card.on .mc-bolt-green{opacity:.7}
      .mc-card.lavora .mc-bolt-green{opacity:1;filter:drop-shadow(0 0 4px #38e08a);animation:mc-pulse-fast 1.6s ease-in-out infinite}
      .mc-info{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;z-index:1;
        border:1px solid var(--mc-stroke);background:rgba(255,255,255,.08);color:var(--mc-muted);
        font-size:12px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
        opacity:.5;transition:opacity .2s}
      .mc-info:hover{opacity:1}
      /* A sinistra dell'ingranaggio: sono due tastini piccoli in cima alla
         tessera e non devono sovrapporsi. Si accende (ambra) quando c'e
         almeno un orario impostato, cosi si vede a colpo d'occhio. */
      .mc-timer{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;z-index:2;
        border:1px solid var(--mc-stroke);background:rgba(255,255,255,.08);color:var(--mc-muted);
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        opacity:.5;transition:opacity .2s,color .2s,border-color .2s;padding:0}
      .mc-timer ha-icon{--mdc-icon-size:14px}
      .mc-timer:hover{opacity:1}
      .mc-timer.attivo{opacity:1;color:#ffd694;border-color:rgba(255,176,32,.5);background:rgba(255,176,32,.16)}
      .mc-card[data-icona="piena"] .mc-timer{z-index:3}
      /* Popup immersivo: foglio a schermo intero che sale dal basso (stile
         "bottom sheet" iOS), non più il piccolo riquadro centrato — icona
         grande, azioni rapide, poi lo storico consumi già esistente. */
      .mc-scrim{position:fixed;inset:0;background:rgba(4,5,8,.62);backdrop-filter:blur(6px);display:flex;
        align-items:flex-end;justify-content:center;padding:0;z-index:100;opacity:0;pointer-events:none;transition:opacity .18s}
      .mc-scrim.on{opacity:1;pointer-events:auto}
      .mc-modal{width:100%;max-width:420px;max-height:92vh;overflow-y:auto;background:#1a1b21;border:1px solid rgba(255,255,255,.14);
        border-bottom:none;border-radius:26px 26px 0 0;padding:10px 20px 28px;box-shadow:0 -14px 50px rgba(0,0,0,.55);
        transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);position:relative}
      .mc-scrim.on .mc-modal{transform:none}
      /* Il foglio di conferma: nasce visibile (niente classe "on" da
         accendere) e sta al centro, non in fondo come il popup grande. */
      .mc-scrim.mc-conf{opacity:1;pointer-events:auto;align-items:center;padding:22px;z-index:140}
      .mc-conferma{width:100%;max-width:340px;position:relative;overflow:hidden;
        background:linear-gradient(170deg,#232833,#161a21);
        border:1px solid rgba(255,255,255,.14);border-radius:26px;padding:26px 22px 20px;
        box-shadow:0 30px 70px rgba(0,0,0,.62);color:#f4f6f8;text-align:center;
        animation:mc-entra .2s cubic-bezier(.2,.9,.3,1.2)}
      /* Un velo del colore dell'azione dietro l'icona: verde per accendere,
         ambra per spegnere. Da solo dice gia cosa sta per succedere. */
      .mc-conferma::before{content:"";position:absolute;top:-70px;left:50%;transform:translateX(-50%);
        width:230px;height:170px;border-radius:50%;pointer-events:none;
        background:radial-gradient(closest-side,rgba(56,224,138,.30),transparent)}
      .mc-conferma.spegni::before{background:radial-gradient(closest-side,rgba(255,176,32,.28),transparent)}
      @keyframes mc-entra{from{opacity:0;transform:translateY(18px) scale(.94)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion:reduce){.mc-conferma{animation:none}}
      .mc-conferma-icona{width:74px;height:74px;margin:0 auto 14px;position:relative}
      .mc-conferma-icona svg{width:100%;height:100%;display:block}
      .mc-conferma-tit{font-size:17px;font-weight:850;line-height:1.35;letter-spacing:-.2px}
      .mc-conferma-sotto{font-size:12.5px;font-weight:600;line-height:1.45;color:#9fb0c0;margin-top:7px}
      .mc-conferma-row{display:flex;gap:10px;margin-top:20px}
      .mc-cbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
        padding:13px 0;border-radius:15px;border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.05);color:#c3cedb;font:inherit;font-size:13.5px;font-weight:800;
        cursor:pointer;transition:filter .15s,transform .1s}
      .mc-cbtn ha-icon{--mdc-icon-size:18px}
      .mc-cbtn:hover{filter:brightness(1.22)}
      .mc-cbtn:active{transform:scale(.97)}
      .mc-cbtn.si{background:linear-gradient(135deg,rgba(56,224,138,.32),rgba(56,224,138,.16));
        border-color:rgba(56,224,138,.55);color:#a6f5c8}
      .mc-conferma.spegni .mc-cbtn.si{background:linear-gradient(135deg,rgba(255,176,32,.30),rgba(255,176,32,.14));
        border-color:rgba(255,176,32,.55);color:#ffd694}
      .mc-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.25);margin:6px auto 12px}
      .mc-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
      .mc-mt{font-size:16px;font-weight:850;color:var(--mc-ink)}
      .mc-x{width:30px;height:30px;border-radius:50%;border:1px solid var(--mc-stroke);background:rgba(255,255,255,.07);color:var(--mc-ink);font-size:14px;cursor:pointer;flex:0 0 auto}
      .mc-x-abs{position:absolute;top:14px;right:16px;z-index:1}
      .mc-hero{display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 4px 4px;text-align:center}
      .mc-hero-icon{width:112px;height:112px;margin-bottom:4px}
      .mc-hero-icon .mc-svg{filter:drop-shadow(0 10px 18px rgba(0,0,0,.45))}
      .mc-hero-icon.mc-hero-icon-room{width:min(80vw,320px);height:auto;aspect-ratio:10/7}
      /* Riusa la classe .mc-card così le animazioni (.mc-card.on .mc-bolt ecc.)
         funzionano identiche a quelle della tessera, senza duplicare il CSS —
         ma qui deve comportarsi da semplice contenitore, non da tessera vera. */
      .mc-hero-icon.mc-card{background:none;border:none;padding:0;box-shadow:none;cursor:default;
        border-radius:0;backdrop-filter:none;container-type:normal}
      .mc-hero-icon.mc-card::before{content:none}
      .mc-hero-name{font-size:19px;font-weight:850;color:var(--mc-ink);margin-top:8px}
      .mc-hero-state{font-size:13px;font-weight:700;color:var(--mc-muted)}
      .mc-hero-state.on{color:var(--mc-c-ok,#8ff0b4)}
      .mc-actions-row{display:flex;gap:10px;margin:18px 0 6px}
      .mc-pill{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:13px 10px;border-radius:16px;
        font:inherit;font-size:13px;font-weight:800;cursor:pointer;border:1px solid var(--mc-stroke);background:rgba(255,255,255,.06);color:var(--mc-ink)}
      .mc-pill.on{background:linear-gradient(135deg,rgba(56,224,138,.28),rgba(56,224,138,.14));border-color:rgba(56,224,138,.5);color:var(--mc-c-ok,#8ff0b4)}
      .mc-pill-primary{background:linear-gradient(135deg,rgba(71,181,255,.3),rgba(71,181,255,.14));border-color:rgba(71,181,255,.5);color:#bfe6ff}
      .mc-chips{display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin:4px 0 20px}
      .mc-chip{background:rgba(255,255,255,.05);border:1px solid var(--mc-stroke);border-radius:20px;padding:6px 13px;font-size:12px;font-weight:700;color:var(--mc-ink)}
      .mc-tabs{display:flex;gap:8px;margin-bottom:12px}
      .mc-tab{flex:1;text-align:center;padding:7px;border-radius:10px;font-size:11.5px;font-weight:800;cursor:pointer;
        background:rgba(255,255,255,.05);border:1px solid var(--mc-stroke);color:var(--mc-muted)}
      .mc-tab.sel{background:linear-gradient(135deg,rgba(71,181,255,.25),rgba(71,181,255,.12));color:var(--mc-ink);border-color:transparent}
      .mc-chart{display:flex;align-items:flex-end;gap:3px;height:74px;margin-bottom:14px}
      .mc-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:3px;cursor:pointer}
      .mc-bar{width:100%;max-width:14px;border-radius:3px 3px 1px 1px;min-height:2px;background:linear-gradient(180deg,#47b5ff,#2a86c9);transition:background .2s}
      .mc-col.sel .mc-bar{background:linear-gradient(180deg,#ffcc66,#ffb020)}
      .mc-col.sel .mc-hl{color:var(--mc-ink)}
      .mc-hl{font-size:7.5px;color:var(--mc-muted);font-weight:700}
      .mc-avgrow{display:flex;justify-content:space-between;padding:11px 13px;background:rgba(255,255,255,.04);
        border-radius:12px;border:1px solid var(--mc-stroke);font-size:12.5px;font-weight:700;color:var(--mc-ink)}
      .mc-avgrow small{display:block;color:var(--mc-muted);font-weight:600;font-size:10px;margin-top:2px}
      .mc-empty{color:var(--mc-muted);font-size:12.5px;text-align:center;padding:18px 0}
      /* ------------------------------------------------------ accensioni */
      .mc-accgruppo{font-size:9.5px;font-weight:850;text-transform:uppercase;letter-spacing:.09em;
        color:var(--mc-muted);margin:20px 0 3px}
      .mc-accsomma{font-size:12px;font-weight:700;color:var(--mc-ink);margin-bottom:9px}
      .mc-accvuoto{font-size:12px;color:var(--mc-muted);padding:6px 0 2px}
      .mc-acclista{display:flex;flex-direction:column;gap:6px}
      .mc-chiedibtn{width:100%;margin:10px 0 2px;padding:11px;border-radius:13px;cursor:pointer;
        border:1px solid var(--mc-stroke);background:rgba(90,169,255,.12);color:inherit;font:inherit;font-size:13.5px;font-weight:800}
      .mc-chiedibtn:active{transform:scale(.99)}
      .mc-intervista{margin-top:10px}
      .mc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
      .mc-chip{padding:6px 10px;border-radius:999px;border:1px solid var(--mc-stroke);background:rgba(255,255,255,.05);
        color:inherit;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;text-align:left}
      .mc-chip.sel{background:rgba(90,169,255,.22);border-color:rgba(90,169,255,.5)}
      .mc-chat{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding:4px 2px}
      .mc-bolla{max-width:88%;padding:9px 12px;border-radius:15px;font-size:13px;line-height:1.5}
      .mc-bolla b{font-weight:800}
      .mc-mia{align-self:flex-end;background:rgba(90,169,255,.22);border-bottom-right-radius:5px}
      .mc-sua{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid var(--mc-stroke);border-bottom-left-radius:5px}
      .mc-oregraf{display:flex;align-items:flex-end;gap:1.5px;height:44px;margin-top:9px}
      .mc-oregraf i{flex:1;background:linear-gradient(180deg,#5aa9ff,rgba(90,169,255,.35));border-radius:2px 2px 0 0;min-height:3px}
      .mc-oreetichette{display:flex;justify-content:space-between;font-size:9.5px;opacity:.55;font-weight:700;margin-top:3px}
      .mc-riga-chiedi{display:flex;gap:6px;align-items:center}
      .mc-riga-chiedi input{flex:1;min-width:0;padding:9px 11px;border-radius:12px;border:1px solid var(--mc-stroke);
        background:rgba(255,255,255,.05);color:inherit;font:inherit;font-size:13px}
      .mc-freddo{padding:11px 12px;border-radius:13px;border:1px solid var(--mc-stroke);
        background:rgba(255,255,255,.05);border-left:3px solid var(--f-c)}
      .mc-freddot{font-size:13.5px;font-weight:900;color:var(--f-c)}
      .mc-freddol{margin:6px 0 0;padding-left:16px;font-size:12px;font-weight:700;line-height:1.45}
      .mc-freddon{margin-top:5px;font-size:12px;font-weight:700;opacity:.85;line-height:1.45}
      .mc-freddor{display:flex;flex-wrap:wrap;gap:12px;margin-top:9px}
      .mc-freddor>div{min-width:60px}
      .mc-freddor b{display:block;font-size:15px;font-weight:900}
      .mc-freddor small{display:block;font-size:10px;font-weight:700;opacity:.6}
      .mc-acc.apribile{cursor:pointer}
      .mc-acc.aperto{border-bottom-left-radius:0;border-bottom-right-radius:0}
      .mc-fasi{margin:-4px 0 8px;padding:10px 12px 8px;border-radius:0 0 13px 13px;
        background:rgba(255,255,255,.05);border:1px solid var(--mc-stroke);border-top:0}
      .mc-curva{display:block;width:100%;height:34px;color:var(--mc-accent,#5aa9ff);opacity:.8;margin-bottom:8px}
      .mc-fase{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0}
      .mc-faseora{opacity:.6;font-variant-numeric:tabular-nums;min-width:38px}
      .mc-fasen{flex:1;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mc-fased{font-weight:700;opacity:.85;min-width:44px;text-align:right}
      .mc-fasew{font-weight:700;opacity:.6;min-width:48px;text-align:right}
      .mc-fasenota{font-size:10.5px;opacity:.5;margin-top:6px}
      .mc-acc{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:13px;
        background:rgba(255,255,255,.04);border:1px solid var(--mc-stroke)}
      .mc-accora{flex:1;min-width:0;font-size:13px;font-weight:800;color:var(--mc-ink);
        font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px}
      .mc-accora span{opacity:.45;font-weight:600}
      .mc-accdur{flex:0 0 auto;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:20px;
        background:rgba(71,181,255,.16);border:1px solid rgba(71,181,255,.35);color:#bfe6ff}
      .mc-acckwh{flex:0 0 auto;text-align:right;font-size:12.5px;font-weight:800;color:var(--mc-ink);
        font-variant-numeric:tabular-nums}
      .mc-acckwh small{display:block;font-size:9.5px;font-weight:700;color:var(--mc-muted);margin-top:1px}
      /* ---------------------------------------------------------- timer */
      /* Visibile da subito, senza la classe "on" da accendere a mano: il
         foglio grande usa una transizione che non avanza se la scheda non e
         in primo piano, e resterebbe fuori schermo. Qui sale con
         un'animazione, che parte da sola. */
      .mc-scrim.mc-tmscrim{opacity:1;pointer-events:auto}
      .mc-scrim.mc-tmscrim .mc-modal{transform:none;animation:mc-sale .24s cubic-bezier(.32,.72,0,1)}
      @keyframes mc-sale{from{transform:translateY(100%)}to{transform:none}}
      .mc-tmbody{display:flex;flex-direction:column;gap:2px;color:var(--mc-ink)}
      .mc-tmh{display:flex;align-items:center;gap:10px}
      .mc-tmt{flex:1;font-size:18px;font-weight:850}
      .mc-tmx{width:30px;height:30px;border-radius:50%;flex:0 0 auto;cursor:pointer;font-size:14px;line-height:1;
        border:1px solid var(--mc-stroke);background:rgba(255,255,255,.06);color:var(--mc-ink)}
      .mc-tmsub{font-size:12.5px;font-weight:700;color:var(--mc-muted);margin-bottom:6px}
      .mc-tmavviso{margin:6px 0;padding:9px 12px;border-radius:12px;font-size:12px;font-weight:700;
        background:rgba(255,176,32,.14);border:1px solid rgba(255,176,32,.4);color:#ffd694}
      .mc-tmgruppo{font-size:9.5px;font-weight:850;text-transform:uppercase;letter-spacing:.09em;
        color:var(--mc-muted);margin-top:16px}
      .mc-tmnota{font-size:11.5px;line-height:1.45;color:var(--mc-muted);margin:3px 0 9px}
      .mc-tmrow2{display:flex;gap:10px}
      .mc-tmrow2 label{flex:1;display:flex;flex-direction:column;gap:5px;
        font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--mc-muted)}
      /* I campi ora del browser nascono chiari: senza questo, su fondo scuro
         restavano bianchi con le cifre invisibili. */
      .mc-tmin{padding:10px 11px;border-radius:12px;font:inherit;font-size:15px;font-weight:700;
        border:1px solid var(--mc-stroke);background:rgba(255,255,255,.06);color:var(--mc-ink);
        color-scheme:dark;width:100%;box-sizing:border-box}
      .mc-tmquick{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
      .mc-tmq{flex:1 1 46%;padding:11px 6px;border-radius:12px;cursor:pointer;font:inherit;
        font-size:12px;font-weight:800;border:1px solid var(--mc-stroke);
        background:rgba(255,255,255,.05);color:var(--mc-ink)}
      .mc-tmq:hover{border-color:rgba(255,176,32,.5);background:rgba(255,176,32,.12)}
      .mc-tmq:disabled{opacity:.5;cursor:default}
      .mc-tmgrid{display:grid;grid-template-columns:auto 1fr 1fr;gap:7px;align-items:center}
      .mc-tmlab{font-size:9.5px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;
        color:var(--mc-muted);text-align:center}
      .mc-tmgiorno{font-size:12.5px;font-weight:800;padding-right:6px;white-space:nowrap}
      .mc-tmazioni{display:flex;gap:8px;margin-top:20px}
      .mc-tmazioni .mc-cbtn{font-size:12.5px;padding:12px 0}

      @media(prefers-reduced-motion:reduce){.mc *{animation:none!important}}
    </style>
    <div class="mc">
      <div class="mc-card" data-icon="${this._esc(this._tipoIcona())}" data-mode="${this._esc(this._cfg.mode || "device")}" data-icona="${this._esc(this._modoIcona())}" data-role="tap">
        <button class="mc-info" data-role="info" title="Informazioni e impostazioni" hidden>⚙</button>
        <button class="mc-timer" data-role="timer" title="Timer di accensione e spegnimento" hidden>
          <ha-icon icon="mdi:timer-outline"></ha-icon></button>
        <div class="mc-iconwrap">${this._icon()}</div>
        <div class="mc-textwrap">
          <div class="mc-name">${this._esc(this._cfg.name)}</div>
          <div class="mc-badge" data-role="badge" hidden><span class="dot"></span><span class="lbl">—</span></div>
          <div class="mc-state" data-role="state">—</div>
          <div class="mc-sub" data-role="sub" hidden></div>
          <div class="mc-metric" data-role="metricwrap" hidden><span data-role="power"></span><small>W</small></div>
        </div>
      </div>
    </div>`;
    stopSwipeNavHijack(this.querySelector(".mc"));
    this._el = this.querySelector(".mc-card");
    // Un disegno d'ambiente e largo (800x500, 1000x600): dentro una tessera
    // quadrata ci starebbe con due bande vuote sopra e sotto. "slice" gli dice
    // di riempire e farsi ritagliare ai bordi, come una foto di copertina.
    const svg = this._el.querySelector(".mc-iconwrap svg");
    if (svg) {
      // "meet" ci sta dentro TUTTO INTERO. Prima usavo "slice", che riempie
      // ritagliando ai bordi: su una tessera quadrata un disegno largo 800x500
      // ci perdeva quasi il 40% della larghezza, e infatti della stanza si
      // vedeva solo la fetta centrale. Meglio vedere tutto il disegno.
      // "YMin" lo incolla in ALTO: lo spazio che avanza resta in basso, che e
      // proprio dove servono nome e temperatura.
      svg.setAttribute("preserveAspectRatio",
        this._modoIcona() === "piena" ? "xMidYMin meet" : "xMidYMid meet");
    }
    this._el.addEventListener("click", e => {
      if (e.target.closest('[data-role="badge"]') || e.target.closest('[data-role="info"]')
        || e.target.closest('[data-role="timer"]')) return;
      if (this._cfg.path) { this._navigate(this._cfg.path); return; }
      this._openImmersive();
    });
    const badge = this._el.querySelector('[data-role="badge"]');
    badge.onclick = e => { e.stopPropagation(); this._toggleChiesto(); };
    const infoBtn = this._el.querySelector('[data-role="info"]');
    infoBtn.onclick = e => { e.stopPropagation(); this._openMoreInfo(); };
    const timerBtn = this._el.querySelector('[data-role="timer"]');
    timerBtn.onclick = e => { e.stopPropagation(); this._openTimer(); };
  }

  // Stessa navigazione interna (senza ricaricare la pagina) che usa HA per
  // tap_action: navigate — così la Mini Card può fare anche da "collegamento"
  // a un'altra vista, come le card delle stanze nella Tablet Home.
  _navigate(path) {
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  // Priorità: un climatizzatore configurato vince su tutto perché la finestra
  // "informazioni" nativa di HA per un'entità climate È GIÀ un telecomando
  // completo (temperatura, modalità, ventola) — non serve costruircene uno.
  _priorityEntity() {
    const cfg = this._cfg;
    return cfg.climate || cfg.switch || cfg.power || cfg.temp || cfg.humidity || "";
  }
  _openMoreInfo() {
    const id = this._priorityEntity();
    if (!id) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _toggle() {
    const id = this._cfg.switch;
    const st = id && this._hass.states[id];
    if (!st) return;
    const dom = id.split(".")[0];
    // "toggle" non esiste per tutti: una serratura si sblocca o si blocca.
    if (dom === "lock") {
      this._hass.callService("lock", st.state === "locked" ? "unlock" : "lock", { entity_id: id });
      return;
    }
    this._hass.callService(dom, "toggle", { entity_id: id });
  }

  // Il tocco che accende o spegne davvero. Con la conferma attiva (di serie)
  // passa prima dal foglio; "!== false" perche le card create prima che
  // l'opzione esistesse non hanno il campo salvato e devono comportarsi
  // come le nuove.
  _toggleChiesto(dopo) {
    const fatto = () => { this._toggle(); if (dopo) dopo(); };
    if (this._cfg.conferma_accensione === false) { fatto(); return; }
    const acceso = this._isOn();
    const nome = this._cfg.name || "questo dispositivo";
    // Il consumo di adesso e la ragione per cui uno esita: se sta lavorando,
    // spegnere non e la stessa cosa che spegnere una presa ferma.
    const p = this._num(this._cfg.power);
    const sotto = acceso
      ? (p != null && p > 1 ? `Sta consumando ${Math.round(p)} W in questo momento.` : "La presa e accesa ma non sta consumando.")
      : "";
    this._confirm({
      titolo: acceso ? `Spegnere ${nome}?` : `Accendere ${nome}?`,
      sotto,
      azione: acceso ? "Spegni" : "Accendi",
      acceso,
    }, fatto);
  }

  // Agganciato a ".mc" e non alla tessera: .mc-card ha container-type, che
  // per le regole del web diventa il riferimento degli elementi position:fixed
  // e li chiude dentro i suoi bordi invece di lasciarli coprire lo schermo.
  // Nessun requestAnimationFrame e nessuna classe da accendere: il foglio
  // nasce visibile e l'entrata la fa un'animazione CSS, che parte anche se la
  // scheda non e in primo piano.
  _confirm(opz, siFai) {
    const o = typeof opz === "string" ? { titolo: opz } : opz;
    const vecchio = this.querySelector(".mc-scrim.mc-conf");
    if (vecchio) vecchio.remove();
    const ov = document.createElement("div");
    ov.className = "mc-scrim mc-conf";
    ov.innerHTML = `<div class="mc-conferma${o.acceso ? " spegni" : ""}">
      <div class="mc-conferma-icona">${this._icon()}</div>
      <div class="mc-conferma-tit">${this._esc(o.titolo)}</div>
      ${o.sotto ? `<div class="mc-conferma-sotto">${this._esc(o.sotto)}</div>` : ""}
      <div class="mc-conferma-row">
        <button class="mc-cbtn" data-no>Annulla</button>
        <button class="mc-cbtn si" data-si>
          <ha-icon icon="mdi:power"></ha-icon>${this._esc(o.azione || "Conferma")}
        </button>
      </div>
    </div>`;
    this.querySelector(".mc").appendChild(ov);
    const chiudi = () => ov.remove();
    ov.querySelector("[data-no]").onclick = e => { e.stopPropagation(); chiudi(); };
    ov.querySelector("[data-si]").onclick = e => { e.stopPropagation(); chiudi(); siFai(); };
    ov.onclick = e => { e.stopPropagation(); if (e.target === ov) chiudi(); };
  }

  // ====================================================================== timer
  // Non un conto alla rovescia del browser (morirebbe chiudendo la pagina, e
  // di notte il telefono dorme): AUTOMAZIONI VERE di Home Assistant, che
  // restano visibili e modificabili anche da Impostazioni. Stesso motore gia
  // collaudato sulla card del clima.
  //
  // Ogni giorno puo avere il suo orario: un trigger per giorno che porta l'id
  // del giorno, piu una condizione che accoppia "quale trigger e scattato" con
  // "che giorno e oggi". Cosi le azioni si scrivono una volta sola invece di
  // ripeterle sette volte.
  // Il servizio che accende o spegne, dominio per dominio: "valve.turn_on"
  // non esiste e l'orario programmato non avrebbe fatto niente.
  _srvOnOff(dom, acceso) {
    if (dom === "valve") return "valve." + (acceso ? "open_valve" : "close_valve");
    if (dom === "cover") return "cover." + (acceso ? "open_cover" : "close_cover");
    if (dom === "lock") return "lock." + (acceso ? "unlock" : "lock");
    return dom + (acceso ? ".turn_on" : ".turn_off");
  }

  _timerId(quale) {
    const slug = (this._cfg.switch || "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    return "mini_card_" + quale + "_" + slug;
  }

  // L'entita dell'automazione si ritrova dal suo id interno, non dal nome: il
  // nome lo slugifica Home Assistant e non e prevedibile.
  _timerEntita(quale) {
    const id = this._timerId(quale);
    return Object.keys(this._hass.states).find(e =>
      e.startsWith("automation.") && this._hass.states[e].attributes.id === id) || null;
  }

  _timerAcceso() {
    if (!this._hass || !this._cfg.switch) return false;
    return ["on", "off", "once_on", "once_off"].some(q => {
      const e = this._timerEntita(q);
      return e && this._hass.states[e].state === "on";
    });
  }

  async _leggiTimer(quale) {
    try { return await this._hass.callApi("get", "config/automation/config/" + this._timerId(quale)); }
    catch (e) { return null; }
  }

  _hhmm(v) { return typeof v === "string" ? v.slice(0, 5) : ""; }

  _leggiOrari(cfg) {
    const out = {};
    if (!cfg) return out;
    (cfg.triggers || cfg.trigger || []).forEach(tr => {
      if (!tr || !tr.id || typeof tr.at !== "string") return;
      out[tr.id] = this._hhmm(tr.at);
    });
    return out;
  }

  _primoOrario(cfg) {
    const tr = ((cfg && (cfg.triggers || cfg.trigger)) || [])[0];
    return tr && typeof tr.at === "string" ? this._hhmm(tr.at) : "";
  }

  // Un ordine singolo: scatta la prossima volta che l'orologio segna quell'ora
  // e poi si disattiva da solo.
  async _scriviSingolo(quale, ora) {
    if (!ora) {
      try { await this._hass.callApi("delete", "config/automation/config/" + this._timerId(quale)); } catch (e) { /* non c'era */ }
      return;
    }
    const acceso = quale === "once_on";
    const dom = this._cfg.switch.split(".")[0];
    await this._hass.callApi("post", "config/automation/config/" + this._timerId(quale), {
      id: this._timerId(quale),
      alias: "Mini Card - " + (acceso ? "accendi " : "spegni ") + (this._cfg.name || this._cfg.switch) + " (una volta)",
      description: "Creata da Mini Card. Ordine singolo: agisce una volta e poi si disattiva da sola.",
      mode: "single",
      triggers: [{ trigger: "time", at: ora.length === 5 ? ora + ":00" : ora }],
      conditions: [],
      actions: [
        { action: this._srvOnOff(dom, acceso), target: { entity_id: this._cfg.switch } },
        // "this.entity_id" e il modo giusto per farle riferire a se stessa
        // senza indovinare il nome che HA le dara.
        { action: "automation.turn_off", target: { entity_id: "{{ this.entity_id }}" }, data: { stop_actions: false } },
      ],
    });
  }

  async _scriviProgramma(quale, orari) {
    const giorni = Object.keys(orari).filter(g => orari[g]);
    // Niente orari per questo verso: l'automazione va tolta, non lasciata in
    // giro a scattare per conto suo.
    if (!giorni.length) {
      try { await this._hass.callApi("delete", "config/automation/config/" + this._timerId(quale)); } catch (e) { /* non c'era */ }
      return;
    }
    const acceso = quale === "on";
    const dom = this._cfg.switch.split(".")[0];
    await this._hass.callApi("post", "config/automation/config/" + this._timerId(quale), {
      id: this._timerId(quale),
      alias: "Mini Card - " + (acceso ? "accendi " : "spegni ") + (this._cfg.name || this._cfg.switch),
      description: "Creata da Mini Card. Un orario per giorno; i giorni lasciati vuoti non fanno niente.",
      mode: "single",
      triggers: giorni.map(g => ({ trigger: "time", at: orari[g] + ":00", id: g })),
      conditions: [{
        condition: "template",
        value_template: "{{ trigger.id == now().strftime('%a') | lower }}",
      }],
      actions: [{ action: this._srvOnOff(dom, acceso), target: { entity_id: this._cfg.switch } }],
    });
  }

  // "Spegni fra N minuti": l'attesa la fa l'automazione sul server, non il
  // browser. Il trigger di avvio serve solo a darle una forma valida; a farla
  // partire adesso e la chiamata a automation.trigger qui sotto.
  async _spegniFra(minuti) {
    const dom = this._cfg.switch.split(".")[0];
    await this._hass.callApi("post", "config/automation/config/" + this._timerId("once_off"), {
      id: this._timerId("once_off"),
      alias: "Mini Card - spegni " + (this._cfg.name || this._cfg.switch) + " fra " + minuti + " min",
      description: "Creata da Mini Card. Parte adesso, aspetta e spegne. Poi si disattiva da sola.",
      mode: "single",
      triggers: [{ trigger: "homeassistant", event: "start" }],
      conditions: [],
      actions: [
        { delay: { minutes: minuti } },
        { action: this._srvOnOff(dom, false), target: { entity_id: this._cfg.switch } },
        { action: "automation.turn_off", target: { entity_id: "{{ this.entity_id }}" }, data: { stop_actions: false } },
      ],
    });
    await new Promise(r => setTimeout(r, 700));
    const ent = this._timerEntita("once_off");
    if (ent) await this._hass.callService("automation", "trigger", { entity_id: ent, skip_condition: true });
  }

  async _openTimer() {
    const ov = document.createElement("div");
    ov.className = "mc-scrim mc-tmscrim";
    ov.innerHTML = `<div class="mc-modal"><div class="mc-sheet-handle"></div>
      <div class="mc-tmbody">Leggo il programma...</div></div>`;
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    this.querySelector(".mc").appendChild(ov);
    const body = ov.querySelector(".mc-tmbody");

    const cfgOn = await this._leggiTimer("on");
    const cfgOff = await this._leggiTimer("off");
    const cfgOnceOn = await this._leggiTimer("once_on");
    const cfgOnceOff = await this._leggiTimer("once_off");
    const orariOn = this._leggiOrari(cfgOn);
    const orariOff = this._leggiOrari(cfgOff);
    const onceOn = this._primoOrario(cfgOnceOn);
    const onceOff = this._primoOrario(cfgOnceOff);

    const GIORNI = [["mon", "Lunedi"], ["tue", "Martedi"], ["wed", "Mercoledi"], ["thu", "Giovedi"],
      ["fri", "Venerdi"], ["sat", "Sabato"], ["sun", "Domenica"]];
    const tutteEnt = () => ["on", "off", "once_on", "once_off"].map(q => this._timerEntita(q)).filter(Boolean);
    let attivo = tutteEnt().some(e => this._hass.states[e].state === "on");

    const disegna = () => {
      body.innerHTML = `
        <div class="mc-tmh">
          <div class="mc-tmt">Timer</div>
          <button class="mc-tmx" data-chiudi>&#10005;</button>
        </div>
        <div class="mc-tmsub">${this._esc(this._cfg.name || this._cfg.switch)}</div>
        ${attivo ? "" : `<div class="mc-tmavviso">I timer sono sospesi: non scatteranno finche non li riattivi.</div>`}

        <div class="mc-tmgruppo">Solo per stavolta</div>
        <div class="mc-tmnota">Scatta la prossima volta che l'orologio segna quell'ora, poi si spegne da solo.</div>
        <div class="mc-tmrow2">
          <label>Accendi alle<input type="time" class="mc-tmin" data-once="on" value="${onceOn}"></label>
          <label>Spegni alle<input type="time" class="mc-tmin" data-once="off" value="${onceOff}"></label>
        </div>
        <div class="mc-tmquick">
          ${[30, 60, 90, 120].map(m => `<button class="mc-tmq" data-fra="${m}">Spegni fra ${m} min</button>`).join("")}
        </div>

        <div class="mc-tmgruppo">Programma della settimana</div>
        <div class="mc-tmnota">Ogni giorno puo avere i suoi orari. Lascia vuoto per non fare niente quel giorno.</div>
        <div class="mc-tmgrid">
          <div class="mc-tmlab"></div><div class="mc-tmlab">Accendi</div><div class="mc-tmlab">Spegni</div>
          ${GIORNI.map(([k, nome]) => `
            <div class="mc-tmgiorno">${nome}</div>
            <input type="time" class="mc-tmin" data-on="${k}" value="${orariOn[k] || ""}">
            <input type="time" class="mc-tmin" data-off="${k}" value="${orariOff[k] || ""}">`).join("")}
        </div>

        <div class="mc-tmazioni">
          <button class="mc-cbtn" data-sospendi>${attivo ? "Sospendi" : "Riattiva"}</button>
          <button class="mc-cbtn" data-cancella>Cancella tutto</button>
          <button class="mc-cbtn si" data-salva>Salva</button>
        </div>`;

      body.querySelector("[data-chiudi]").onclick = () => ov.remove();

      body.querySelectorAll("[data-fra]").forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = "Imposto...";
        await this._spegniFra(parseInt(b.dataset.fra, 10));
        ov.remove();
      });

      body.querySelector("[data-sospendi]").onclick = async () => {
        const ent = tutteEnt();
        if (!ent.length) return;
        const srv = attivo ? "turn_off" : "turn_on";
        for (const e of ent) await this._hass.callService("automation", srv, { entity_id: e });
        await new Promise(r => setTimeout(r, 700));
        attivo = ent.some(e => this._hass.states[e] && this._hass.states[e].state === "on");
        disegna();
      };

      body.querySelector("[data-cancella]").onclick = () => {
        this._confirm({
          titolo: "Cancellare tutti i timer?",
          sotto: "Le automazioni create da questa card vengono rimosse.",
          azione: "Cancella", acceso: true,
        }, async () => {
          for (const q of ["on", "off", "once_on", "once_off"]) {
            try { await this._hass.callApi("delete", "config/automation/config/" + this._timerId(q)); } catch (e) { /* non c'era */ }
          }
          ov.remove();
        });
      };

      body.querySelector("[data-salva]").onclick = async () => {
        const b = body.querySelector("[data-salva]");
        b.disabled = true; b.textContent = "Salvo...";
        const leggi = attr => {
          const out = {};
          body.querySelectorAll("[data-" + attr + "]").forEach(i => { if (i.value) out[i.dataset[attr]] = i.value; });
          return out;
        };
        const once = {};
        body.querySelectorAll("[data-once]").forEach(i => { once[i.dataset.once] = i.value; });
        await this._scriviProgramma("on", leggi("on"));
        await this._scriviProgramma("off", leggi("off"));
        await this._scriviSingolo("once_on", once.on);
        await this._scriviSingolo("once_off", once.off);
        ov.remove();
      };
    };
    disegna();
  }

  // Un consumo che balla intorno alla soglia (un frigo che oscilla fra 8 e
  // 12W con la soglia a 10) faceva sfarfallare la card: accesa, spenta,
  // accesa, spenta, decine di volte al minuto — non un guasto, solo rumore
  // di misura preso troppo sul serio. Una soglia sola confondeva "sta
  // consumando" con "un singolo numero ha superato una riga": qui ne
  // servono due, una per accendersi e una piu bassa per spegnersi, cosi
  // il rumore che oscilla in mezzo non fa piu scattare niente. Si accende
  // sopra la soglia vera e si spegne solo sotto l'80% di quella soglia.
  _consumaOra(p, soglia) {
    if (p == null) return false;
    const giu = soglia * 0.8;
    const era = !!this.__consumaAttivo;
    const ora = era ? (p > giu) : (p > soglia);
    this.__consumaAttivo = ora;
    return ora;
  }

  // Stessa regola usata sia dalla tessera sia dal popup immersivo: presa/luce
  // vince se configurata, altrimenti la potenza sopra soglia.
  _isOn() {
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    const p = this._num(cfg.power);
    if (sw) return this._acceso(sw);
    if (cfg.power) return this._consumaOra(p, parseFloat(cfg.soglia) || 10);
    return false;
  }

  // Gli stati sono TRE, non due, e confonderli e' proprio l'errore che si
  // vedeva: un microonde con la presa accesa e il consumo a zero non sta
  // scaldando niente, ma l'icona si animava lo stesso come se lavorasse.
  //   staccata -> la presa e' spenta: l'apparecchio non riceve corrente
  //   attesa   -> ha corrente ma non sta facendo nulla (consumo sotto soglia)
  //   lavora   -> sta consumando davvero: e' qui che l'icona si anima
  // Senza sensore di potenza non si puo' distinguere attesa da lavoro:
  // acceso vuol dire lavora, com'era prima.
  // "piena" = il disegno riempie la card e le scritte gli stanno sopra.
  // "piccola" = il disegno sta in mezzo e le scritte sotto, come una tessera.
  // "auto" (com'era prima) = piena sulle stanze, piccola sugli apparecchi.
  _modoIcona() {
    const v = this._cfg.icona || "auto";
    if (v === "piena" || v === "piccola") return v;
    return this._cfg.mode === "room" ? "piena" : "piccola";
  }

  // LA DURATA DELL'IRRIGAZIONE. L'irrigatore la espone come "number" sul suo
  // dispositivo (minuti): si cambia da qui invece che dall'app Tuya.
  _numeroDurata() {
    const cfg = this._cfg, h = this._hass;
    if (cfg.durata) return cfg.durata;
    const reg = (h && h.entities) || {};
    const dev = (reg[cfg.switch] || {}).device_id;
    if (!dev) return "";
    return Object.keys(reg).find(e => e.startsWith("number.") && reg[e].device_id === dev &&
      h.states[e] && (/durat|duration|irrig|tempo/i.test(e) ||
        ["min", "minuti", "s"].includes(String(h.states[e].attributes.unit_of_measurement || "").toLowerCase()))) || "";
  }

  _eValvola() { return String(this._cfg.switch || "").startsWith("valve."); }

  // LO STORICO DELLE IRRIGAZIONI. Una valvola non consuma corrente, quindi
  // non c'e un grafico dei watt da cui ricavare le accensioni: le partenze si
  // leggono dallo stato (aperta -> chiusa) degli ultimi giorni.
  async _caricaIrrigazioni(giorni) {
    const h = this._hass, id = this._cfg.switch;
    if (!h || !id) return;
    const chiave = id + "|" + giorni;
    if (this._irrPer === chiave && Date.now() - (this._irrTs || 0) < 120000) return;
    this._irrPer = chiave;
    this._irrTs = Date.now();
    try {
      const fine = new Date();
      const inizio = new Date(fine.getTime() - giorni * 86400000);
      const res = await h.callWS({
        type: "history/history_during_period",
        start_time: inizio.toISOString(), end_time: fine.toISOString(),
        entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const punti = ((res && res[id]) || []).map(p => ({
        t: p.lu !== undefined ? p.lu * 1000 : new Date(p.last_updated || p.last_changed || p.lc).getTime(),
        s: p.s !== undefined ? p.s : p.state,
      })).filter(p => isFinite(p.t)).sort((a, b) => a.t - b.t);
      const giri = [];
      let apertura = null;
      punti.forEach(p => {
        const aperto = ["open", "opening", "on"].includes(p.s);
        if (aperto && apertura == null) apertura = p.t;
        else if (!aperto && apertura != null) { giri.push({ da: apertura, a: p.t }); apertura = null; }
      });
      if (apertura != null) giri.push({ da: apertura, a: Date.now(), inCorso: true });
      this._irrigazioni = giri.reverse();
    } catch (e) {
      this._irrigazioni = null;
    }
    if (this._ridisegnaFoglio) this._ridisegnaFoglio();
  }

  _irrigazioniHTML(giorni) {
    const g = this._irrigazioni;
    if (!g) return `<div class="mc-accgruppo">Irrigazioni</div>
      <div class="mc-accvuoto">Cerco le irrigazioni degli ultimi ${giorni} giorni…</div>`;
    if (!g.length) return `<div class="mc-accgruppo">Irrigazioni</div>
      <div class="mc-accvuoto">Nessuna irrigazione negli ultimi ${giorni} giorni.</div>`;
    const tot = g.reduce((a, x) => a + (x.a - x.da), 0);
    const giorno = t => new Date(t).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    const righe = g.slice(0, 12).map(x => `<div class="mc-acc">
      <div class="mc-accora">${this._ora(x.da)}<span>&rarr;</span>${x.inCorso ? "adesso" : this._ora(x.a)}</div>
      <div class="mc-accdur">${this._durata(x.a - x.da)}</div>
      <div class="mc-acckwh">${this._esc(giorno(x.da))}${x.inCorso ? "<small>sta irrigando</small>" : ""}</div>
    </div>`).join("");
    return `<div class="mc-accgruppo">Irrigazioni · ultimi ${giorni} giorni</div>
      <div class="mc-accsomma">${g.length === 1 ? "una irrigazione" : g.length + " irrigazioni"} · ${this._durata(tot)} d'acqua in tutto</div>
      <div class="mc-acclista">${righe}</div>`;
  }

  _durataHTML() {
    const id = this._numeroDurata();
    if (!id) return "";
    const st = this._hass.states[id];
    if (!st) return "";
    const u = st.attributes.unit_of_measurement || "min";
    const v = parseFloat(st.state);
    return `<div class="mc-accgruppo">Quanto irriga</div>
      <div class="mc-avgrow"><div>Durata di ogni irrigazione<small>la imposta il dispositivo, si chiude da solo</small></div>
        <div class="mc-durbox">
          <button class="mc-durbtn" data-dur="-">−</button>
          <b>${isNaN(v) ? "–" : Math.round(v)}<small>${this._esc(u)}</small></b>
          <button class="mc-durbtn" data-dur="+">+</button>
        </div></div>`;
  }

  _separaBatteria() {
    const cfg = this._cfg;
    this._batteriaId = "";
    if (cfg.power) {
      const s = this._hass && this._hass.states[cfg.power];
      const a = (s && s.attributes) || {};
      if (s && (a.device_class === "battery" || a.unit_of_measurement === "%")) {
        this._batteriaId = cfg.power;
        cfg.power = "";   // solo nella copia che gira: la configurazione salvata non si tocca
      }
    }
    // Un apparecchio a pile (gli irrigatori del giardino) la batteria ce
    // l'ha e basta: se non e stata scelta, la si prende dal suo dispositivo.
    if (!this._batteriaId && cfg.switch && this._hass && this._hass.entities) {
      const reg = this._hass.entities;
      const dev = (reg[cfg.switch] || {}).device_id;
      if (dev) {
        this._batteriaId = Object.keys(reg).find(e => e.startsWith("sensor.") && reg[e].device_id === dev &&
          this._hass.states[e] && this._hass.states[e].attributes.device_class === "battery") || "";
      }
    }
  }

  _stato() {
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    const p = this._num(cfg.power);
    const soglia = parseFloat(cfg.soglia) || 10;
    // UNA STANZA NON E' UN APPARECCHIO. Non ha una presa da staccare, quindi
    // finiva sempre in "staccata" e l'icona non si animava MAI: le stanze
    // restavano disegni fermi. Una stanza esiste sempre, quindi e sempre viva.
    // Se pero le hai dato un sensore di consumo, allora si comporta come un
    // apparecchio e l'animazione segue quello: la stanza si "accende" quando
    // dentro si sta consumando davvero.
    if (cfg.mode === "room") {
      if (cfg.power) return this._consumaOra(p, soglia) ? "lavora" : "attesa";
      return "lavora";
    }
    if (sw && !this._acceso(sw)) return "staccata";
    if (cfg.power) {
      const consuma = this._consumaOra(p, soglia);
      if (sw) return consuma ? "lavora" : "attesa";
      return consuma ? "lavora" : "staccata";
    }
    if (sw) return "lavora";
    return "staccata";
  }

  // COME SI CHIAMA la cosa che si accende. Un interruttore comanda una presa,
  // una luce o un rele: dire sempre "Accesa" faceva credere che fosse acceso
  // l'apparecchio, mentre e la presa ad avere corrente. Sono due cose diverse,
  // e su un microonde si vede subito: presa accesa, forno fermo.
  _comando() {
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    if (!sw) return null;
    const dom = String(cfg.switch).split(".")[0];
    const dc = (sw.attributes && sw.attributes.device_class) || "";
    // Un rele che comanda una luce resta un domain "switch" per Home
    // Assistant: il dominio da solo non basta, come si vede con "Luce
    // cucina" — un rele ZHA vero e proprio, senza device_class, che pero
    // accende una luce e diceva "Presa staccata" quando andava giu. Il
    // segnale che c'era gia era l'icona: chi ha configurato l'entita
    // in Home Assistant le ha messo una lampadina (mdi:lightbulb), e
    // quell'icona la si legge dallo stato, non si indovina dal nome.
    const ic = (sw.attributes && sw.attributes.icon) || "";
    const pareLuce = /light|lightbulb|ceiling|lamp/i.test(ic)
      || /\bluce\b|lampad|faretto|plafoniera/i.test(sw.attributes.friendly_name || "");
    if (dom === "valve") return dc === "water"
      ? { on: "Acqua aperta", off: "Acqua chiusa", giu: "Non risponde" }
      : { on: "Valvola aperta", off: "Valvola chiusa", giu: "Non risponde" };
    if (dom === "cover") return { on: "Aperta", off: "Chiusa", giu: "Non risponde" };
    if (dom === "lock") return { on: "Aperta", off: "Chiusa", giu: "Non risponde" };
    if (dom === "light" || pareLuce) return { on: "Luce accesa", off: "Luce spenta", giu: "Luce staccata" };
    if (dom === "input_boolean") return { on: "Comando attivo", off: "Comando spento", giu: "Comando spento" };
    if (dc === "switch") return { on: "Interruttore acceso", off: "Interruttore spento", giu: "Interruttore spento" };
    return { on: "Presa accesa", off: "Presa spenta", giu: "Presa staccata" };
  }

  // Testo di stato condiviso tra tessera e popup: su una card "Stanza" non
  // ha senso "Attivo/A riposo" (quasi sempre sopra soglia).
  _stateText(on) {
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    if (cfg.mode === "room") return cfg.path ? "Apri la vista →" : "";
    const c = this._comando();
    const st = this._stato();
    // Con presa E potenza si sa tutto: se ha corrente e se sta lavorando.
    if (sw && cfg.power) {
      if (st === "staccata") return c.giu;
      // "Acceso, in attesa" diceva acceso dell'apparecchio: e la presa a
      // essere accesa, l'apparecchio e fermo.
      return st === "lavora" ? "In funzione" : c.on + ", fermo";
    }
    // Senza sensore di potenza NON si sa se l'apparecchio lavora: si dice
    // soltanto quello che si sa, cioe com'e messo l'interruttore.
    if (sw) return on ? c.on : c.off;
    return cfg.power ? (on ? "Attivo" : "A riposo") : "";
  }

  // Il nome dell'APPARECCHIO, non quello del sensore.
  // Qui si sta dicendo CHI sta consumando, quindi si parte dal nome con cui
  // l'apparecchio si presenta — il friendly_name — e gli si toglie di dosso
  // solo la parola che dice cosa misura: "Frigo - power" diventa "Frigo",
  // "como camera da letto Power" diventa "Como camera da letto".
  //
  // Prima si partiva dal nome del DISPOSITIVO, ed era sbagliato: il
  // dispositivo si chiama "Shelly como camera da letto", cioe la marca piu
  // la stanza, mentre il friendly_name e il nome corto che si legge. Con
  // "Frigo" tornavano uguali per caso, e l'errore non si vedeva.
  // Il nome del dispositivo resta come ultima spiaggia, per i sensori che
  // un friendly_name non ce l'hanno.
  //
  // La parola si toglie solo dalla CODA, mai dalla testa e mai in mezzo:
  // togliendola anche in testa un "Power bank sala" diventerebbe "Bank
  // sala". Provato davvero su tutti i nomi di casa prima di scegliere.
  _nomeApparecchio(id) {
    const st = this._hass.states[id];
    const attr = (st && st.attributes) || {};
    let n = String(attr.friendly_name || "").trim();
    if (n) {
      const code = ["active power", "current consumption", "power", "potenza",
        "consumo", "consumption", "energy", "energia", "watt", "w"];
      let cambiato = true;
      while (cambiato) {
        cambiato = false;
        for (const c of code) {
          const q = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const coda = new RegExp("[\\s_·-]+" + q + "$", "i");
          if (coda.test(n) && n.replace(coda, "").trim()) { n = n.replace(coda, "").trim(); cambiato = true; }
        }
      }
      // Molti nomi arrivano tutti minuscoli ("como camera da letto"): la
      // prima lettera si alza, il resto si lascia com'e scritto.
      if (n) return n.charAt(0).toUpperCase() + n.slice(1);
    }
    return this._nomeDispositivo(id) || id;
  }

  // Il nome del dispositivo si legge dal registro, se il frontend ce l'ha
  // gia in casa. Non si fa una chiamata apposta: se l'informazione non c'e,
  // si torna indietro col nome ripulito, che va benissimo.
  _nomeDispositivo(id) {
    try {
      const ent = this._hass.entities && this._hass.entities[id];
      const devId = ent && ent.device_id;
      const dev = devId && this._hass.devices && this._hass.devices[devId];
      if (!dev) return null;
      return dev.name_by_user || dev.name || null;
    } catch (e) { return null; }
  }

  // Chip informative (temperatura/umidità/consumo oggi/chi consuma di più):
  // usate sia nella riga sotto il nome sulla tessera sia come "chip" grandi
  // nel popup immersivo — un solo calcolo, due presentazioni.
  _subParts() {
    const cfg = this._cfg;
    const t = this._num(cfg.temp), h = this._num(cfg.humidity);
    const todayKwh = (cfg.power && this._hist) ? (this._hist[this._dkey(new Date())] || 0) : null;
    const parts = [];
    const bat = this._batteriaId ? this._num(this._batteriaId) : null;
    if (bat != null) parts.push(`🔋 ${Math.round(bat)}%`);
    if (t != null) parts.push(`🌡️ ${this._fmt(t)}°C`);
    if (h != null) parts.push(`💧 ${Math.round(h)}%`);
    // Quando la stanza STA consumando la cosa che interessa e quanto tira
    // adesso, non quanto ha fatto da mezzanotte: i watt sono la risposta a
    // "cosa sta succedendo di la". Quando invece e ferma i watt sarebbero uno
    // zero inutile, e allora torna utile il totale del giorno.
    const oraW = this._num(cfg.power);
    const soglia = parseFloat(cfg.soglia) || 10;
    if (oraW != null && oraW > soglia) parts.push(`⚡ ${Math.round(oraW)} W`);
    else if (todayKwh != null) parts.push(`⚡ ${this._fmt(todayKwh)} kWh oggi`);
    if (cfg.group) {
      const g = this._hass.states[cfg.group];
      const members = (g && g.attributes && g.attributes.entity_id) || [];
      let best = null;
      members.forEach(id => {
        const v = this._num(id);
        if (v == null) return;
        if (!best || v > best.v) best = { v, name: this._nomeApparecchio(id) };
      });
      if (best && best.v > 1) parts.push(`🏆 ${this._esc(best.name)} ${Math.round(best.v)}W`);
    }
    return parts;
  }

  _update() {
    if (!this._el) return;
    this._aggiornaTema();
    this._separaBatteria();
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    const p = this._num(cfg.power);
    const on = this._isOn();
    const st = this._stato();
    this._el.classList.toggle("on", on);
    this._el.classList.toggle("piccola", cfg.taglia === "piccola");
    this._el.classList.toggle("quadrata", cfg.taglia === "quadrata");
    this._el.classList.toggle("lavora", st === "lavora");
    this._el.classList.toggle("attesa", st === "attesa");
    // La tinta di "sta lavorando" era sempre la stessa, che l'apparecchio
    // tirasse 15W o 1500W: un forno appena acceso e un forno a tutta
    // potenza si vedevano identici. Qui la tinta cresce con quanto sta
    // consumando davvero rispetto alla sua soglia: appena sopra resta
    // leggera, spinto resta piena. Il tetto e 7 volte la soglia — non un
    // numero magico per quell'apparecchio, ma abbastanza alto che pochi
    // elettrodomestici di casa lo tocchino mai, quindi la scala si sente
    // viva su tutti senza doverla tarare uno per uno.
    if (st === "lavora" && p != null) {
      const soglia = parseFloat(cfg.soglia) || 10;
      const intensita = Math.max(0.22, Math.min(1, (p - soglia) / (soglia * 6) + 0.22));
      this._el.style.setProperty("--mc-intensita", intensita.toFixed(2));
    } else {
      this._el.style.removeProperty("--mc-intensita");
    }
    this._el.querySelector('[data-role="state"]').textContent = this._stateText(on);

    const badge = this._el.querySelector('[data-role="badge"]');
    if (sw) {
      badge.hidden = false;
      badge.dataset.on = on ? "1" : "0";
      // Anche qui: "Accesa" da solo sembrava riferito all'apparecchio.
      const cmd = this._comando();
      badge.querySelector(".lbl").textContent = cmd ? (on ? cmd.on : cmd.off) : (on ? "Accesa" : "Spenta");
    } else badge.hidden = true;

    const metricWrap = this._el.querySelector('[data-role="metricwrap"]');
    if (cfg.power) {
      metricWrap.hidden = false;
      this._el.querySelector('[data-role="power"]').textContent = p != null ? Math.round(p) : "–";
    } else metricWrap.hidden = true;

    const t = this._num(cfg.temp), h = this._num(cfg.humidity);
    const sub = this._el.querySelector('[data-role="sub"]');
    const subParts = this._subParts();
    if (subParts.length) { sub.hidden = false; sub.innerHTML = subParts.join(" · "); }
    else sub.hidden = true;

    const infoBtn = this._el.querySelector('[data-role="info"]');
    infoBtn.hidden = !this._priorityEntity();

    // L'orologio compare solo se richiesto e solo se c'e qualcosa da accendere:
    // senza presa collegata un timer non avrebbe su cosa agire.
    const timerBtn = this._el.querySelector('[data-role="timer"]');
    timerBtn.hidden = !(this._cfg.mostra_timer && this._cfg.switch);
    if (!timerBtn.hidden) timerBtn.classList.toggle("attivo", this._timerAcceso());

    if (t != null) {
      // L'altezza del mercurio funziona su QUALSIASI icona (anche personalizzata)
      // che porti un elemento con data-role="mercury" — non serve conoscerne
      // i gradienti. Il cambio colore caldo/freddo invece punta a id fissi
      // (mcMercuryComfy ecc.) che esistono solo nell'icona "climate" nativa:
      // un'icona incollata ha id namespaced diversi, quindi quello scatta
      // solo per icon_type==="climate".
      const mercury = this._el.querySelector('[data-role="mercury"]');
      const bulb = this._el.querySelector('[data-role="bulb"]');
      if (mercury) {
        const lo = 5, hi = 35, bottom = 76, minH = 6, maxH = 46;
        const frac = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
        const hgt = minH + frac * (maxH - minH);
        mercury.setAttribute("height", hgt.toFixed(1));
        mercury.setAttribute("y", (bottom - hgt).toFixed(1));
      }
      if (this._tipoIcona() === "climate" && mercury && bulb) {
        const freddo = parseFloat(cfg.soglia_freddo), caldo = parseFloat(cfg.soglia_caldo);
        let cls = "Comfy";
        if (!isNaN(freddo) && t < freddo) cls = "Cold";
        else if (!isNaN(caldo) && t > caldo) cls = "Hot";
        mercury.setAttribute("fill", `url(#mcMercury${cls})`);
        bulb.setAttribute("fill", `url(#mcBulb${cls})`);
      }
    }
  }

  // Popup immersivo (a schermo intero, non più il piccolo riquadro centrato):
  // icona grande e animata, azioni rapide (accendi/spegni, informazioni,
  // apri vista), le chip informative della stanza/dispositivo, poi lo
  // storico consumi già esistente se c'è un sensore di potenza.
  _openImmersive() {
    const cfg = this._cfg;
    let ov = this.querySelector(".mc-scrim");
    if (!ov) { ov = document.createElement("div"); ov.className = "mc-scrim"; this.querySelector(".mc").appendChild(ov); }
    let period = "7";
    // null = nessun giorno scelto a mano -> mostra "Oggi" (l'ultima barra).
    let selectedIdx = null;
    let vista = "storico";
    const render = () => {
      const on = this._isOn();
      const st = this._stato();
      const heroIconCls = "mc-hero-icon mc-card" + (cfg.mode === "room" ? " mc-hero-icon-room" : "")
        + (on ? " on" : "") + (st === "lavora" ? " lavora" : "") + (st === "attesa" ? " attesa" : "");
      const actions = [];
      // "⏻" (il simbolo di accensione unicode) non ce l'hanno tutti i font: su
      // certi telefoni resta un quadratino vuoto al posto dell'icona, come si
      // e visto. mdi:power e un disegno vero, non un carattere che dipende
      // da quali simboli il sistema ha deciso di includere: si vede uguale
      // dappertutto, come tutte le altre icone di questo pannello.
      if (cfg.switch) actions.push(`<button class="mc-pill${on ? " on" : ""}" data-act="toggle"><ha-icon icon="mdi:power"></ha-icon> ${on ? "Spegni" : "Accendi"}</button>`);
      if (this._priorityEntity()) actions.push(`<button class="mc-pill" data-act="info">⚙ Informazioni</button>`);
      if (cfg.mode === "room" && cfg.path) actions.push(`<button class="mc-pill mc-pill-primary" data-act="nav">Apri la vista →</button>`);
      const chips = this._subParts().map(p => `<div class="mc-chip">${p}</div>`).join("");

      const heroHTML = `
        <div class="mc-sheet-handle"></div>
        <button class="mc-x mc-x-abs" data-act="close">✕</button>
        <div class="mc-hero">
          <div class="${heroIconCls}" data-icon="${this._esc(this._tipoIcona())}">${this._icon()}</div>
          <div class="mc-hero-name">${this._esc(cfg.name)}</div>
          <div class="mc-hero-state${on ? " on" : ""}">${this._stateText(on)}</div>
        </div>
        ${actions.length ? `<div class="mc-actions-row">${actions.join("")}</div>` : ""}
        ${chips ? `<div class="mc-chips">${chips}</div>` : ""}`;

      if (!cfg.power) {
        // Una valvola (l'irrigatore) non ha watt ma ha una storia: quando ha
        // irrigato e per quanto, e la durata da cambiare senza l'app Tuya.
        if (this._eValvola()) {
          this._ridisegnaFoglio = render;
          this._caricaIrrigazioni(7);
          ov.innerHTML = `<div class="mc-modal">${heroHTML}
            ${this._durataHTML()}
            ${this._irrigazioniHTML(7)}</div>`;
          wire();
          ov.querySelectorAll("[data-dur]").forEach(b => b.onclick = () => {
            const id = this._numeroDurata();
            const st = id && this._hass.states[id];
            if (!st) return;
            const passo = parseFloat(st.attributes.step) || 1;
            const min = st.attributes.min != null ? parseFloat(st.attributes.min) : 1;
            const max = st.attributes.max != null ? parseFloat(st.attributes.max) : 999;
            const v = parseFloat(st.state) || 0;
            const nuovo = Math.min(max, Math.max(min, v + (b.dataset.dur === "+" ? passo : -passo)));
            this._hass.callService("number", "set_value", { entity_id: id, value: nuovo });
            setTimeout(render, 700);
          });
          return;
        }
        ov.innerHTML = `<div class="mc-modal">${heroHTML}</div>`;
        wire();
        return;
      }
      if (vista === "intervista") {
        ov.innerHTML = `<div class="mc-modal">${heroHTML}
          <button type="button" class="mc-chiedibtn" data-torna>Torna ai consumi</button>
          ${this._intervistaHTML()}</div>`;
        wire();
        this._ridisegnaFoglio = render;
        ov.querySelector("[data-torna]").onclick = () => { vista = "storico"; render(); };
        const chiedi = async (intento, testo, periodo) => {
          this._chat = this._chat || [];
          this._chat.push({ chi: "io", t: testo });
          this._chat.push({ chi: "lui", t: "<i>ci penso…</i>" });
          render();
          const r = await this._rispondi(intento, periodo || this._perNome || "7");
          this._chat[this._chat.length - 1] = { chi: "lui", t: r };
          render();
          const c = ov.querySelector(".mc-chat");
          if (c) c.scrollTop = c.scrollHeight;
        };
        ov.querySelectorAll("[data-per]").forEach(el => el.onclick = () => {
          this._perNome = el.dataset.per; render();
        });
        ov.querySelectorAll("[data-dom]").forEach(el => el.onclick = () => chiedi(el.dataset.dom, el.textContent.trim()));
        const inviaTesto = () => {
          const inp = ov.querySelector("#mc_chiedi");
          const testo = (inp.value || "").trim();
          if (!testo) return;
          inp.value = "";
          const c = this._capisci(testo);
          if (!c.intento && (c.dubbio || !c.periodo)) {
            this._chat = this._chat || [];
            this._chat.push({ chi: "io", t: testo });
            this._chat.push({ chi: "lui", t: "Questa non l'ho capita. Prova con uno dei tasti qui sotto, oppure scrivi per esempio \"quanto hai consumato il 20 agosto\", \"quante volte ti sei acceso ieri\" o \"in che ore consumi di piu\"." });
            render();
            return;
          }
          if (c.periodo) this._perNome = c.periodo;
          chiedi(c.intento || "totale", testo, c.periodo);
        };
        ov.querySelector("[data-invia]").onclick = inviaTesto;
        ov.querySelector("#mc_chiedi").onkeydown = e => { if (e.key === "Enter") inviaTesto(); };
        return;
      }
      const daily = this._hist || {};
      const days = parseInt(period);
      const today = new Date();
      const bars = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000);
        bars.push({ label: this._dlabel(d), v: daily[this._dkey(d)] || 0 });
      }
      const mx = Math.max(...bars.map(b => b.v), 0.05);
      const totKwh = bars.reduce((a, b) => a + b.v, 0);
      const avgDay = totKwh / days;
      const idx = selectedIdx == null ? bars.length - 1 : Math.min(selectedIdx, bars.length - 1);
      const selBar = bars[idx];
      const selLabel = idx === bars.length - 1 ? "Oggi" : selBar.label;
      const selKey = this._dkey(new Date(today.getTime() - (bars.length - 1 - idx) * 86400000));
      const chartHTML = bars.map((b, i) => {
        const hp = Math.max(2, Math.round(b.v / mx * 100));
        const showLbl = days <= 7 || i % Math.ceil(days / 7) === 0;
        return `<div class="mc-col${i === idx ? " sel" : ""}" data-i="${i}"><div class="mc-bar" style="height:${hp}%"></div>
          <div class="mc-hl">${showLbl ? b.label.split(" ")[1] : ""}</div></div>`;
      }).join("");
      ov.innerHTML = `<div class="mc-modal">
        ${heroHTML}
        <div class="mc-mh"><div style="font-size:11px;color:var(--mc-muted)">${this._fmt(totKwh)} kWh negli ultimi ${days} giorni · ${this._fmtE(totKwh)}</div></div>
        <div class="mc-tabs">
          <div class="mc-tab${period === "7" ? " sel" : ""}" data-p="7">7 giorni</div>
          <div class="mc-tab${period === "30" ? " sel" : ""}" data-p="30">30 giorni</div>
        </div>
        <div class="mc-chart">${chartHTML}</div>
        <div class="mc-avgrow"><div>${this._esc(selLabel)}<small>tocca una barra per vedere quel giorno</small></div>
          <div style="text-align:right">${this._fmt(selBar.v)} kWh<small>${this._fmtE(selBar.v)}</small></div></div>
        <div class="mc-avgrow" style="margin-top:8px;opacity:.7"><div>Media al giorno<small>stima su ${days} giorni</small></div>
          <div style="text-align:right">${this._fmt(avgDay)} kWh<small>${this._fmtE(avgDay)}/giorno</small></div></div>
        ${this._eFreddo() ? this._freddoHTML() : ""}
        <button type="button" class="mc-chiedibtn" data-intervista>Fai una domanda a ${this._esc(this._nomeSuo())}</button>
        ${this._accensioniHTML(selKey, selLabel)}
      </div>`;
      wire();
      const btnI = ov.querySelector("[data-intervista]");
      if (btnI) btnI.onclick = () => { vista = "intervista"; render(); };
      // Le accensioni arrivano dopo: quando arrivano, il foglio si ridisegna.
      this._ridisegnaFoglio = render;
      ov.querySelectorAll(".mc-tab").forEach(el => el.onclick = () => { period = el.dataset.p; selectedIdx = null; render(); });
      ov.querySelectorAll(".mc-col").forEach(el => el.onclick = () => { selectedIdx = parseInt(el.dataset.i, 10); render(); });
      // Tocco su un'accensione: si apre e racconta le fasi di quel ciclo.
      ov.querySelectorAll("[data-ciclo]").forEach(el => el.onclick = () => {
        const k = selKey + "|" + el.dataset.ciclo;
        this._cicloAperto = this._cicloAperto === k ? null : k;
        render();
      });
    };
    // Azioni condivise da entrambe le versioni del contenuto (con/senza
    // storico consumi): chiudi, accendi/spegni, apri informazioni native,
    // naviga alla vista collegata.
    // Chiudere vuol dire ricominciare: una chat vecchia riaperta domani non
    // dice niente, e i dati del periodo vanno riletti.
    const azzera = () => {
      vista = "storico";
      this._chat = [];
      this._perNome = null;
      this._cache = null;
    };
    const wire = () => {
      const close = () => { ov.classList.remove("on"); azzera(); };
      const q = sel => ov.querySelector(sel);
      if (q('[data-act="close"]')) q('[data-act="close"]').onclick = close;
      if (q('[data-act="toggle"]')) q('[data-act="toggle"]').onclick = () =>
        this._toggleChiesto(() => setTimeout(render, 900));
      if (q('[data-act="info"]')) q('[data-act="info"]').onclick = () => { close(); this._openMoreInfo(); };
      if (q('[data-act="nav"]')) q('[data-act="nav"]').onclick = () => { close(); this._navigate(cfg.path); };
    };
    render();
    requestAnimationFrame(() => ov.classList.add("on"));
    ov.onclick = e => { if (e.target === ov) { ov.classList.remove("on"); azzera(); } };
  }
}
customElements.define("mini-card", MiniCard);

// ===========================================================================
// Editor
// ===========================================================================
class MiniCardEditor extends HTMLElement {
  _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // HA richiama setConfig() sull'editor anche quando il cambiamento arriva
  // dall'editor stesso (il giro config-changed → HA → setConfig di ritorno).
  // Se in quel caso rifacciamo innerHTML da capo, l'input perde il fuoco a
  // ogni carattere digitato — su telefono si vede la tastiera che si chiude
  // e riapre a ogni lettera. _internalChange marca quei giri di ritorno e
  // salta il ridisegno: il DOM (e il fuoco) restano quelli che l'utente sta
  // già usando.
  setConfig(config) {
    const merged = Object.assign({}, MC_DEFAULTS, config || {});
    if (this._internalChange) {
      this._internalChange = false;
      this._config = merged;
      return;
    }
    this._config = merged;
    // Se l'icona attuale è già diversa da quella che il nome suggerirebbe
    // (e non è il default "generic"), trattiamola come scelta a mano
    // dall'utente: digitare altro nel nome non gliela deve più cambiare.
    this._iconManuallySet = merged.icon_type !== "generic" && merged.icon_type !== mcSuggestIcon(merged.name);
    // Stessa logica per presa e sensore potenza: se sono già configurati non
    // li tocchiamo più scrivendo nel nome; se sono vuoti, restano candidati
    // per l'auto-abbinamento (vedi #f_name più sotto).
    this._switchManuallySet = !!merged.switch;
    this._powerManuallySet = !!merged.power;
    this._render();
  }
  set hass(h) {
    this._hass = h;
    if (h && this._config && !this._built) { this._render(); this._built = true; }
    if (h && !MC_ICONE_MIE && !this._iconeLoading) {
      this._iconeLoading = true;
      mcIconeCarica(h).then(() => { this._iconeLoading = false; if (this._built) this._ridisegnaIcone(); });
    }
    if (h && !this._navTargets && !this._navLoading) {
      this._navLoading = true;
      mcLoadNavTargets(h).then(targets => {
        this._navTargets = targets;
        this._navLoading = false;
        if (this._built) this._render();
      });
    }
  }

  _emit() { this._internalChange = true; this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _set(key, val) { this._config = Object.assign({}, this._config, { [key]: val }); this._emit(); }

  _entityName(id) {
    const hs = this._hass ? this._hass.states : {};
    return (hs[id] && hs[id].attributes && hs[id].attributes.friendly_name) || id;
  }

  // Picker con ricerca: un campo di testo che filtra live invece di uno
  // <select> nativo con centinaia di voci da scorrere (Cristian ha 1242
  // sensori, 377 switch...). Il markup va dentro un contenitore con
  // data-field="<chiave di config>"; _wirePicker lo rende interattivo dopo
  // l'inserimento nel DOM.
  _pickerHTML(field, domainPrefixes, sel, label, hint) {
    const shown = sel ? this._esc(this._entityName(sel)) : "";
    return `<div class="fld mc-picker" data-field="${field}" data-domains="${domainPrefixes.join(",")}">
      <label>${label}</label>${hint ? `<span class="h">${hint}</span>` : ""}
      <div class="mc-pickwrap">
        <input type="text" class="mc-search" autocomplete="off" placeholder="Cerca sensore o dispositivo..." value="${shown}">
        <button type="button" class="mc-clear" title="Svuota" ${sel ? "" : "hidden"}>✕</button>
        <div class="mc-optlist" hidden></div>
      </div>
    </div>`;
  }

  _wirePicker(container) {
    const field = container.dataset.field;
    const domainPrefixes = container.dataset.domains.split(",");
    const input = container.querySelector(".mc-search");
    const list = container.querySelector(".mc-optlist");
    const clearBtn = container.querySelector(".mc-clear");
    const hs = this._hass ? this._hass.states : {};
    let ids = Object.keys(hs).filter(id => domainPrefixes.some(p => id.startsWith(p)));
    // Con un Dispositivo scelto, propone SOLO le sue entità (non più tutta
    // casa) — se però quel dispositivo non ne ha di questo dominio, torna
    // alla ricerca globale invece di lasciare la lista vuota.
    const deviceId = this._config.device_id;
    if (deviceId && this._hass && this._hass.entities) {
      const scoped = ids.filter(id => this._hass.entities[id] && this._hass.entities[id].device_id === deviceId);
      if (scoped.length) ids = scoped;
    }
    const renderList = filterText => {
      const f = (filterText || "").toLowerCase().trim();
      const matches = (f === "" ? ids : ids.filter(id =>
        this._entityName(id).toLowerCase().includes(f) || id.toLowerCase().includes(f)
      )).slice(0, 80);
      list.innerHTML = matches.length
        ? matches.map(id => `<div class="mc-opt" data-val="${id}">${this._esc(this._entityName(id))}
            <small>${id}</small></div>`).join("")
        : `<div class="mc-opt mc-opt-empty">Nessun risultato</div>`;
      list.hidden = false;
    };
    input.addEventListener("focus", () => renderList(input.value === this._esc(this._entityName(this._config[field] || "")) ? "" : input.value));
    input.addEventListener("input", () => renderList(input.value));
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
    list.addEventListener("mousedown", e => {
      const opt = e.target.closest(".mc-opt[data-val]");
      if (!opt) return;
      e.preventDefault();
      const val = opt.dataset.val;
      input.value = this._entityName(val);
      list.hidden = true;
      clearBtn.hidden = false;
      // Scelta fatta a mano: da qui in poi scrivere nel nome non deve più
      // toccare questo campo (vale solo per presa e potenza, gli unici che
      // l'auto-abbinamento riempie da solo).
      if (field === "switch") this._switchManuallySet = true;
      if (field === "power") this._powerManuallySet = true;
      this._set(field, val);
    });
    clearBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      input.value = "";
      clearBtn.hidden = true;
      // Svuotato a mano: torna candidato per l'auto-abbinamento dal nome.
      if (field === "switch") this._switchManuallySet = false;
      if (field === "power") this._powerManuallySet = false;
      this._set(field, "");
    });
  }

  _deviceName(id) {
    const d = this._hass && this._hass.devices && this._hass.devices[id];
    return (d && (d.name_by_user || d.name)) || id;
  }

  // Picker del Dispositivo vero (registro dispositivi di HA, non nomi
  // indovinati): scegliendolo, propone da solo presa/potenza/temperatura/
  // umidità/climatizzatore prendendoli SOLO tra le entità di quel
  // dispositivo — invece di cercare per assonanza sul nome in tutta casa.
  _devicePickerHTML(sel) {
    const shown = sel ? this._esc(this._deviceName(sel)) : "";
    return `<div class="fld mc-devpicker">
      <label>Dispositivo</label>
      <span class="h">Scegli il dispositivo vero: presa/potenza/temperatura/climatizzatore vengono proposti da soli tra le sue entità</span>
      <div class="mc-pickwrap">
        <input type="text" class="mc-search" autocomplete="off" placeholder="Cerca dispositivo..." value="${shown}">
        <button type="button" class="mc-clear" title="Svuota" ${sel ? "" : "hidden"}>✕</button>
        <div class="mc-optlist" hidden></div>
      </div>
    </div>`;
  }

  _wireDevicePicker(container) {
    const input = container.querySelector(".mc-search");
    const list = container.querySelector(".mc-optlist");
    const clearBtn = container.querySelector(".mc-clear");
    const devices = (this._hass && this._hass.devices) || {};
    const entities = (this._hass && this._hass.entities) || {};
    const ids = Object.keys(devices);
    const renderList = filterText => {
      const f = (filterText || "").toLowerCase().trim();
      const matches = (f === "" ? ids : ids.filter(id => this._deviceName(id).toLowerCase().includes(f))).slice(0, 80);
      list.innerHTML = matches.length
        ? matches.map(id => `<div class="mc-opt" data-val="${id}">${this._esc(this._deviceName(id))}</div>`).join("")
        : `<div class="mc-opt mc-opt-empty">Nessun risultato — questa versione di Home Assistant potrebbe non esporre ancora il registro dispositivi alla card</div>`;
      list.hidden = false;
    };
    input.addEventListener("focus", () => renderList(input.value === this._esc(this._deviceName(this._config.device_id || "")) ? "" : input.value));
    input.addEventListener("input", () => renderList(input.value));
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
    list.addEventListener("mousedown", e => {
      const opt = e.target.closest(".mc-opt[data-val]");
      if (!opt) return;
      e.preventDefault();
      const deviceId = opt.dataset.val;
      const devEntities = Object.keys(entities).filter(id => entities[id] && entities[id].device_id === deviceId);
      const byDomain = p => devEntities.find(id => id.startsWith(p));
      const byClass = (prefix, cls) => devEntities.find(id => id.startsWith(prefix) &&
        this._hass.states[id] && this._hass.states[id].attributes && this._hass.states[id].attributes.device_class === cls);
      const updates = { device_id: deviceId };
      if (!this._switchManuallySet) updates.switch = byDomain("switch.") || byDomain("light.") || "";
      if (!this._powerManuallySet) updates.power = byClass("sensor.", "power") || "";
      updates.temp = byClass("sensor.", "temperature") || "";
      updates.humidity = byClass("sensor.", "humidity") || "";
      updates.climate = byDomain("climate.") || "";
      this._config = Object.assign({}, this._config, updates);
      this._emit();
      this._render();
    });
    clearBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      this._set("device_id", "");
      this._render();
    });
  }

  // Picker delle viste (dashboard+percorso vero) per il campo "Collegamento":
  // stessa esperienza di ricerca degli altri campi, invece di un testo libero
  // dove bisogna sapere a memoria il path esatto.
  _navLabel(path) {
    if (!path) return "";
    const t = (this._navTargets || []).find(x => x.path === path);
    return t ? t.label : path;
  }

  _navPickerHTML(sel) {
    const shown = sel ? this._esc(this._navLabel(sel)) : "";
    return `<div class="fld mc-navpicker">
      <label>Collegamento ad un'altra vista — opzionale</label>
      <span class="h">Cerca la vista di destinazione: se la scegli, toccare la card ti porta lì invece di aprire lo storico consumi</span>
      <div class="mc-pickwrap">
        <input type="text" class="mc-search" autocomplete="off" placeholder="Cerca una vista..." value="${shown}">
        <button type="button" class="mc-clear" title="Svuota" ${sel ? "" : "hidden"}>✕</button>
        <div class="mc-optlist" hidden></div>
      </div>
    </div>`;
  }

  _wireNavPicker(container) {
    const input = container.querySelector(".mc-search");
    const list = container.querySelector(".mc-optlist");
    const clearBtn = container.querySelector(".mc-clear");
    const renderList = filterText => {
      const targets = this._navTargets || [];
      const f = (filterText || "").toLowerCase().trim();
      const matches = (f === "" ? targets : targets.filter(t =>
        t.label.toLowerCase().includes(f) || t.path.toLowerCase().includes(f)
      )).slice(0, 80);
      list.innerHTML = matches.length
        ? matches.map(t => `<div class="mc-opt" data-val="${this._esc(t.path)}">${this._esc(t.label)}<small>${this._esc(t.path)}</small></div>`).join("")
        : `<div class="mc-opt mc-opt-empty">${targets.length ? "Nessun risultato" : "Sto caricando le viste…"}</div>`;
      list.hidden = false;
    };
    input.addEventListener("focus", () => renderList(""));
    input.addEventListener("input", () => renderList(input.value));
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
    list.addEventListener("mousedown", e => {
      const opt = e.target.closest(".mc-opt[data-val]");
      if (!opt) return;
      e.preventDefault();
      const path = opt.dataset.val;
      input.value = this._navLabel(path);
      list.hidden = true;
      clearBtn.hidden = false;
      this._set("path", path);
    });
    clearBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      input.value = "";
      clearBtn.hidden = true;
      this._set("path", "");
    });
  }

  _iconGridHTML(sel, hasCustom) {
    const types = Object.keys(MC_ICON_RENDER);
    const mie = MC_ICONE_MIE || [];
    const idOra = (this._config && this._config.custom_icon_id) || "";
    // Le tue vengono prima: sono quelle che stai cercando quando apri qui.
    const miei = mie.map(ic => `
      <div class="mc-iconmio">
        <button type="button" class="mc-iconbtn${idOra === ic.id ? " sel" : ""}" data-mia="${this._esc(ic.id)}" title="${this._esc(ic.nome)}">
          <span class="mc-iconbtn-wrap">${mcNamespaceCustomSvg(ic.svg || "")}</span>
          <span class="mc-iconbtn-lbl">${this._esc(ic.nome)}</span>
        </button>
        <button type="button" class="mc-iconx" data-elimina="${this._esc(ic.id)}" title="Togli dalla raccolta">✕</button>
      </div>`).join("");
    const customBtn = `
      <button type="button" class="mc-iconbtn${hasCustom && !idOra ? " sel" : ""}" data-icon="custom" title="Incollane una nuova">
        <span class="mc-iconbtn-wrap">${MC_CUSTOM_BADGE_SVG}</span>
        <span class="mc-iconbtn-lbl">Nuova</span>
      </button>`;
    // Automatica: l'icona la sceglie il nome (e si vede quale). Resta cosi
    // finche non se ne tocca una a mano.
    const c = this._config || {};
    const auto = !hasCustom && !c.icon_manuale;
    const autoTipo = mcIconaIntelligente(c, this._hass) || c.icon_type || "generic";
    const autoBtn = `
      <button type="button" class="mc-iconbtn${auto ? " sel" : ""}" data-icon="auto" title="La sceglie il nome">
        <span class="mc-iconbtn-wrap">${mcIconFor(autoTipo)}</span>
        <span class="mc-iconbtn-lbl">Automatica</span>
      </button>`;
    return `<div class="mc-icongrid" id="f_icongrid">${autoBtn}${miei}${customBtn}${types.map(t => `
      <button type="button" class="mc-iconbtn${!auto && !hasCustom && t === sel ? " sel" : ""}" data-icon="${t}" title="${MC_ICON_LABELS[t]}">
        <span class="mc-iconbtn-wrap">${mcIconFor(t)}</span>
        <span class="mc-iconbtn-lbl">${MC_ICON_LABELS[t]}</span>
      </button>`).join("")}</div>`;
  }

  // Solo la griglia, non tutto il modulo: ridisegnare il form intero mentre si
  // scrive fa perdere il fuoco alla tastiera.
  _ridisegnaIcone() {
    const vecchia = this.querySelector("#f_icongrid");
    if (!vecchia) return;
    const c = this._config;
    const tmp = document.createElement("div");
    tmp.innerHTML = this._iconGridHTML(c.icon_type, !!(c.custom_icon_svg || "").trim());
    vecchia.replaceWith(tmp.firstElementChild);
    this._wireIcone();
  }

  // Tutti i comandi della griglia icone. Sta a parte perche la griglia si
  // ridisegna da sola quando la raccolta cambia, e i comandi vanno riattaccati.
  _wireIcone() {
    const climateRow = () => this.querySelector("#f_climaterow");
    const customWrap = () => this.querySelector("#f_customwrap");

    this.querySelectorAll(".mc-iconbtn[data-icon]").forEach(btn => btn.addEventListener("click", () => {
      this._iconManuallySet = true;
      this.querySelectorAll(".mc-iconbtn").forEach(b => b.classList.toggle("sel", b === btn));
      if (btn.dataset.icon === "custom") {
        if (customWrap()) customWrap().hidden = false;
        // Non si tocca icon_type finche non c'e davvero un SVG incollato:
        // altrimenti una card senza SVG mostrerebbe un tipo "custom" vuoto.
        const svg = this.querySelector("#f_customsvg");
        if (svg && svg.value.trim()) this._set("custom_icon_svg", svg.value);
      } else if (btn.dataset.icon === "auto") {
        if (customWrap()) customWrap().hidden = true;
        this._iconManuallySet = false;
        this._config = Object.assign({}, this._config, { custom_icon_svg: "", custom_icon_id: "", icon_manuale: false });
        this._emit();
      } else {
        if (customWrap()) customWrap().hidden = true;
        this._config = Object.assign({}, this._config,
          { custom_icon_svg: "", custom_icon_id: "", icon_type: btn.dataset.icon, icon_manuale: true });
        if (climateRow()) climateRow().hidden = btn.dataset.icon !== "climate";
        this._emit();
      }
    }));

    // Un'icona della raccolta: la card si porta dietro il disegno, non solo il
    // riferimento, cosi resta a posto anche se un giorno la raccolta cambia.
    this.querySelectorAll("[data-mia]").forEach(btn => btn.addEventListener("click", () => {
      const ic = (MC_ICONE_MIE || []).find(x => x.id === btn.dataset.mia);
      if (!ic) return;
      this._iconManuallySet = true;
      this.querySelectorAll(".mc-iconbtn").forEach(b => b.classList.toggle("sel", b === btn));
      if (customWrap()) customWrap().hidden = true;
      this._config = Object.assign({}, this._config,
        { custom_icon_svg: ic.svg, custom_icon_id: ic.id });
      const box = this.querySelector("#f_customsvg");
      if (box) box.value = ic.svg;
      const prev = this.querySelector("#f_custompreview");
      if (prev) prev.innerHTML = ic.svg;
      this._emit();
    }));

    this.querySelectorAll("[data-elimina]").forEach(btn => btn.addEventListener("click", async e => {
      e.stopPropagation();
      const id = btn.dataset.elimina;
      const ic = (MC_ICONE_MIE || []).find(x => x.id === id);
      if (!ic) return;
      // Un'icona tolta per sbaglio andrebbe ridisegnata da capo: si chiede.
      if (!confirm(`Togliere "${ic.nome}" dalla raccolta?\n\nLe card che la usano gia la tengono: il disegno e salvato dentro di loro.`)) return;
      try {
        await mcIconeSalva(this._hass, (MC_ICONE_MIE || []).filter(x => x.id !== id));
        this._ridisegnaIcone();
      } catch (err) { console.warn("[mini-card] non riesco a togliere l'icona:", err); }
    }));

    const salva = this.querySelector("#f_iconasalva");
    if (salva) salva.addEventListener("click", async () => {
      const box = this.querySelector("#f_customsvg");
      const campo = this.querySelector("#f_iconanome");
      const esito = this.querySelector("#f_iconaesito");
      const svg = (box && box.value || "").trim();
      const nome = (campo && campo.value || "").trim();
      if (!svg) { if (esito) esito.textContent = "Prima incolla il codice dell'icona."; return; }
      if (!nome) { if (esito) esito.textContent = "Dalle un nome, senno nella raccolta non la riconosci."; return; }
      salva.disabled = true;
      try {
        const lista = (MC_ICONE_MIE || []).slice();
        // Stesso nome = la stai rifacendo: si sostituisce invece di
        // ritrovarsi tre "Bollitore" uno accanto all'altro.
        const gia = lista.findIndex(x => x.nome.toLowerCase() === nome.toLowerCase());
        const ic = { id: gia >= 0 ? lista[gia].id : mcIconeId(), nome, svg, quando: Date.now() };
        if (gia >= 0) lista[gia] = ic; else lista.push(ic);
        await mcIconeSalva(this._hass, lista);
        this._config = Object.assign({}, this._config, { custom_icon_svg: svg, custom_icon_id: ic.id });
        this._emit();
        this._ridisegnaIcone();
        if (esito) esito.textContent = gia >= 0 ? `"${nome}" aggiornata nella raccolta.` : `"${nome}" e nella raccolta: la ritrovi su ogni card.`;
        if (campo) campo.value = "";
      } catch (err) {
        console.warn("[mini-card] non riesco a salvare l'icona:", err);
        if (esito) esito.textContent = "Non sono riuscito a salvarla. Riprova.";
      }
      salva.disabled = false;
    });
  }

  _render() {
    if (!this._config) return;
    const c = this._config;
    this.innerHTML = `<style>
      .mce{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-family:inherit}
      .mce .fld{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .mce label{font-size:13px;font-weight:600;color:var(--primary-text-color)}
      .mce .h{font-size:11px;color:var(--secondary-text-color);font-weight:400}
      .mce input,.mce select{padding:10px 11px;border-radius:8px;font-size:15px;font-family:inherit;
        border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
      .mce .row{display:flex;gap:12px}.mce .row>.fld{flex:1}
      .mce .ck{display:flex;align-items:center;gap:8px;cursor:pointer}
      .mce .ck input{width:auto}
      .mce .note{font-size:11.5px;color:var(--secondary-text-color);line-height:1.5;margin-top:4px}
      .mc-icongrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
      .mc-iconmio{position:relative;display:flex}
      .mc-iconmio>.mc-iconbtn{flex:1}
      .mc-iconx{position:absolute;top:-5px;right:-5px;width:19px;height:19px;border-radius:50%;
        border:1px solid var(--divider-color);background:var(--card-background-color);
        color:var(--secondary-text-color);font-size:10px;line-height:1;cursor:pointer;padding:0}
      .mc-iconx:hover{color:#ff6b6b;border-color:#ff6b6b}
      .mc-salvaicona{display:flex;gap:8px;align-items:center;margin-top:8px}
      .mc-salvaicona input{flex:1}
      .mc-salvabtn{padding:9px 14px;border-radius:9px;border:1px solid var(--primary-color);
        background:transparent;color:var(--primary-color);font:inherit;font-size:13px;font-weight:700;cursor:pointer}
      .mc-salvabtn:disabled{opacity:.4;cursor:not-allowed}
      .mc-salvaesito{font-size:11.5px;color:var(--secondary-text-color);margin-top:4px;min-height:14px}
      .mc-iconbtn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:12px;
        border:1.5px solid var(--divider-color);background:var(--card-background-color);cursor:pointer}
      .mc-iconbtn.sel{border-color:var(--primary-color);background:rgba(var(--rgb-primary-color,3,169,244),.12)}
      .mc-iconbtn-wrap{width:34px;height:34px;pointer-events:none}
      .mc-iconbtn-wrap svg{width:100%;height:100%;display:block}
      .mc-iconbtn-lbl{font-size:9.5px;font-weight:600;color:var(--primary-text-color);text-align:center;line-height:1.15}
      .mc-picker{position:relative}
      .mc-pickwrap{position:relative}
      .mc-pickwrap input{width:100%;padding-right:30px}
      .mc-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;
        color:var(--secondary-text-color);font-size:14px;cursor:pointer;padding:4px}
      .mc-optlist{position:absolute;z-index:999;top:calc(100% + 2px);left:0;right:0;max-height:220px;overflow-y:auto;
        background:var(--card-background-color,var(--primary-background-color,#1c1f26));
        border:1px solid var(--divider-color);border-radius:8px;
        box-shadow:0 10px 26px rgba(0,0,0,.45)}
      .mc-opt{padding:8px 11px;font-size:13.5px;line-height:1.35;color:var(--primary-text-color);cursor:pointer;
        background:var(--card-background-color,var(--primary-background-color,#1c1f26))}
      .mc-opt:hover{background:rgba(var(--rgb-primary-color,3,169,244),.14)}
      .mc-opt small{display:block;font-size:10px;color:var(--secondary-text-color);margin-top:1px}
      .mc-opt-empty{color:var(--secondary-text-color);cursor:default}
      .mc-svgbox{min-height:90px;font-family:monospace;font-size:12px;resize:vertical}
      .mc-svgpreview{width:56px;height:56px;padding:6px;border:1px solid var(--divider-color);border-radius:10px;
        display:flex;align-items:center;justify-content:center;background:var(--card-background-color)}
      .mc-svgpreview svg{width:100%;height:100%}
      .mc-svgrow{display:flex;gap:10px;align-items:flex-start}
      .mc-svgrow textarea{flex:1}
      .mc-creator-link{font-size:12px;font-weight:700;color:var(--primary-color);text-decoration:none}
      .mc-modetoggle{display:flex;gap:8px}
      .mc-modebtn{flex:1;padding:11px 8px;border-radius:10px;border:1.5px solid var(--divider-color);
        background:var(--card-background-color);color:var(--primary-text-color);font:inherit;font-size:13px;font-weight:700;cursor:pointer}
      .mc-modebtn.sel{border-color:var(--primary-color);background:rgba(var(--rgb-primary-color,3,169,244),.12)}
    </style>
    <div class="mce">
      <div class="fld"><label>Nome</label><input type="text" id="f_name" value="${(c.name || "").replace(/"/g, "&quot;")}"></div>
      <div class="fld">
        <label>Tipo di card</label>
        <span class="h">"Dispositivo" controlla e mostra un apparecchio singolo; "Stanza" è un riepilogo che porta a un'altra vista al tocco</span>
        <div class="mc-modetoggle">
          <button type="button" class="mc-modebtn${c.mode !== "room" ? " sel" : ""}" data-mode="device">📦 Dispositivo</button>
          <button type="button" class="mc-modebtn${c.mode === "room" ? " sel" : ""}" data-mode="room">🚪 Stanza (collegamento)</button>
        </div>
      </div>
      <div class="fld"><label>Icona</label>${this._iconGridHTML(c.icon_type, !!(c.custom_icon_svg || "").trim())}</div>
      <div class="fld"><label>Come sta l'icona nella card</label>
        <span class="h">"Riempie tutto" mette il disegno a tutta tessera con il nome sopra, come la copertina di un disco: sta bene sulle stanze e sui disegni d'ambiente. "Piccola" lo mette in mezzo con le scritte sotto. In tutti e due i casi icona e scritte crescono e calano insieme alla dimensione della card.</span>
        <select id="f_icona">
          <option value="auto"${(c.icona || "auto") === "auto" ? " selected" : ""}>Da se (piena sulle stanze, piccola sugli apparecchi)</option>
          <option value="piena"${c.icona === "piena" ? " selected" : ""}>Riempie tutta la card</option>
          <option value="piccola"${c.icona === "piccola" ? " selected" : ""}>Piccola, con le scritte sotto</option>
        </select></div>
      <div class="fld" id="f_customwrap" ${(c.custom_icon_svg || "").trim() ? "" : "hidden"}>
        <label>Codice SVG dell'icona personalizzata</label>
        <span class="h">Incolla qui il codice generato dalla <a class="mc-creator-link" href="https://claude.ai/code/artifact/a536cdbd-3027-4f7a-8216-34fb6f11ce30" target="_blank" rel="noopener">Fucina Icone ↗</a> — usa lo stesso stile delle 20 icone del pacchetto.</span>
        <div class="mc-svgrow">
          <textarea id="f_customsvg" class="mc-svgbox" placeholder="&lt;svg viewBox=&quot;0 0 100 100&quot;&gt;...&lt;/svg&gt;">${this._esc(c.custom_icon_svg || "")}</textarea>
          <div class="mc-svgpreview" id="f_custompreview">${(c.custom_icon_svg || "").trim() ? c.custom_icon_svg : ""}</div>
        </div>
        <div class="mc-salvaicona">
          <input type="text" id="f_iconanome" placeholder="Come si chiama (es. Bollitore)" maxlength="24">
          <button type="button" class="mc-salvabtn" id="f_iconasalva">Salva nella raccolta</button>
        </div>
        <div class="mc-salvaesito" id="f_iconaesito"></div>
      </div>
      <div id="f_devicewrap" ${c.mode === "room" ? "hidden" : ""}>
        ${this._devicePickerHTML(c.device_id)}
        ${this._pickerHTML("switch", ["switch.", "light.", "input_boolean."], c.switch, "Presa/interruttore/luce — opzionale")}
        <div class="fld"><label>Dimensione della tessera</label>
          <span class="h">"Quadrata" e comoda per le card che portano a una stanza: restano piccole e allineate.</span>
          <select id="f_taglia">
            <option value="normale"${(c.taglia || "normale") === "normale" ? " selected" : ""}>Normale</option>
            <option value="piccola"${c.taglia === "piccola" ? " selected" : ""}>Piccola</option>
            <option value="quadrata"${c.taglia === "quadrata" ? " selected" : ""}>Quadrata</option>
          </select></div>
        <div class="fld"><label>Soglia "attivo" (W)</label><input type="number" min="1" max="500" id="f_soglia" value="${c.soglia || 10}"></div>
        <div class="fld"><label>Pausa che chiude un'accensione (minuti)</label>
          <span class="h">Vuoto: 12 minuti per gli elettrodomestici a ciclo, mezzo minuto per pompe e compressori.</span>
          <input type="number" min="0" max="120" step="0.5" id="f_pausa" placeholder="automatico" value="${c.pausa_max || ""}"></div>
        <div class="fld"><label>Colori</label>
          <span class="h">Di suo segue il giorno e la notte del pannello che la ospita.</span>
          <select id="f_tema">
            <option value="auto"${(c.tema || "auto") === "auto" ? " selected" : ""}>Segui il pannello</option>
            <option value="scuro"${c.tema === "scuro" ? " selected" : ""}>Sempre scura</option>
            <option value="chiaro"${c.tema === "chiaro" ? " selected" : ""}>Sempre chiara</option>
          </select></div>
        <div class="fld"><label>Controllo consumo (frigo e congelatore)</label>
          <span class="h">Confronta l'apparecchio con se stesso e con la sua targa. Cambiando frigo o congelatore basta aggiornare questi quattro campi.</span>
          <select id="f_freddotipo">
            <option value="auto"${(c.freddo_tipo || "auto") === "auto" ? " selected" : ""}>Riconoscilo dal nome</option>
            <option value="frigo"${c.freddo_tipo === "frigo" ? " selected" : ""}>E un frigorifero</option>
            <option value="congelatore"${c.freddo_tipo === "congelatore" ? " selected" : ""}>E un congelatore</option>
            <option value="no"${c.freddo_tipo === "no" ? " selected" : ""}>Non fare il controllo</option>
          </select></div>
        <div class="fld"><label>Consumo di targa (kWh all'anno)</label>
          <span class="h">Sta sull'etichetta energetica. Lasciandolo vuoto usa il valore tipico della categoria.</span>
          <input type="number" min="0" max="2000" id="f_rif" placeholder="es. 302" value="${c.riferimento || ""}"></div>
        <div class="row">
          <div class="fld"><label>Avvisa oltre il +% sulla sua media</label>
            <input type="number" min="5" max="200" id="f_sogliamedia" value="${c.soglia_media ?? 35}"></div>
          <div class="fld"><label>Avvisa oltre la targa per</label>
            <input type="number" min="1" max="5" step="0.1" id="f_sogliatarga" value="${c.soglia_targa ?? 1.5}"></div>
        </div>
      </div>
      <div class="fld"><label>Timer</label>
        <label class="ck"><input type="checkbox" id="f_timer"${c.mostra_timer ? " checked" : ""}> Metti l'orologio sulla card</label>
        <span class="h">Compare in alto a sinistra e apre la programmazione: accendi/spegni a orario, un ordine singolo, oppure "spegni fra 30 minuti". Sono automazioni vere di Home Assistant, quindi funzionano anche a telefono spento. Serve la presa collegata qui sopra.</span></div>
      <div class="fld"><label>Prima di accendere o spegnere</label>
        <label class="ck"><input type="checkbox" id="f_conferma"${c.conferma_accensione !== false ? " checked" : ""}> Chiedi conferma</label>
        <span class="h">Il tasto acceso/spento sta a un dito da dove si tocca per aprire la card: capita di premerlo per sbaglio. Togli la spunta per farlo agire subito.</span></div>
      ${this._pickerHTML("power", ["sensor."], c.power, c.mode === "room" ? "Sensore consumo della stanza (W) — opzionale" : "Sensore potenza (W) — opzionale", "abilita lo storico consumi e il consumo di oggi")}
      ${this._pickerHTML("temp", ["sensor."], c.temp, "Sensore temperatura — opzionale")}
      ${this._pickerHTML("humidity", ["sensor."], c.humidity, "Sensore umidità — opzionale")}
      <div id="f_devicewrap2" ${c.mode === "room" ? "hidden" : ""}>
        ${this._pickerHTML("climate", ["climate."], c.climate, "Climatizzatore — opzionale", "il pulsante ⚙ sulla card apre il telecomando nativo di Home Assistant (temperatura, modalità, ventola)")}
        <div class="row" id="f_climaterow" ${c.icon_type === "climate" ? "" : "hidden"}>
          <div class="fld"><label>Soglia freddo (°C)</label><input type="number" id="f_sfreddo" value="${c.soglia_freddo ?? 18}"></div>
          <div class="fld"><label>Soglia caldo (°C)</label><input type="number" id="f_scaldo" value="${c.soglia_caldo ?? 26}"></div>
        </div>
      </div>
      <div id="f_roomwrap" ${c.mode === "room" ? "" : "hidden"}>
        ${this._pickerHTML("group", ["sensor.", "group."], c.group, "Gruppo di sensori potenza — opzionale", "per mostrare quale dispositivo della stanza sta consumando di più in questo momento")}
        ${this._navPickerHTML(c.path)}
      </div>
      <div class="row">
        <div class="fld"><label>Prezzo energia (€/kWh)</label>
          <input type="number" step="0.01" min="0" max="5" id="f_price" value="${c.prezzo_kwh}"></div>
        <div class="fld"><label>Storico (giorni)</label>
          <select id="f_days"><option value="7"${c.storico_giorni == 7 ? " selected" : ""}>7 giorni</option>
            <option value="14"${c.storico_giorni == 14 ? " selected" : ""}>14 giorni</option>
            <option value="30"${c.storico_giorni == 30 ? " selected" : ""}>30 giorni</option></select></div>
      </div>
      <div class="note">💡 Scrivendo il nome (es. "Forno", "Bagno", "Giardino") l'icona giusta viene suggerita da sola — se la cambi a mano dal menu, resta quella scelta. Scegliendo il Dispositivo, i sensori proposti sono solo i suoi, non più indovinati dal nome su tutta casa. Card pensata piccola per il telefono: usa la scheda "Layout" per allargarla/restringerla — icona e testo si adattano da soli. Una card "Dispositivo" si tocca per vedere lo storico consumi (serve il sensore di potenza); una card "Stanza" con un Collegamento impostato ti porta lì invece. Il badge on/off accende/spegne direttamente; il pulsante ⚙ apre le informazioni/impostazioni native di Home Assistant (per un climatizzatore, il telecomando completo).</div>
    </div>`;
    const on = (id, ev, fn) => { const el = this.querySelector(id); if (el) el.addEventListener(ev, fn); };
    this.querySelectorAll(".mc-modebtn").forEach(btn => btn.addEventListener("click", () => {
      this._set("mode", btn.dataset.mode);
      this._render();
    }));
    on("#f_name", "input", e => {
      const name = e.target.value;
      const updates = { name };
      const suggestion = mcSuggestIcon(name);
      if (suggestion && !this._iconManuallySet && suggestion !== this._config.icon_type) {
        updates.icon_type = suggestion;
      }
      // Auto-abbinamento sensori: cerca tra le entità vere di Cristian
      // qualcosa che assomigli al nome scritto (es. "Lavatrice" → trova da
      // solo switch/sensore che contengono "lavatrice"), solo per i campi
      // ancora vuoti e non già scelti a mano.
      if ((!this._switchManuallySet && !this._config.switch) || (!this._powerManuallySet && !this._config.power)) {
        const s = mcSuggestEntities(name, this._hass);
        if (s.switch && !this._switchManuallySet && !this._config.switch) updates.switch = s.switch;
        if (s.power && !this._powerManuallySet && !this._config.power) updates.power = s.power;
      }
      this._config = Object.assign({}, this._config, updates);
      if (!this._config.icon_manuale && !(this._config.custom_icon_svg || "").trim()) this._ridisegnaIcone();
      else if (updates.icon_type) this.querySelectorAll(".mc-iconbtn").forEach(b => b.classList.toggle("sel", b.dataset.icon === updates.icon_type));
      if (updates.switch) {
        const p = this.querySelector('.mc-picker[data-field="switch"]');
        if (p) { p.querySelector(".mc-search").value = this._entityName(updates.switch); p.querySelector(".mc-clear").hidden = false; }
      }
      if (updates.power) {
        const p = this.querySelector('.mc-picker[data-field="power"]');
        if (p) { p.querySelector(".mc-search").value = this._entityName(updates.power); p.querySelector(".mc-clear").hidden = false; }
      }
      this._emit();
    });
    this._wireIcone();
    on("#f_customsvg", "input", e => {
      const svg = e.target.value;
      const preview = this.querySelector("#f_custompreview");
      if (preview) preview.innerHTML = svg.trim();
      this._set("custom_icon_svg", svg);
    });
    this.querySelectorAll(".mc-picker").forEach(p => this._wirePicker(p));
    this.querySelectorAll(".mc-devpicker").forEach(p => this._wireDevicePicker(p));
    this.querySelectorAll(".mc-navpicker").forEach(p => this._wireNavPicker(p));
    on("#f_taglia", "change", e => this._set("taglia", e.target.value));
    on("#f_icona", "change", e => this._set("icona", e.target.value));
    on("#f_soglia", "change", e => this._set("soglia", parseInt(e.target.value) || 10));
    on("#f_tema", "change", e => this._set("tema", e.target.value));
    on("#f_pausa", "change", e => this._set("pausa_max", parseFloat(e.target.value) || ""));
    on("#f_rif", "change", e => this._set("riferimento", parseInt(e.target.value) || ""));
    on("#f_freddotipo", "change", e => this._set("freddo_tipo", e.target.value));
    on("#f_sogliamedia", "change", e => this._set("soglia_media", parseInt(e.target.value) || 35));
    on("#f_sogliatarga", "change", e => this._set("soglia_targa", parseFloat(e.target.value) || 1.5));
    on("#f_conferma", "change", e => this._set("conferma_accensione", e.target.checked));
    on("#f_timer", "change", e => this._set("mostra_timer", e.target.checked));
    on("#f_sfreddo", "change", e => this._set("soglia_freddo", parseFloat(String(e.target.value).replace(",", ".")) || 18));
    on("#f_scaldo", "change", e => this._set("soglia_caldo", parseFloat(String(e.target.value).replace(",", ".")) || 26));
    on("#f_price", "change", e => this._set("prezzo_kwh", parseFloat(String(e.target.value).replace(",", ".")) || 0.30));
    on("#f_days", "change", e => this._set("storico_giorni", parseInt(e.target.value) || 14));
  }
}
customElements.define("mini-card-editor", MiniCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "mini-card",
  name: "Mini Card",
  description: "Tessera piccola e personalizzabile per un dispositivo o una stanza: 20 icone curate + icone personalizzate illimitate (crea le tue con la Fucina Icone), sensori con ricerca, e auto-abbinamento (scrivi \"Lavatrice\" e trova da sola presa/sensore giusti). Pensata per il telefono, si adatta se la allarghi.",
  preview: true,
  documentationURL: "https://github.com/cristianwebonline/ha-mini-card",
});
