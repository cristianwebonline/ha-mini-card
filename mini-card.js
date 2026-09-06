/*! Mini Card — tessera piccola e personalizzabile per dispositivi/ambienti
 *  (luce, presa, TV, clima di una stanza...). Pensata per dashboard da
 *  telefono: parte piccola, ma icona e testo si ridimensionano da soli in
 *  base a quanto la allarghi (drag nella scheda "Layout" dell'editor).
 *  Scegli icona, sensori (potenza/energia/temperatura/umidità) e presa/luce
 *  da accendere: il resto lo fa la card. Gira nel browser, nessun server.
 */
const MC_VERSION = "1.0.0";
console.info(`%c MINI-CARD %c v${MC_VERSION} `,
  "color:#0b1f2b;background:#4fd1c5;font-weight:700;border-radius:4px 0 0 4px",
  "color:#d6fbf7;background:#1a1b21;border-radius:0 4px 4px 0");

const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MC_DEFAULTS = {
  name: "Dispositivo", icon_type: "generic",
  power: "", energy: "", switch: "", temp: "", humidity: "",
  soglia: 10, soglia_freddo: 18, soglia_caldo: 26, prezzo_kwh: 0.30, storico_giorni: 14,
};

// Impedisce a librerie tipo "hass-swipe-navigation" di leggere un tocco dentro
// la card come uno swipe di cambio-vista. In modalità modifica dashboard
// (URL con "edit=1") non blocchiamo nulla, altrimenti l'editor di HA non
// riceve più il gesto e la card non si può trascinare per riordinarla o
// ridimensionarla (bug trovato dopo su un'altra card della stessa famiglia).
function stopSwipeNavHijack(el) {
  const inEditMode = () => location.search.indexOf("edit=1") !== -1;
  ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove"].forEach(evt =>
    el.addEventListener(evt, e => { if (!inEditMode()) e.stopPropagation(); }, { passive: true }));
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

  // ---- icone (4 stili curati a mano, non mdi piatte) -------------------------
  _icon() {
    const t = this._cfg.icon_type;
    if (t === "climate") return this._iconClimate();
    if (t === "livingroom") return this._iconLivingroom();
    if (t === "bedroom") return this._iconBedroom();
    if (t === "kitchen") return this._iconKitchen();
    if (t === "bathroom") return this._iconBathroom();
    if (t === "office") return this._iconOffice();
    if (t === "garden") return this._iconGarden();
    if (t === "security") return this._iconSecurity();
    return this._iconGeneric();
  }

  // Bollitore/piccolo elettrodomestico da cucina: vapore quando è acceso.
  _iconKitchen() {
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

  // Doccia: acqua che scende quando è acceso (boiler/scaldabagno/luce bagno).
  _iconBathroom() {
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
  _iconOffice() {
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
  _iconGarden() {
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
  _iconSecurity() {
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

  // Termometro: sempre visibile (una stanza non si "spegne"), colore e
  // livello del mercurio legati al sensore di temperatura reale.
  _iconClimate() {
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

  _iconLivingroom() {
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

  _iconGeneric() {
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

  _iconBedroom() {
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
      .mc-card::before{content:"";position:absolute;inset:0;border-radius:18px;pointer-events:none;
        background:radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.06),transparent 60%)}
      .mc-iconwrap{width:44px;height:44px;flex:0 0 auto}
      .mc-svg{width:100%;height:100%;display:block;filter:drop-shadow(0 4px 7px rgba(0,0,0,.35))}
      .mc-name{font-size:11px;font-weight:800;margin-top:2px;text-align:center;line-height:1.2;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .mc-badge{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;margin-top:2px;
        font-size:8.5px;font-weight:800;letter-spacing:.2px;background:rgba(255,255,255,.06);border:1px solid var(--mc-stroke);color:var(--mc-muted)}
      .mc-badge .dot{width:5px;height:5px;border-radius:50%;background:#5a6572;flex:0 0 auto}
      .mc-badge[data-on="1"]{background:rgba(56,224,138,.16);border-color:rgba(56,224,138,.45);color:#8ff0b4;animation:mc-blink 3s ease-in-out infinite}
      .mc-badge[data-on="1"] .dot{background:#38e08a;box-shadow:0 0 5px #38e08a}
      .mc-badge[data-on="0"] .dot{background:#5a6572}
      @keyframes mc-blink{0%,100%{opacity:1}50%{opacity:.55}}
      .mc-card.on{background-color:rgba(56,224,138,.08);border-color:rgba(56,224,138,.26)}
      .mc-state{font-size:9.5px;font-weight:700;color:var(--mc-muted)}
      .mc-card.on .mc-state{color:#8ff0b4}
      .mc-sub{font-size:9px;color:var(--mc-muted);margin-top:-1px}
      .mc-metric{font-size:12px;font-weight:850;font-variant-numeric:tabular-nums;color:var(--mc-ink)}
      .mc-metric small{font-size:8px;color:var(--mc-muted);font-weight:700;margin-left:1px}
      /* le container query fanno crescere icona e testo quando la card viene allargata */
      @container mc (min-width:130px){
        .mc-iconwrap{width:56px;height:56px} .mc-name{font-size:12.5px} .mc-badge{font-size:9.5px;padding:3px 9px}
        .mc-state{font-size:10.5px} .mc-sub{font-size:10px} .mc-metric{font-size:14px}
      }
      @container mc (min-width:170px){
        .mc-iconwrap{width:72px;height:72px} .mc-name{font-size:14px} .mc-badge{font-size:10px;padding:3px 10px}
        .mc-state{font-size:11.5px} .mc-sub{font-size:10.5px} .mc-metric{font-size:17px}
      }
      @container mc (min-width:220px){
        .mc-iconwrap{width:88px;height:88px} .mc-name{font-size:15.5px} .mc-badge{font-size:10.5px;padding:4px 12px}
        .mc-state{font-size:12.5px} .mc-sub{font-size:11.5px} .mc-metric{font-size:20px}
      }
      .mc-glow{opacity:.12;transition:opacity .5s}
      .mc-card.on .mc-glow{opacity:1;animation:mc-pulse 2.6s ease-in-out infinite}
      @keyframes mc-pulse{0%,100%{opacity:.6}50%{opacity:1}}
      .mc-screen,.mc-bolt{opacity:.25;transition:opacity .4s}
      .mc-card.on .mc-screen{opacity:1;animation:mc-pulse-fast 2s ease-in-out infinite}
      .mc-card.on .mc-bolt{opacity:1;filter:drop-shadow(0 0 5px #ffb020);animation:mc-pulse-fast 1.8s ease-in-out infinite}
      @keyframes mc-pulse-fast{0%,100%{opacity:.75}50%{opacity:1}}
      [data-role="mercury"]{transition:height .6s ease,y .6s ease}
      .mc-steam{opacity:0;transition:opacity .4s}
      .mc-card.on .mc-steam{opacity:.85;animation:mc-steam-rise 2.2s ease-in-out infinite}
      @keyframes mc-steam-rise{0%{opacity:0;transform:translateY(4px)}40%{opacity:.85}100%{opacity:0;transform:translateY(-10px)}}
      .mc-water{opacity:0;transition:opacity .4s}
      .mc-card.on .mc-water{opacity:.85;animation:mc-water-fall 1s linear infinite}
      @keyframes mc-water-fall{0%{opacity:0;transform:translateY(-4px)}50%{opacity:.9}100%{opacity:0;transform:translateY(6px)}}
      .mc-bulb2{opacity:.3;transition:opacity .4s}
      .mc-card.on .mc-bulb2{opacity:1;filter:drop-shadow(0 0 6px #ffd166);animation:mc-pulse-fast 2.4s ease-in-out infinite}
      .mc-scrim{position:fixed;inset:0;background:rgba(4,5,8,.62);backdrop-filter:blur(6px);display:flex;
        align-items:center;justify-content:center;padding:22px;z-index:9;opacity:0;pointer-events:none;transition:opacity .18s}
      .mc-scrim.on{opacity:1;pointer-events:auto}
      .mc-modal{width:100%;max-width:360px;max-height:80vh;overflow-y:auto;background:#1a1b21;border:1px solid rgba(255,255,255,.16);
        border-radius:22px;padding:18px 16px;box-shadow:0 24px 60px rgba(0,0,0,.6);transform:translateY(14px) scale(.97);transition:transform .2s}
      .mc-scrim.on .mc-modal{transform:none}
      .mc-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
      .mc-mt{font-size:16px;font-weight:850;color:var(--mc-ink)}
      .mc-x{width:28px;height:28px;border-radius:50%;border:1px solid var(--mc-stroke);background:rgba(255,255,255,.05);color:var(--mc-ink);font-size:14px;cursor:pointer;flex:0 0 auto}
      .mc-tabs{display:flex;gap:8px;margin-bottom:12px}
      .mc-tab{flex:1;text-align:center;padding:7px;border-radius:10px;font-size:11.5px;font-weight:800;cursor:pointer;
        background:rgba(255,255,255,.05);border:1px solid var(--mc-stroke);color:var(--mc-muted)}
      .mc-tab.sel{background:linear-gradient(135deg,rgba(71,181,255,.25),rgba(71,181,255,.12));color:var(--mc-ink);border-color:transparent}
      .mc-chart{display:flex;align-items:flex-end;gap:3px;height:74px;margin-bottom:14px}
      .mc-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:3px}
      .mc-bar{width:100%;max-width:14px;border-radius:3px 3px 1px 1px;min-height:2px;background:linear-gradient(180deg,#47b5ff,#2a86c9)}
      .mc-hl{font-size:7.5px;color:var(--mc-muted);font-weight:700}
      .mc-avgrow{display:flex;justify-content:space-between;padding:11px 13px;background:rgba(255,255,255,.04);
        border-radius:12px;border:1px solid var(--mc-stroke);font-size:12.5px;font-weight:700;color:var(--mc-ink)}
      .mc-avgrow small{display:block;color:var(--mc-muted);font-weight:600;font-size:10px;margin-top:2px}
      .mc-empty{color:var(--mc-muted);font-size:12.5px;text-align:center;padding:18px 0}
      @media(prefers-reduced-motion:reduce){.mc *{animation:none!important}}
    </style>
    <div class="mc">
      <div class="mc-card" data-icon="${this._esc(this._cfg.icon_type)}" data-role="tap">
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
    this._el.addEventListener("click", e => {
      if (e.target.closest('[data-role="badge"]')) return;
      this._openHistory();
    });
    const badge = this._el.querySelector('[data-role="badge"]');
    badge.onclick = e => { e.stopPropagation(); this._toggle(); };
  }

  _toggle() {
    const id = this._cfg.switch;
    if (id && this._hass.states[id]) this._hass.callService(id.split(".")[0], "toggle", { entity_id: id });
  }

  _update() {
    if (!this._el) return;
    const cfg = this._cfg;
    const sw = cfg.switch && this._hass.states[cfg.switch];
    const p = this._num(cfg.power);
    let on;
    if (sw) on = sw.state === "on";
    else if (cfg.power) on = p != null && p > (parseFloat(cfg.soglia) || 10);
    else on = false;
    this._el.classList.toggle("on", on);
    this._el.querySelector('[data-role="state"]').textContent = sw ? (on ? "Accesa" : "Spenta") : (cfg.power ? (on ? "Attivo" : "A riposo") : "");

    const badge = this._el.querySelector('[data-role="badge"]');
    if (sw) {
      badge.hidden = false;
      badge.dataset.on = on ? "1" : "0";
      badge.querySelector(".lbl").textContent = on ? "Accesa" : "Spenta";
    } else badge.hidden = true;

    const metricWrap = this._el.querySelector('[data-role="metricwrap"]');
    if (cfg.power) {
      metricWrap.hidden = false;
      this._el.querySelector('[data-role="power"]').textContent = p != null ? Math.round(p) : "–";
    } else metricWrap.hidden = true;

    const t = this._num(cfg.temp), h = this._num(cfg.humidity);
    const sub = this._el.querySelector('[data-role="sub"]');
    if (t != null || h != null) {
      sub.hidden = false;
      sub.innerHTML = [t != null ? `🌡️ ${this._fmt(t)}°C` : "", h != null ? `💧 ${Math.round(h)}%` : ""]
        .filter(Boolean).join(" · ");
    } else sub.hidden = true;

    if (cfg.icon_type === "climate" && t != null) {
      const mercury = this._el.querySelector('[data-role="mercury"]');
      const bulb = this._el.querySelector('[data-role="bulb"]');
      if (mercury && bulb) {
        const lo = 5, hi = 35, bottom = 76, minH = 6, maxH = 46;
        const frac = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
        const hgt = minH + frac * (maxH - minH);
        mercury.setAttribute("height", hgt.toFixed(1));
        mercury.setAttribute("y", (bottom - hgt).toFixed(1));
        const freddo = parseFloat(cfg.soglia_freddo), caldo = parseFloat(cfg.soglia_caldo);
        let cls = "Comfy";
        if (!isNaN(freddo) && t < freddo) cls = "Cold";
        else if (!isNaN(caldo) && t > caldo) cls = "Hot";
        mercury.setAttribute("fill", `url(#mcMercury${cls})`);
        bulb.setAttribute("fill", `url(#mcBulb${cls})`);
      }
    }
  }

  _openHistory() {
    const cfg = this._cfg;
    let ov = this.querySelector(".mc-scrim");
    if (!ov) { ov = document.createElement("div"); ov.className = "mc-scrim"; this.querySelector(".mc").appendChild(ov); }
    if (!cfg.power) {
      ov.innerHTML = `<div class="mc-modal"><div class="mc-mh"><div class="mc-mt">${this._esc(cfg.name)}</div><button class="mc-x">✕</button></div>
        <div class="mc-empty">Configura un sensore di potenza (nell'editor della card) per vedere lo storico consumi.</div></div>`;
      requestAnimationFrame(() => ov.classList.add("on"));
      ov.querySelector(".mc-x").onclick = () => ov.classList.remove("on");
      ov.onclick = e => { if (e.target === ov) ov.classList.remove("on"); };
      return;
    }
    let period = "7";
    const render = () => {
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
      const chartHTML = bars.map((b, i) => {
        const hp = Math.max(2, Math.round(b.v / mx * 100));
        const showLbl = days <= 7 || i % Math.ceil(days / 7) === 0;
        return `<div class="mc-col"><div class="mc-bar" style="height:${hp}%"></div>
          <div class="mc-hl">${showLbl ? b.label.split(" ")[1] : ""}</div></div>`;
      }).join("");
      ov.innerHTML = `<div class="mc-modal">
        <div class="mc-mh"><div><div class="mc-mt">${this._esc(cfg.name)}</div>
          <div style="font-size:11px;color:var(--mc-muted);margin-top:2px">${this._fmt(totKwh)} kWh negli ultimi ${days} giorni · ${this._fmtE(totKwh)}</div></div>
          <button class="mc-x">✕</button></div>
        <div class="mc-tabs">
          <div class="mc-tab${period === "7" ? " sel" : ""}" data-p="7">7 giorni</div>
          <div class="mc-tab${period === "30" ? " sel" : ""}" data-p="30">30 giorni</div>
        </div>
        <div class="mc-chart">${chartHTML}</div>
        <div class="mc-avgrow"><div>Media al giorno<small>stima su ${days} giorni</small></div>
          <div style="text-align:right">${this._fmt(avgDay)} kWh<small>${this._fmtE(avgDay)}/giorno</small></div></div>
      </div>`;
      ov.querySelector(".mc-x").onclick = () => ov.classList.remove("on");
      ov.querySelectorAll(".mc-tab").forEach(el => el.onclick = () => { period = el.dataset.p; render(); });
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
  setConfig(config) {
    this._config = Object.assign({}, MC_DEFAULTS, config || {});
    this._render();
  }
  set hass(h) { this._hass = h; if (h && this._config) this._render(); }

  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _set(key, val) { this._config = Object.assign({}, this._config, { [key]: val }); this._emit(); }

  _opts(domainPrefixes, sel) {
    const hs = this._hass ? this._hass.states : {};
    const ids = Object.keys(hs).filter(id => domainPrefixes.some(p => id.startsWith(p))).sort();
    let out = `<option value=""${!sel ? " selected" : ""}>— nessuno —</option>`;
    for (const id of ids) {
      const fn = (hs[id].attributes && hs[id].attributes.friendly_name) || id;
      out += `<option value="${id}"${id === sel ? " selected" : ""}>${fn}</option>`;
    }
    if (sel && !ids.includes(sel)) out += `<option value="${sel}" selected>${sel}</option>`;
    return out;
  }

  _render() {
    if (!this._config) return;
    const c = this._config;
    this.innerHTML = `<style>
      .mce{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-family:inherit}
      .mce .fld{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .mce label{font-size:13px;font-weight:600;color:var(--primary-text-color)}
      .mce input,.mce select{padding:10px 11px;border-radius:8px;font-size:15px;font-family:inherit;
        border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
      .mce .row{display:flex;gap:12px}.mce .row>.fld{flex:1}
      .mce .note{font-size:11.5px;color:var(--secondary-text-color);line-height:1.5;margin-top:4px}
    </style>
    <div class="mce">
      <div class="fld"><label>Nome</label><input type="text" id="f_name" value="${(c.name || "").replace(/"/g, "&quot;")}"></div>
      <div class="fld"><label>Icona</label>
        <select id="f_icontype">
          <option value="generic"${c.icon_type === "generic" ? " selected" : ""}>🔌 Generica (presa/dispositivo)</option>
          <option value="climate"${c.icon_type === "climate" ? " selected" : ""}>🌡️ Temperatura/Clima</option>
          <option value="livingroom"${c.icon_type === "livingroom" ? " selected" : ""}>🛋️ Soggiorno</option>
          <option value="bedroom"${c.icon_type === "bedroom" ? " selected" : ""}>🛏️ Camera da letto</option>
          <option value="kitchen"${c.icon_type === "kitchen" ? " selected" : ""}>🫖 Cucina (bollitore/piccoli elettrodom.)</option>
          <option value="bathroom"${c.icon_type === "bathroom" ? " selected" : ""}>🚿 Bagno</option>
          <option value="office"${c.icon_type === "office" ? " selected" : ""}>💡 Ufficio/studio (lampada)</option>
          <option value="garden"${c.icon_type === "garden" ? " selected" : ""}>🪴 Giardino/esterno</option>
          <option value="security"${c.icon_type === "security" ? " selected" : ""}>📷 Sicurezza (telecamera)</option>
        </select></div>
      <div class="fld"><label>Presa/interruttore/luce — opzionale</label><select id="f_switch">${this._opts(["switch.", "light.", "input_boolean."], c.switch)}</select></div>
      <div class="fld"><label>Sensore potenza (W) — opzionale</label><span class="h">senza presa: sopra questa soglia la card si mostra "accesa"; abilita anche lo storico consumi</span>
        <select id="f_power">${this._opts(["sensor."], c.power)}</select></div>
      <div class="fld"><label>Soglia "attivo" (W)</label><input type="number" min="1" max="500" id="f_soglia" value="${c.soglia || 10}"></div>
      <div class="fld"><label>Sensore temperatura — opzionale</label><select id="f_temp">${this._opts(["sensor."], c.temp)}</select></div>
      <div class="fld"><label>Sensore umidità — opzionale</label><select id="f_humidity">${this._opts(["sensor."], c.humidity)}</select></div>
      <div class="row">
        <div class="fld"><label>Soglia freddo (°C)</label><input type="number" id="f_sfreddo" value="${c.soglia_freddo ?? 18}"></div>
        <div class="fld"><label>Soglia caldo (°C)</label><input type="number" id="f_scaldo" value="${c.soglia_caldo ?? 26}"></div>
      </div>
      <div class="row">
        <div class="fld"><label>Prezzo energia (€/kWh)</label>
          <input type="number" step="0.01" min="0" max="5" id="f_price" value="${c.prezzo_kwh}"></div>
        <div class="fld"><label>Storico (giorni)</label>
          <select id="f_days"><option value="7"${c.storico_giorni == 7 ? " selected" : ""}>7 giorni</option>
            <option value="14"${c.storico_giorni == 14 ? " selected" : ""}>14 giorni</option>
            <option value="30"${c.storico_giorni == 30 ? " selected" : ""}>30 giorni</option></select></div>
      </div>
      <div class="note">💡 Card pensata piccola per il telefono: usa la scheda "Layout" per allargarla/restringerla — icona e testo si adattano da soli. Tocca la card per vedere lo storico consumi (serve il sensore di potenza); il badge on/off accende/spegne direttamente.</div>
    </div>`;
    const on = (id, ev, fn) => { const el = this.querySelector(id); if (el) el.addEventListener(ev, fn); };
    on("#f_name", "input", e => this._set("name", e.target.value));
    on("#f_icontype", "change", e => this._set("icon_type", e.target.value));
    on("#f_switch", "change", e => this._set("switch", e.target.value));
    on("#f_power", "change", e => this._set("power", e.target.value));
    on("#f_soglia", "change", e => this._set("soglia", parseInt(e.target.value) || 10));
    on("#f_temp", "change", e => this._set("temp", e.target.value));
    on("#f_humidity", "change", e => this._set("humidity", e.target.value));
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
  description: "Tessera piccola e personalizzabile per un dispositivo o una stanza: scegli tra 9 icone curate (generico, clima, soggiorno, camera, cucina, bagno, ufficio, giardino, sicurezza), presa/luce e sensori. Pensata per il telefono, si adatta se la allarghi.",
  preview: true,
  documentationURL: "https://github.com/cristianwebonline/ha-mini-card",
});
