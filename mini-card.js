/*! Mini Card — tessera piccola e personalizzabile per dispositivi/ambienti
 *  (luce, presa, TV, clima di una stanza...). Pensata per dashboard da
 *  telefono: parte piccola, ma icona e testo si ridimensionano da soli in
 *  base a quanto la allarghi (drag nella scheda "Layout" dell'editor).
 *  Scegli icona, sensori (potenza/energia/temperatura/umidità) e presa/luce
 *  da accendere: il resto lo fa la card. Gira nel browser, nessun server.
 */
const MC_VERSION = "1.19.0";
console.info(`%c MINI-CARD %c v${MC_VERSION} `,
  "color:#0b1f2b;background:#4fd1c5;font-weight:700;border-radius:4px 0 0 4px",
  "color:#d6fbf7;background:#1a1b21;border-radius:0 4px 4px 0");

const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MC_DEFAULTS = {
  name: "Dispositivo", icon_type: "generic", custom_icon_svg: "", custom_icon_id: "", icona: "auto",
  power: "", energy: "", switch: "", temp: "", humidity: "", climate: "", device_id: "", path: "", group: "", mode: "device",
  soglia: 10, soglia_freddo: 18, soglia_caldo: 26, prezzo_kwh: 0.30, storico_giorni: 14,
  taglia: "normale",
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
  const n = ` ${(name || "").toLowerCase().trim()} `;
  if (n.trim() === "") return null;
  for (const [icon, words] of MC_ICON_KEYWORDS) {
    if (words.some(w => n.includes(w))) return icon;
  }
  return null;
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
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(), end_time: now.toISOString(),
        entity_ids: [this._cfg.power], minimal_response: true, no_attributes: true,
      });
      const rows = (res && res[this._cfg.power]) || [];
      this._hist = this._integratePower(rows);
    } catch (e) {
      this._hist = null;
      console.warn("[mini-card] storico non disponibile:", e);
    }
    this._histLoading = false;
    this._histTs = Date.now();
    this._update();
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
    return daily;
  }

  // Pacchetto icone condiviso (14 disegni curati, vedi funzioni mcIcon* sopra).
  // Un'icona incollata (dal Creatore Icone o a mano) ha sempre la priorità:
  // rende il pacchetto di 20 tipi un punto di partenza, non un tetto.
  _icon() {
    const custom = (this._cfg.custom_icon_svg || "").trim();
    if (custom) return mcNamespaceCustomSvg(custom);
    return mcIconFor(this._cfg.icon_type);
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
      .mc-card.piccola .mc-state,.mc-card.piccola .mc-sub{font-size:8.5px}
      .mc-card.piccola .mc-metric{font-size:10.5px}
      .mc-card.piccola::before{border-radius:14px}
      .mc-card.quadrata{aspect-ratio:1;padding:6px;border-radius:16px;gap:1px;flex:0 0 auto;width:100%}
      .mc-card.quadrata:not([data-mode="room"]) .mc-iconwrap{width:34px;height:34px}
      .mc-card.quadrata:not([data-mode="room"]) .mc-name{font-size:10px;margin-top:2px}
      .mc-card.quadrata .mc-state,.mc-card.quadrata .mc-sub{font-size:8.5px}
      .mc-card.quadrata .mc-metric{font-size:11px}
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
      .mc-card[data-icona="piena"]{padding:0;gap:0;justify-content:flex-end;align-items:stretch}
      .mc-card[data-icona="piena"] .mc-iconwrap{position:absolute;inset:0;width:100%;height:100%;
        margin:0;aspect-ratio:auto;z-index:0}
      .mc-card[data-icona="piena"] .mc-svg{width:100%;height:100%;filter:none}
      /* La velatura scura dal basso: serve a leggere il testo qualunque cosa
         ci sia disegnato sotto, chiara o scura che sia. */
      .mc-card[data-icona="piena"]::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
        background:linear-gradient(to top,rgba(4,8,14,.92) 0%,rgba(4,8,14,.70) 30%,
          rgba(4,8,14,0) 55%)}
      /* Piu grandi: le misure di prima erano tarate per stare sopra al disegno
         senza coprirlo, ma il risultato era una scritta da leggere strizzando
         gli occhi. Ora che il disegno sta in alto e lo spazio sotto e libero,
         il testo puo prendersi quello che gli serve. */
      .mc-card[data-icona="piena"] .mc-name{position:relative;z-index:2;margin:0;
        padding:0 4.5cqw;font-size:clamp(13px,10cqw,30px);line-height:1.12;color:#fff;
        white-space:normal;text-shadow:0 1px 5px rgba(0,0,0,.9)}
      .mc-card[data-icona="piena"] .mc-sub{position:relative;z-index:2;
        padding:1.5cqw 4.5cqw 4.5cqw;font-size:clamp(9.5px,6.2cqw,18px);line-height:1.28;
        white-space:normal;color:rgba(255,255,255,.95);text-shadow:0 1px 4px rgba(0,0,0,.9)}
      /* Su una stanza non hanno senso: il tasto acceso/spento (non ha una
         presa), "Apri la vista" (la card si tocca e ci porta, si capisce), e
         i watt (che stanno gia nella riga dei dati). */
      .mc-card[data-icona="piena"] .mc-state,
      .mc-card[data-icona="piena"] .mc-metric{display:none!important}
      .mc-card[data-mode="room"] .mc-badge{display:none!important}
      .mc-card[data-icona="piena"] .mc-info{z-index:3}
      .mc-card[data-icona="piena"] .mc-badge{position:relative;z-index:2;align-self:center;
        margin-bottom:3cqw}
      /* Il velo verde di "sta consumando" su una foto a tutta card sarebbe
         una patina addosso al disegno: sulle stanze resta appena accennato. */
      .mc-card[data-icona="piena"].on.lavora{background-image:linear-gradient(rgba(56,224,138,.07),rgba(56,224,138,.07))}

      /* ICONA PICCOLA — il disegno in mezzo e le scritte sotto. Anche qui
         TUTTO segue la larghezza della card: ingrandisci la tessera e crescono
         insieme icona e scritte, la rimpicciolisci e calano insieme. Prima le
         misure erano fisse (44px l'icona, 11px il nome) e cambiavano a scatti
         a certe soglie: una card larga il doppio aveva la stessa iconcina. */
      .mc-card[data-icona="piccola"] .mc-iconwrap{width:clamp(26px,30cqw,110px);height:auto;
        aspect-ratio:1;flex:0 0 auto}
      .mc-card[data-icona="piccola"] .mc-name{font-size:clamp(10px,8cqw,19px);line-height:1.2}
      .mc-card[data-icona="piccola"] .mc-sub{font-size:clamp(8.5px,5.6cqw,14px);line-height:1.3}
      .mc-card[data-icona="piccola"] .mc-state{font-size:clamp(8px,5cqw,13px)}
      .mc-card[data-icona="piccola"] .mc-metric{font-size:clamp(10px,7cqw,20px)}
      .mc-card[data-icona="piccola"] .mc-badge{font-size:clamp(7px,3.6cqw,10.5px)}
      .mc-svg{width:100%;height:100%;display:block;filter:drop-shadow(0 4px 7px rgba(0,0,0,.35))}
      .mc-name{font-size:11px;font-weight:800;margin-top:2px;text-align:center;line-height:1.2;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .mc-badge{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;margin-top:2px;
        font-size:8.5px;font-weight:800;letter-spacing:.2px;background:rgba(255,255,255,.06);border:1px solid var(--mc-stroke);color:var(--mc-muted)}
      .mc-badge .dot{width:5px;height:5px;border-radius:50%;background:#5a6572;flex:0 0 auto}
      .mc-badge[data-on="1"]{background:rgba(56,224,138,.16);border-color:rgba(56,224,138,.45);color:var(--mc-c-ok,#8ff0b4)}
      .mc-card.lavora .mc-badge[data-on="1"]{animation:mc-blink 3s ease-in-out infinite}
      .mc-badge[data-on="1"] .dot{background:#38e08a;box-shadow:0 0 5px #38e08a}
      .mc-badge[data-on="0"] .dot{background:#5a6572}
      @keyframes mc-blink{0%,100%{opacity:1}50%{opacity:.55}}
      /* Acceso: la velatura verde va SOPRA il pannello, non al suo posto.
         Sostituendo lo sfondo la card restava all'8% di opacita e su un fondo
         chiaro (pannello Faber Home di giorno) diventava quasi bianca, con il
         testo bianco sopra: illeggibile. Cosi il pannello resta scuro quanto
         serve su qualunque sfondo. */
      /* Acceso ma fermo: una velatura appena accennata. In funzione: piena.
         Cosi si distingue con un'occhiata, senza leggere. */
      .mc-card.on{background-image:linear-gradient(rgba(56,224,138,.07),rgba(56,224,138,.07));border-color:rgba(56,224,138,.22)}
      .mc-card.on.lavora{background-image:linear-gradient(rgba(56,224,138,.14),rgba(56,224,138,.14));border-color:rgba(56,224,138,.34)}
      .mc-state{font-size:9.5px;font-weight:700;color:var(--mc-muted)}
      .mc-card.on .mc-state{color:var(--mc-c-ok,#8ff0b4)}
      /* In attesa il testo resta neutro: il verde acceso vuol dire "sta
         lavorando", e usarlo anche per "acceso ma fermo" toglierebbe proprio
         la distinzione che si voleva. */
      .mc-card.on.attesa .mc-state{color:var(--mc-muted)}
      .mc-sub{font-size:9px;color:var(--mc-muted);margin-top:-1px}
      .mc-metric{font-size:12px;font-weight:850;font-variant-numeric:tabular-nums;color:var(--mc-ink)}
      .mc-metric small{font-size:8px;color:var(--mc-muted);font-weight:700;margin-left:1px}
      /* le container query fanno crescere icona e testo quando la card viene allargata */
      /* Qui c'erano tre soglie fisse (130, 170, 220 px) che facevano crescere
         icona e scritte A SCATTI: una card larga il doppio poteva ritrovarsi
         con la stessa iconcina finche non superava la soglia successiva. Ora
         le misure sono in cqw, cioe in percentuale della larghezza della card:
         crescono e calano con continuita insieme alla tessera. */ .mc-badge{font-size:10.5px;padding:4px 12px}
        .mc-state{font-size:12.5px} .mc-sub{font-size:11.5px} .mc-metric{font-size:20px}
      }
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
      /* Popup immersivo: foglio a schermo intero che sale dal basso (stile
         "bottom sheet" iOS), non più il piccolo riquadro centrato — icona
         grande, azioni rapide, poi lo storico consumi già esistente. */
      .mc-scrim{position:fixed;inset:0;background:rgba(4,5,8,.62);backdrop-filter:blur(6px);display:flex;
        align-items:flex-end;justify-content:center;padding:0;z-index:9;opacity:0;pointer-events:none;transition:opacity .18s}
      .mc-scrim.on{opacity:1;pointer-events:auto}
      .mc-modal{width:100%;max-width:420px;max-height:92vh;overflow-y:auto;background:#1a1b21;border:1px solid rgba(255,255,255,.14);
        border-bottom:none;border-radius:26px 26px 0 0;padding:10px 20px 28px;box-shadow:0 -14px 50px rgba(0,0,0,.55);
        transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);position:relative}
      .mc-scrim.on .mc-modal{transform:none}
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
      @media(prefers-reduced-motion:reduce){.mc *{animation:none!important}}
    </style>
    <div class="mc">
      <div class="mc-card" data-icon="${this._esc(this._cfg.icon_type)}" data-mode="${this._esc(this._cfg.mode || "device")}" data-icona="${this._esc(this._modoIcona())}" data-role="tap">
        <button class="mc-info" data-role="info" title="Informazioni e impostazioni" hidden>⚙</button>
        <div class="mc-iconwrap">${this._icon()}</div>
        <div class="mc-name">${this._esc(this._cfg.name)}</div>
        <div class="mc-badge" data-role="badge" hidden><span class="dot"></span><span class="lbl">—</span></div>
        <div class="mc-state" data-role="state">—</div>
        <div class="mc-sub" data-role="sub" hidden></div>
        <div class="mc-metric" data-role="metricwrap" hidden><span data-role="power"></span><small>W</small></div>
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
      if (e.target.closest('[data-role="badge"]') || e.target.closest('[data-role="info"]')) return;
      if (this._cfg.path) { this._navigate(this._cfg.path); return; }
      this._openImmersive();
    });
    const badge = this._el.querySelector('[data-role="badge"]');
    badge.onclick = e => { e.stopPropagation(); this._toggle(); };
    const infoBtn = this._el.querySelector('[data-role="info"]');
    infoBtn.onclick = e => { e.stopPropagation(); this._openMoreInfo(); };
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
    if (id && this._hass.states[id]) this._hass.callService(id.split(".")[0], "toggle", { entity_id: id });
  }

  // Stessa regola usata sia dalla tessera sia dal popup immersivo: presa/luce
  // vince se configurata, altrimenti la potenza sopra soglia.
  _isOn() {
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    const p = this._num(cfg.power);
    if (sw) return sw.state === "on";
    if (cfg.power) return p != null && p > (parseFloat(cfg.soglia) || 10);
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
      if (cfg.power) return (p != null && p > soglia) ? "lavora" : "attesa";
      return "lavora";
    }
    if (sw && sw.state !== "on") return "staccata";
    if (cfg.power) {
      const consuma = p != null && p > soglia;
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
    if (dom === "light") return { on: "Luce accesa", off: "Luce spenta", giu: "Luce staccata" };
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
    if (t != null) parts.push(`🌡️ ${this._fmt(t)}°C`);
    if (h != null) parts.push(`💧 ${Math.round(h)}%`);
    if (todayKwh != null) parts.push(`⚡ ${this._fmt(todayKwh)} kWh oggi`);
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
      if (cfg.icon_type === "climate" && mercury && bulb) {
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
    const render = () => {
      const on = this._isOn();
      const st = this._stato();
      const heroIconCls = "mc-hero-icon mc-card" + (cfg.mode === "room" ? " mc-hero-icon-room" : "")
        + (on ? " on" : "") + (st === "lavora" ? " lavora" : "") + (st === "attesa" ? " attesa" : "");
      const actions = [];
      if (cfg.switch) actions.push(`<button class="mc-pill${on ? " on" : ""}" data-act="toggle">⏻ ${on ? "Spegni" : "Accendi"}</button>`);
      if (this._priorityEntity()) actions.push(`<button class="mc-pill" data-act="info">⚙ Informazioni</button>`);
      if (cfg.mode === "room" && cfg.path) actions.push(`<button class="mc-pill mc-pill-primary" data-act="nav">Apri la vista →</button>`);
      const chips = this._subParts().map(p => `<div class="mc-chip">${p}</div>`).join("");

      const heroHTML = `
        <div class="mc-sheet-handle"></div>
        <button class="mc-x mc-x-abs" data-act="close">✕</button>
        <div class="mc-hero">
          <div class="${heroIconCls}" data-icon="${this._esc(cfg.icon_type)}">${this._icon()}</div>
          <div class="mc-hero-name">${this._esc(cfg.name)}</div>
          <div class="mc-hero-state${on ? " on" : ""}">${this._stateText(on)}</div>
        </div>
        ${actions.length ? `<div class="mc-actions-row">${actions.join("")}</div>` : ""}
        ${chips ? `<div class="mc-chips">${chips}</div>` : ""}`;

      if (!cfg.power) {
        ov.innerHTML = `<div class="mc-modal">${heroHTML}</div>`;
        wire();
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
      </div>`;
      wire();
      ov.querySelectorAll(".mc-tab").forEach(el => el.onclick = () => { period = el.dataset.p; selectedIdx = null; render(); });
      ov.querySelectorAll(".mc-col").forEach(el => el.onclick = () => { selectedIdx = parseInt(el.dataset.i, 10); render(); });
    };
    // Azioni condivise da entrambe le versioni del contenuto (con/senza
    // storico consumi): chiudi, accendi/spegni, apri informazioni native,
    // naviga alla vista collegata.
    const wire = () => {
      const close = () => ov.classList.remove("on");
      const q = sel => ov.querySelector(sel);
      if (q('[data-act="close"]')) q('[data-act="close"]').onclick = close;
      if (q('[data-act="toggle"]')) q('[data-act="toggle"]').onclick = () => { this._toggle(); setTimeout(render, 400); };
      if (q('[data-act="info"]')) q('[data-act="info"]').onclick = () => { close(); this._openMoreInfo(); };
      if (q('[data-act="nav"]')) q('[data-act="nav"]').onclick = () => { close(); this._navigate(cfg.path); };
    };
    render();
    requestAnimationFrame(() => ov.classList.add("on"));
    ov.onclick = e => { if (e.target === ov) ov.classList.remove("on"); };
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
    return `<div class="mc-icongrid" id="f_icongrid">${miei}${customBtn}${types.map(t => `
      <button type="button" class="mc-iconbtn${!hasCustom && t === sel ? " sel" : ""}" data-icon="${t}" title="${MC_ICON_LABELS[t]}">
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
      } else {
        if (customWrap()) customWrap().hidden = true;
        this._config = Object.assign({}, this._config,
          { custom_icon_svg: "", custom_icon_id: "", icon_type: btn.dataset.icon });
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
      </div>
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
      if (updates.icon_type) this.querySelectorAll(".mc-iconbtn").forEach(b => b.classList.toggle("sel", b.dataset.icon === updates.icon_type));
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
