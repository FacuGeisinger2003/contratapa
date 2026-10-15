import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const GENRES = ["Novela","Policial y suspenso","Ciencia ficción","Fantasía","Romance","Clásicos","Cuentos","Poesía","Historia","Biografía y memorias","Ensayo","Negocios y economía","Psicología y autoayuda","Ciencia","Infantil y juvenil","Otro"];
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => new Date().toISOString().slice(0,10);
const hash = s => { let h = 0; for (const c of String(s)) h = (h*31 + c.charCodeAt(0))|0; return Math.abs(h); };
const daysOf = b => (b.start_date && b.end_date) ? Math.max(1, Math.round((new Date(b.end_date) - new Date(b.start_date))/864e5) + 1) : null;
const yearOf = b => b.end_date ? +b.end_date.slice(0,4) : new Date(b.created_at || Date.now()).getFullYear();
const starStr = n => "★".repeat(n||0) + "☆".repeat(5-(n||0));
const fmtDate = d => d ? new Date(d+"T12:00:00").toLocaleDateString("es-UY",{day:"numeric",month:"short",year:"numeric"}) : "—";
const initials = p => (p?.display_name || p?.username || "?").split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const avatar = (p, sm) => `<span class="avatar${sm?" sm":""}" aria-hidden="true">${esc(initials(p))}</span>`;

/* ---------- Config check ---------- */
if (!SUPABASE_URL.startsWith("http")) {
  app.innerHTML = `<div class="setup"><h2>Falta conectar Supabase</h2>
    <p>Abrí <code>config.js</code> y pegá el <b>Project URL</b> y la clave <b>anon public</b> de tu proyecto (Supabase → Project Settings → API). Después volvé a publicar.</p></div>`;
  throw new Error("Supabase sin configurar");
}
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const S = { session:null, me:null, tab:"estante", books:[], friends:[], incoming:[], outgoing:[], profiles:{}, recs:[], viewing:null, viewingBooks:[], filter:"", statYear:new Date().getFullYear(), authMode:"login", recovery:false };

/* ---------- Auth ---------- */
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") { S.recovery = true; S.session = session; renderRecovery(); return; }
  const changed = (session?.user?.id) !== (S.session?.user?.id);
  S.session = session;
  if (!session) { S.me = null; renderAuth(); return; }
  if (changed && !S.recovery) boot();
});

function renderAuth(msg = "", isErr = false){
  const signup = S.authMode === "signup";
  app.innerHTML = `<div class="auth">
    <h1>Contra<em>tapa</em></h1>
    <p class="lead">Tus libros leídos en estantes, con la contratapa a mano y recomendaciones entre amigos.</p>
    <div class="seg" role="group" aria-label="Modo">
      <button type="button" data-mode="login" aria-pressed="${!signup}">Entrar</button>
      <button type="button" data-mode="signup" aria-pressed="${signup}">Crear cuenta</button>
    </div>
    <form class="form" id="authForm">
      ${signup ? `<label>Nombre<input id="aName" autocomplete="name" placeholder="Facu Geisinger"></label>
      <label>Usuario<input id="aUser" required autocomplete="username" placeholder="facu" pattern="[a-zA-Z0-9_.]{3,20}" title="3 a 20 letras, números, punto o guion bajo"></label>` : ""}
      <label>Mail<input id="aMail" type="email" required autocomplete="email"></label>
      <label>Contraseña<input id="aPass" type="password" required minlength="6" autocomplete="${signup?"new-password":"current-password"}"></label>
      <div class="actions"><button class="btn primary" id="aGo" type="submit">${signup?"Crear cuenta":"Entrar"}</button>
      ${signup ? "" : `<button type="button" class="linkbtn" id="aForgot">Me olvidé la contraseña</button>`}</div>
      <div class="status ${isErr?"err":""}" id="aStatus">${esc(msg)}</div>
    </form></div>`;
  $$("[data-mode]").forEach(b => b.onclick = () => { S.authMode = b.dataset.mode; renderAuth(); });
  const status = (t, e) => { $("#aStatus").textContent = t; $("#aStatus").classList.toggle("err", !!e); };
  const forgot = $("#aForgot");
  if (forgot) forgot.onclick = async () => {
    const mail = $("#aMail").value.trim();
    if (!mail) return status("Escribí tu mail y volvé a tocar “Me olvidé la contraseña”.", true);
    const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin });
    status(error ? "No se pudo mandar el mail. Revisá la dirección." : "Te mandamos un mail para crear una contraseña nueva.", !!error);
  };
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const go = $("#aGo"); go.disabled = true;
    const email = $("#aMail").value.trim(), password = $("#aPass").value;
    try {
      if (signup){
        const username = $("#aUser").value.trim().toLowerCase();
        const { data: free, error: e1 } = await sb.rpc("username_available", { u: username });
        if (e1) throw e1;
        if (!free) { status(`El usuario @${username} ya existe. Probá con otro.`, true); go.disabled = false; return; }
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: $("#aName").value.trim() }, emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) { S.authMode = "login"; renderAuth("Cuenta creada. Te mandamos un mail para confirmarla; después entrá acá."); return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const m = String(err?.message || "");
      status(m.includes("Invalid login") ? "Mail o contraseña incorrectos." :
             m.includes("Email not confirmed") ? "Falta confirmar tu mail. Revisá tu casilla (y el spam)." :
             m.includes("already registered") ? "Ese mail ya tiene una cuenta. Entrá con él." :
             m.includes("Password") ? "La contraseña tiene que tener al menos 6 caracteres." :
             "No se pudo completar. Probá de nuevo.", true);
      go.disabled = false;
    }
  };
}

function renderRecovery(){
  app.innerHTML = `<div class="auth"><h1>Contra<em>tapa</em></h1><p class="lead">Elegí una contraseña nueva.</p>
    <form class="form" id="rf"><label>Contraseña nueva<input id="rPass" type="password" minlength="6" required autocomplete="new-password"></label>
    <div class="actions"><button class="btn primary" type="submit">Guardar</button></div><div class="status" id="rStatus"></div></form></div>`;
  $("#rf").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#rPass").value });
    if (error) { $("#rStatus").textContent = "No se pudo guardar. Probá de nuevo."; return; }
    S.recovery = false; boot();
  };
}

/* ---------- Data ---------- */
async function boot(){
  app.innerHTML = `<p class="sub" style="margin-top:30px">Cargando tu estante…</p>`;
  const uid = S.session.user.id;
  const { data: me } = await sb.from("profiles").select("*").eq("id", uid).single();
  S.me = me || { id: uid, username: "lector", display_name: "" };
  await loadAll();
}
async function loadAll(){
  const uid = S.me.id;
  const [books, fr, recs] = await Promise.all([
    sb.from("books").select("*").eq("user_id", uid).order("end_date", { ascending: true, nullsFirst: false }),
    sb.from("friendships").select("*"),
    sb.from("recommendations").select("*").order("created_at", { ascending: false })
  ]);
  S.books = books.data || [];
  const rows = fr.data || [];
  S.recs = recs.data || [];
  const otherIds = new Set();
  rows.forEach(r => otherIds.add(r.requester === uid ? r.addressee : r.requester));
  S.recs.forEach(r => otherIds.add(r.from_user === uid ? r.to_user : r.from_user));
  if (otherIds.size) {
    const { data } = await sb.from("profiles").select("*").in("id", [...otherIds]);
    (data || []).forEach(p => S.profiles[p.id] = p);
  }
  S.profiles[uid] = S.me;
  S.friends = rows.filter(r => r.status === "accepted").map(r => r.requester === uid ? r.addressee : r.requester);
  S.incoming = rows.filter(r => r.status === "pending" && r.addressee === uid).map(r => r.requester);
  S.outgoing = rows.filter(r => r.status === "pending" && r.requester === uid).map(r => r.addressee);
  if (S.friends.length) {
    const { data } = await sb.from("books").select("user_id").in("user_id", S.friends);
    S.friendCounts = {}; (data || []).forEach(b => S.friendCounts[b.user_id] = (S.friendCounts[b.user_id]||0) + 1);
  }
  render();
}

/* ---------- Shell ---------- */
function render(){
  if (!S.me) return;
  const inbox = S.recs.filter(r => r.to_user === S.me.id && !r.done).length;
  app.innerHTML = `<header class="top">
      <div class="brand"><h1>Contra<em>tapa</em></h1><p>Tus libros leídos, con la contratapa a mano y dónde conseguirlos en Uruguay.</p></div>
      <div class="userbar"><span class="handle">@${esc(S.me.username)}</span><button class="btn small ghost" id="logout">Salir</button><button class="btn primary" id="addBtn">+ Cargar libro</button></div>
    </header>
    <nav class="tabs" role="tablist" id="tabs">
      <button role="tab" data-tab="estante" aria-selected="${S.tab==="estante"}">Mi estante<span class="count">${S.books.length||""}</span></button>
      <button role="tab" data-tab="numeros" aria-selected="${S.tab==="numeros"}">Mis números</button>
      <button role="tab" data-tab="recs" aria-selected="${S.tab==="recs"}">Recomendaciones<span class="count">${inbox||""}</span></button>
      <button role="tab" data-tab="amigos" aria-selected="${S.tab==="amigos"}">Amigos<span class="count">${S.incoming.length||""}</span></button>
    </nav>
    <main id="view">${S.tab==="estante" ? viewShelf() : S.tab==="numeros" ? viewStats() : S.tab==="recs" ? viewRecs() : viewFriends()}</main>`;
  wire();
}

function spine(b){
  const pages = b.pages || 250;
  const h = Math.min(210, Math.max(130, 110 + pages/5));
  const w = Math.min(54, Math.max(30, 22 + pages/22));
  return `<button class="spine" data-book="${esc(b.id)}" style="height:${h}px;width:${w}px;background:var(--b${hash(b.title)%7+1})" title="${esc(b.title)} — ${esc(b.author)}" aria-label="${esc(b.title)}, de ${esc(b.author)}">
    <span class="band a"></span><span class="t">${esc(b.title)}</span><span class="band b"></span></button>`;
}

function viewShelf(){
  const mine = !S.viewing;
  const books = mine ? S.books : S.viewingBooks;
  const p = S.profiles[S.viewing];
  const head = mine ? "" : `<div class="who"><button class="btn small ghost" id="backMine">← Mi estante</button>${avatar(p,true)}<b>${esc(p?.display_name || p?.username)}</b><span class="handle" style="font-family:var(--mono);font-size:13px;color:var(--muted)">@${esc(p?.username)}</span></div>`;
  if (!books.length) {
    return head + (mine
      ? `<div class="empty"><h3>Tu estante está vacío</h3><p>Cargá el primer libro que leíste: buscamos la contratapa y lo ubicamos en su género.</p><div class="row"><button class="btn primary" data-act="add">+ Cargar mi primer libro</button></div></div>`
      : `<div class="empty"><h3>Todavía no cargó libros</h3><p>Cuando cargue alguno lo vas a ver acá.</p></div>`);
  }
  const q = S.filter.trim().toLowerCase();
  const list = books.filter(b => !q || (b.title+" "+(b.author||"")).toLowerCase().includes(q));
  const byG = {};
  list.forEach(b => (byG[b.genre||"Otro"] ||= []).push(b));
  const order = Object.keys(byG).sort((a,b) => byG[b].length - byG[a].length || a.localeCompare(b));
  return head + `<div class="toolbar"><input type="search" id="q" placeholder="Buscar por título o autor" value="${esc(S.filter)}" aria-label="Buscar"></div>` +
    (order.map(g => `<section class="shelf"><div class="shelf-head"><h3>${esc(g)}</h3><span>${byG[g].length} ${byG[g].length===1?"libro":"libros"}</span></div>
      <div class="rack">${byG[g].map(spine).join("")}</div></section>`).join("") || `<p class="sub">Nada coincide con “${esc(S.filter)}”.</p>`);
}

function viewStats(){
  const years = [...new Set(S.books.map(yearOf))].sort((a,b)=>b-a);
  if (!years.includes(S.statYear)) years.unshift(S.statYear);
  const bs = S.books.filter(b => yearOf(b) === S.statYear);
  const pages = bs.reduce((s,b)=>s+(+b.pages||0),0);
  const ds = bs.map(daysOf).filter(Boolean);
  const avgDays = ds.length ? Math.round(ds.reduce((a,b)=>a+b,0)/ds.length) : null;
  const gc = {}; bs.forEach(b => gc[b.genre||"Otro"] = (gc[b.genre||"Otro"]||0)+1);
  const genres = Object.entries(gc).sort((a,b)=>b[1]-a[1]);
  const ac = {}; bs.filter(b=>b.author).forEach(b => ac[b.author] = (ac[b.author]||0)+1);
  const topAuthor = Object.entries(ac).sort((a,b)=>b[1]-a[1])[0];
  const best = [...bs].filter(b=>b.rating).sort((a,b)=>b.rating-a.rating || (+b.pages||0)-(+a.pages||0))[0];
  const fastest = [...bs].filter(b=>daysOf(b)&&b.pages).sort((a,b)=>(b.pages/daysOf(b))-(a.pages/daysOf(a)))[0];
  const withDays = bs.filter(b=>daysOf(b)&&b.pages);
  const ppd = withDays.length ? Math.round(withDays.reduce((s,b)=>s+b.pages,0) / withDays.reduce((s,b)=>s+daysOf(b),0)) : null;
  const monthly = Array(12).fill(0), monthTitles = Array.from({length:12},()=>[]);
  bs.forEach(b => { if (b.end_date){ const m = +b.end_date.slice(5,7)-1; monthly[m]++; monthTitles[m].push(b.title); } });
  const W=600,H=210,P={l:28,r:8,t:12,b:26}, max=Math.max(2,...monthly), bw=(W-P.l-P.r)/12;
  const y = v => H-P.b - (v/max)*(H-P.t-P.b);
  let grid = ""; for (let t=0; t<=max; t += max>6?2:1) grid += `<line class="grid" x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${P.l-8}" y="${y(t)+4}" text-anchor="end">${t}</text>`;
  const bars = monthly.map((v,i) => { const x=P.l+i*bw+bw*.2, w=bw*.6; const tip=`${MONTHS[i]}: ${v} ${v===1?"libro":"libros"}${monthTitles[i].length?" · "+monthTitles[i].join(", "):""}`;
    return `${v ? `<path class="bar" tabindex="0" data-tip="${esc(tip)}" d="M${x},${y(0)} V${y(v)+4} q0,-4 4,-4 h${w-8} q4,0 4,4 V${y(0)} Z"/>` : ""}<text x="${P.l+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${MONTHS[i]}</text>`; }).join("");
  const gmax = genres.length ? genres[0][1] : 1;
  return `<section class="wrapped">
    <div class="yr"><h2>Tu año lector <em>${S.statYear}</em></h2><select id="yearSel" aria-label="Año">${years.map(y=>`<option ${y===S.statYear?"selected":""}>${y}</option>`).join("")}</select></div>
    <div class="kpis">
      <div class="kpi"><b>${bs.length}</b><span>libros leídos</span></div>
      <div class="kpi"><b>${pages.toLocaleString("es-UY")}</b><span>páginas</span></div>
      <div class="kpi"><b>${avgDays ?? "—"}</b><span>días promedio por libro</span></div>
      <div class="kpi"><b>${ppd ?? "—"}</b><span>páginas por día de lectura</span></div>
    </div>
    <div class="facts2">
      <div><span>Género favorito</span><b>${genres[0] ? esc(genres[0][0]) : "—"}</b></div>
      <div><span>Autor más leído</span><b>${topAuthor ? esc(topAuthor[0]) + (topAuthor[1]>1?` (${topAuthor[1]})`:"") : "—"}</b></div>
      <div><span>El mejor puntuado</span><b>${best ? esc(best.title) : "—"}</b></div>
      <div><span>El que más te atrapó</span><b>${fastest ? `${esc(fastest.title)} <small style="font-family:var(--mono);font-size:12px;opacity:.7">${Math.round(fastest.pages/daysOf(fastest))} pág/día</small>` : "—"}</b></div>
    </div></section>
  ${bs.length ? `<div class="charts">
    <div class="card chart"><h3>Libros terminados por mes</h3><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Libros terminados por mes en ${S.statYear}">${grid}${bars}</svg></div>
    <div class="card"><h3>Por género</h3>${genres.map(([g,n])=>`<div class="gbar"><span class="n">${esc(g)}</span><div class="track"><div class="fill" style="width:${n/gmax*100}%"></div></div><span class="v">${n}</span></div>`).join("")}</div>
  </div>` : `<p class="sub" style="margin-top:16px">No hay libros terminados en ${S.statYear}.</p>`}`;
}

function viewRecs(){
  const uid = S.me.id;
  const inbox = S.recs.filter(r => r.to_user === uid);
  const sent = S.recs.filter(r => r.from_user === uid);
  const card = (r, incoming) => { const p = S.profiles[incoming ? r.from_user : r.to_user];
    return `<div class="item"><div class="meta">${avatar(p,true)}<span>${incoming ? `<b>${esc(p?.display_name||p?.username||"Un amigo")}</b> te recomienda` : `Para <b>${esc(p?.display_name||p?.username||"un amigo")}</b>`}</span><span style="margin-left:auto;font-family:var(--mono);font-size:11px">${new Date(r.created_at).toLocaleDateString("es-UY")}</span></div>
    <h3>${esc(r.title)}</h3><div class="d-author" style="font-size:15px">${esc(r.author)}</div>${r.note ? `<q>${esc(r.note)}</q>` : ""}
    ${incoming ? `<div class="actions"><button class="btn small" data-shops="${esc(r.id)}">Dónde conseguirlo</button>${r.done ? `<span class="status">Ya lo cargaste ✓</span>` : `<button class="btn small primary" data-readrec="${esc(r.id)}">Ya lo leí, cargarlo</button>`}</div>` : ""}</div>`; };
  return `<div class="h2row"><h2>Te recomendaron</h2></div>
    ${inbox.length ? `<div class="list">${inbox.map(r=>card(r,true)).join("")}</div>` : `<div class="empty"><h3>Sin recomendaciones todavía</h3><p>Cuando un amigo te recomiende un libro, aparece acá.</p></div>`}
    <div class="h2row"><h2>Recomendaste</h2></div>
    ${sent.length ? `<div class="list">${sent.map(r=>card(r,false)).join("")}</div>` : `<p class="sub">Abrí un libro de tu estante y tocá “Recomendar” para mandárselo a un amigo.</p>`}`;
}

function viewFriends(){
  const row = (id, actions, sub) => { const p = S.profiles[id];
    return `<div class="row-item">${avatar(p)}<div class="grow"><b>${esc(p?.display_name || p?.username)}</b><br><small>@${esc(p?.username)}${sub?` · ${sub}`:""}</small></div>${actions}</div>`; };
  return `<div class="card" style="margin-bottom:18px"><h3>Agregar amigos</h3>
      <div class="toolbar" style="margin:0"><input type="search" id="userQ" placeholder="Buscá por usuario, ej: facu" aria-label="Buscar usuario"></div>
      <div class="results" id="userResults"></div>
      <p class="ai-note" style="margin:10px 0 0">Tu usuario es <b>@${esc(S.me.username)}</b>. Pasáselo a tus amigos para que te encuentren.</p></div>
    ${S.incoming.length ? `<div class="h2row"><h2>Solicitudes</h2></div><div class="list">${S.incoming.map(id => row(id, `<button class="btn small primary" data-accept="${id}">Aceptar</button><button class="btn small ghost" data-reject="${id}">Rechazar</button>`)).join("")}</div>` : ""}
    <div class="h2row"><h2>Tus amigos</h2></div>
    ${S.friends.length ? `<div class="list">${S.friends.map(id => row(id, `<button class="btn small" data-reader="${id}">Ver su estante</button>`, `${S.friendCounts?.[id]||0} libros`)).join("")}</div>`
      : `<div class="empty"><h3>Todavía no tenés amigos agregados</h3><p>Buscalos por su usuario arriba. Cuando acepten, vas a ver sus estantes y vas a poder recomendarles libros.</p></div>`}
    ${S.outgoing.length ? `<div class="h2row"><h2>Esperando respuesta</h2></div><div class="list">${S.outgoing.map(id => row(id, `<button class="btn small ghost" data-cancel="${id}">Cancelar</button>`)).join("")}</div>` : ""}`;
}

/* ---------- Wiring ---------- */
function wire(){
  $("#logout").onclick = () => sb.auth.signOut();
  $("#addBtn").onclick = () => openForm();
  $("#tabs").onclick = e => { const t = e.target.closest("button"); if (!t) return; S.tab = t.dataset.tab; if (S.tab !== "estante") S.viewing = null; render(); };
  const q = $("#q");
  if (q) q.oninput = () => { S.filter = q.value; const pos = q.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos,pos); };
  $$("[data-book]").forEach(b => b.onclick = () => openBook(b.dataset.book));
  $$("[data-act=add]").forEach(b => b.onclick = () => openForm());
  const back = $("#backMine"); if (back) back.onclick = () => { S.viewing = null; render(); };
  $$("[data-reader]").forEach(b => b.onclick = async () => {
    const { data } = await sb.from("books").select("*").eq("user_id", b.dataset.reader).order("end_date", { ascending: true, nullsFirst: false });
    S.viewing = b.dataset.reader; S.viewingBooks = data || []; S.tab = "estante"; S.filter = ""; render();
  });
  $$("[data-readrec]").forEach(b => b.onclick = () => { const r = S.recs.find(x => x.id === b.dataset.readrec); openForm(null, { title:r.title, author:r.author, genre:r.genre, blurb:r.blurb, cover_url:r.cover_url }, r.id); });
  $$("[data-shops]").forEach(b => b.onclick = () => openShops(S.recs.find(x => x.id === b.dataset.shops)));
  const ys = $("#yearSel"); if (ys) ys.onchange = () => { S.statYear = +ys.value; render(); };
  $$("[data-accept]").forEach(b => b.onclick = async () => { b.disabled = true; await sb.from("friendships").update({ status:"accepted" }).eq("requester", b.dataset.accept).eq("addressee", S.me.id); loadAll(); });
  $$("[data-reject]").forEach(b => b.onclick = async () => { b.disabled = true; await sb.from("friendships").delete().eq("requester", b.dataset.reject).eq("addressee", S.me.id); loadAll(); });
  $$("[data-cancel]").forEach(b => b.onclick = async () => { b.disabled = true; await sb.from("friendships").delete().eq("requester", S.me.id).eq("addressee", b.dataset.cancel); loadAll(); });
  const uq = $("#userQ");
  if (uq) { let t; uq.oninput = () => { clearTimeout(t); t = setTimeout(() => searchUsers(uq.value), 250); }; }
  const tip = $("#tip");
  $$("[data-tip]").forEach(el => {
    const show = () => { tip.textContent = el.dataset.tip; tip.hidden = false; const r = el.getBoundingClientRect();
      tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width/2 - tip.offsetWidth/2)) + "px"; tip.style.top = (r.top - tip.offsetHeight - 8) + "px"; };
    el.onmouseenter = show; el.onfocus = show; el.onmouseleave = el.onblur = () => tip.hidden = true;
  });
}

async function searchUsers(text){
  const box = $("#userResults"); const q = text.trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const { data } = await sb.from("profiles").select("*").ilike("username", `${q.replace(/[%_]/g, "\\$&")}%`).neq("id", S.me.id).limit(8);
  if (!data?.length) { box.innerHTML = `<p class="ai-note">No encontramos a @${esc(q)}.</p>`; return; }
  box.innerHTML = data.map(p => { S.profiles[p.id] = p;
    const st = S.friends.includes(p.id) ? `<span class="status">Ya son amigos</span>` : S.outgoing.includes(p.id) ? `<span class="status">Solicitud enviada</span>` :
      S.incoming.includes(p.id) ? `<button class="btn small primary" data-accept2="${p.id}">Aceptar</button>` : `<button class="btn small primary" data-addf="${p.id}">Agregar</button>`;
    return `<div class="row-item">${avatar(p,true)}<div class="grow"><b>${esc(p.display_name||p.username)}</b> <small>@${esc(p.username)}</small></div>${st}</div>`; }).join("");
  box.querySelectorAll("[data-addf]").forEach(b => b.onclick = async () => {
    b.disabled = true; const { error } = await sb.from("friendships").insert({ requester: S.me.id, addressee: b.dataset.addf });
    b.outerHTML = `<span class="status">${error ? "No se pudo enviar" : "Solicitud enviada"}</span>`; if (!error) S.outgoing.push(b.dataset.addf);
  });
  box.querySelectorAll("[data-accept2]").forEach(b => b.onclick = async () => { await sb.from("friendships").update({ status:"accepted" }).eq("requester", b.dataset.accept2).eq("addressee", S.me.id); loadAll(); });
}

/* ---------- Drawer ---------- */
function openDrawer(html){ const d = $("#drawer"); d.innerHTML = `<button class="close" aria-label="Cerrar">×</button>` + html; d.hidden = false; $("#scrim").hidden = false; d.querySelector(".close").onclick = closeDrawer; d.scrollTop = 0; }
function closeDrawer(){ $("#drawer").hidden = true; $("#scrim").hidden = true; }
$("#scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

function shopLinks(b){
  const q = encodeURIComponent(`"${b.title}" ${b.author||""}`.trim());
  const g = site => `https://www.google.com/search?q=site%3A${site}+${q}`;
  const slug = (b.title + " " + (b.author||"")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const shops = [
    ["Bookshop","Librería · Montevideo",g("bookshop.com.uy")],
    ["Puro Verso","Librería · varios locales",g("puroverso.uy")],
    ["Librería Ávila","Librería · Montevideo",g("libreriavila.com.uy")],
    ["Buscalibre","Importación · envío a domicilio",g("buscalibre.uy")],
    ["Mercado Libre","Nuevos y usados","https://listado.mercadolibre.com.uy/" + slug]
  ];
  return `<div class="shops">${shops.map(([n,s,u]) => `<a class="shop" href="${u}" target="_blank" rel="noopener"><span><b>${n}</b><br><small>${s}</small></span><span class="go">Buscar ↗</span></a>`).join("")}</div>
    <p class="ai-note" style="margin-top:8px">Por ahora abre la búsqueda en cada tienda. El stock en tiempo real viene en una próxima versión.</p>`;
}
function openShops(b){ openDrawer(`<div class="eyebrow">Dónde conseguirlo</div><h2 class="d-title">${esc(b.title)}</h2><div class="d-author">${esc(b.author)}</div><div class="section">${shopLinks(b)}</div>`); }

function openBook(id){
  const mine = !S.viewing;
  const b = (mine ? S.books : S.viewingBooks).find(x => x.id === id); if (!b) return;
  const d = daysOf(b);
  openDrawer(`${b.cover_url ? `<img class="cover" src="${esc(b.cover_url)}" alt="">` : ""}
    <div class="eyebrow">${esc(b.genre||"Otro")}${b.year?` · ${b.year}`:""}</div>
    <h2 class="d-title">${esc(b.title)}</h2><div class="d-author">${esc(b.author)}</div>
    <div class="stars" aria-label="${b.rating||0} de 5">${starStr(b.rating)}</div>
    ${b.blurb ? `<div class="blurb" style="clear:both">${esc(b.blurb)}</div>` : ""}
    <div class="facts">
      <div class="fact"><b>${d ?? "—"}</b><span>días de lectura</span></div>
      <div class="fact"><b>${b.pages || "—"}</b><span>páginas</span></div>
      <div class="fact"><b>${d && b.pages ? Math.round(b.pages/d) : "—"}</b><span>pág. por día</span></div>
    </div>
    <div style="font-size:13px;color:var(--ink2)">Del ${fmtDate(b.start_date)} al ${fmtDate(b.end_date)}</div>
    ${b.note ? `<div class="section"><h4>${mine?"Tu nota":"Su nota"}</h4><q class="d-author" style="font-size:16px">${esc(b.note)}</q></div>` : ""}
    <div class="section"><h4>Dónde conseguirlo</h4>${shopLinks(b)}</div>
    ${mine ? `<div class="section"><h4>Recomendar a un amigo</h4>
      ${S.friends.length ? `<div class="form" style="margin-top:0">
        <label>Para<select id="recTo">${S.friends.map(fid => `<option value="${fid}">${esc(S.profiles[fid]?.display_name || S.profiles[fid]?.username)} (@${esc(S.profiles[fid]?.username)})</option>`).join("")}</select></label>
        <label>¿Por qué se lo recomendás?<input id="recNote" maxlength="200" placeholder="Te va a gustar porque…"></label>
        <div class="actions"><button class="btn primary small" id="recSend">Recomendar</button><span class="status" id="recStatus"></span></div></div>`
      : `<p class="ai-note">Agregá amigos en la pestaña Amigos para poder recomendarles libros.</p>`}</div>
      <div class="actions section"><button class="btn" id="editB">Editar</button><button class="btn ghost danger" id="delB">Borrar</button></div>`
    : `<div class="actions section"><button class="btn primary" id="wantB">Lo leí, cargarlo a mi estante</button></div>`}`);
  if (mine) {
    $("#editB").onclick = () => openForm(b);
    let armed = false;
    $("#delB").onclick = async () => { if (!armed) { armed = true; $("#delB").textContent = "Tocá de nuevo para borrar"; return; }
      await sb.from("books").delete().eq("id", b.id); closeDrawer(); loadAll(); };
    const send = $("#recSend");
    if (send) send.onclick = async () => { send.disabled = true;
      const { error } = await sb.from("recommendations").insert({ from_user:S.me.id, to_user:$("#recTo").value, title:b.title, author:b.author, genre:b.genre, blurb:b.blurb, cover_url:b.cover_url, note:$("#recNote").value.trim() || null });
      $("#recStatus").textContent = error ? "No se pudo enviar. Probá de nuevo." : "Recomendación enviada ✓"; if (!error) { $("#recNote").value = ""; loadAll(); }
      send.disabled = false; };
  } else {
    $("#wantB").onclick = () => openForm(null, { title:b.title, author:b.author, genre:b.genre, blurb:b.blurb, pages:b.pages, year:b.year, cover_url:b.cover_url, isbn:b.isbn });
  }
}

/* ---------- Google Books ---------- */
function mapGenre(cats = []){
  const c = cats.join(" ").toLowerCase();
  const rules = [[/science fiction|ciencia ficci/,"Ciencia ficción"],[/fantas/,"Fantasía"],[/mystery|detective|thriller|suspense|crime|policial|misterio/,"Policial y suspenso"],[/romance|romántic/,"Romance"],[/poetry|poes/,"Poesía"],[/short stor|cuento/,"Cuentos"],[/juvenile|young adult|infantil|juvenil/,"Infantil y juvenil"],[/biograph|memoir|autobiogr/,"Biografía y memorias"],[/histor/,"Historia"],[/business|econom|negocio|finanz/,"Negocios y economía"],[/self-help|psycholog|autoayuda|psicolog/,"Psicología y autoayuda"],[/science|ciencia|nature|mathem/,"Ciencia"],[/philosoph|essay|ensayo|political|social/,"Ensayo"],[/classic|clásic/,"Clásicos"],[/fiction|ficción|novel|literatur/,"Novela"]];
  for (const [re, g] of rules) if (re.test(c)) return g;
  return "";
}
async function searchBooks(title, author){
  const q = `intitle:${title}${author ? `+inauthor:${author}` : ""}`;
  const base = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books`;
  let res = await fetch(base + "&langRestrict=es").then(r => r.json()).catch(() => ({}));
  if (!res.items?.length) res = await fetch(base).then(r => r.json()).catch(() => ({}));
  return (res.items || []).map(it => { const v = it.volumeInfo || {};
    const isbn = (v.industryIdentifiers || []).find(x => x.type === "ISBN_13")?.identifier || (v.industryIdentifiers || [])[0]?.identifier || "";
    const tmp = document.createElement("div"); tmp.innerHTML = v.description || "";
    return { title: v.title + (v.subtitle ? `: ${v.subtitle}` : ""), author: (v.authors || []).join(", "), blurb: tmp.textContent.trim(), pages: v.pageCount || null,
      year: v.publishedDate ? +v.publishedDate.slice(0,4) : null, genre: mapGenre(v.categories), isbn,
      cover_url: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://", "https://") };
  }).sort((a,b) => (!!b.blurb) - (!!a.blurb));
}

/* ---------- Form ---------- */
function openForm(book, prefill, recId){
  const b = book || { title:"", author:"", genre:"", blurb:"", pages:"", year:"", rating:0, start_date:"", end_date:today(), note:"", cover_url:"", isbn:"", ...(prefill||{}) };
  let rating = b.rating || 0, cover = b.cover_url || "", isbn = b.isbn || "";
  openDrawer(`<div class="eyebrow">${book ? "Editar libro" : "Cargar libro leído"}</div>
    <h2 class="d-title">${book ? esc(book.title) : "¿Qué leíste?"}</h2>
    <form class="form" id="bf">
      <label>Título<input id="fTitle" required value="${esc(b.title)}" placeholder="Ej: La tregua"></label>
      <label>Autor<input id="fAuthor" value="${esc(b.author)}" placeholder="Ej: Mario Benedetti"></label>
      <div class="actions"><button type="button" class="btn" id="fetchB">Buscar contratapa</button><span class="status" id="fStatus"></span></div>
      <div class="results" id="fResults"></div>
      <label>Contratapa<textarea id="fBlurb" placeholder="Tocá “Buscar contratapa” o escribila vos">${esc(b.blurb)}</textarea></label>
      <div class="grid2">
        <label>Género<select id="fGenre">${GENRES.map(g => `<option ${g===b.genre?"selected":""}>${g}</option>`).join("")}</select></label>
        <div class="grid2"><label>Páginas<input id="fPages" type="number" min="1" inputmode="numeric" value="${esc(b.pages)}"></label><label>Año<input id="fYear" type="number" inputmode="numeric" value="${esc(b.year)}"></label></div>
      </div>
      <div class="grid2"><label>Empecé<input id="fStart" type="date" value="${esc(b.start_date)}"></label><label>Terminé<input id="fEnd" type="date" value="${esc(b.end_date)}"></label></div>
      <label>Puntaje<div class="rate" id="fRate">${[1,2,3,4,5].map(n => `<button type="button" data-n="${n}" aria-label="${n} estrellas">★</button>`).join("")}</div></label>
      <label>Nota personal<input id="fNote" maxlength="240" value="${esc(b.note)}" placeholder="Qué te dejó, a quién se lo recomendarías…"></label>
      <div class="actions"><button class="btn primary" type="submit" id="fSave">${book ? "Guardar cambios" : "Guardar en mi estante"}</button><span class="status" id="fSaveStatus"></span></div>
    </form>`);
  if (!b.genre) $("#fGenre").value = "Novela";
  const paint = () => $$("#fRate button").forEach(x => x.classList.toggle("on", +x.dataset.n <= rating));
  paint();
  $$("#fRate button").forEach(x => x.onclick = () => { rating = +x.dataset.n === rating ? 0 : +x.dataset.n; paint(); });
  $("#fetchB").onclick = async () => {
    const title = $("#fTitle").value.trim(); if (!title) { $("#fStatus").textContent = "Escribí el título primero."; return; }
    $("#fStatus").textContent = "Buscando…";
    const items = await searchBooks(title, $("#fAuthor").value.trim());
    const box = $("#fResults");
    if (!items.length) { $("#fStatus").textContent = "No lo encontramos. Completalo a mano."; box.innerHTML = ""; return; }
    $("#fStatus").textContent = "Elegí tu edición:";
    box.innerHTML = items.slice(0,5).map((it,i) => `<button type="button" class="result" data-i="${i}">${it.cover_url ? `<img src="${esc(it.cover_url)}" alt="">` : `<span class="noimg"></span>`}<span><b>${esc(it.title)}</b><small>${esc(it.author)}${it.year?` · ${it.year}`:""}${it.pages?` · ${it.pages} pág.`:""}${it.blurb?"":" · sin contratapa"}</small></span></button>`).join("");
    box.querySelectorAll(".result").forEach(btn => btn.onclick = () => { const it = items[+btn.dataset.i];
      $("#fTitle").value = it.title; if (it.author) $("#fAuthor").value = it.author;
      if (it.blurb) $("#fBlurb").value = it.blurb; if (it.genre) $("#fGenre").value = it.genre;
      if (it.pages) $("#fPages").value = it.pages; if (it.year) $("#fYear").value = it.year;
      cover = it.cover_url; isbn = it.isbn; box.innerHTML = ""; $("#fStatus").textContent = "Listo. Revisá y ajustá lo que quieras."; });
  };
  $("#bf").onsubmit = async e => {
    e.preventDefault();
    const data = { title:$("#fTitle").value.trim(), author:$("#fAuthor").value.trim() || null, genre:$("#fGenre").value, blurb:$("#fBlurb").value.trim() || null,
      pages:+$("#fPages").value || null, year:+$("#fYear").value || null, rating, start_date:$("#fStart").value || null, end_date:$("#fEnd").value || null,
      note:$("#fNote").value.trim() || null, cover_url:cover || null, isbn:isbn || null };
    if (!data.title) return;
    if (data.start_date && data.end_date && data.start_date > data.end_date) { $("#fSaveStatus").textContent = "La fecha de inicio es posterior a la de fin."; return; }
    $("#fSave").disabled = true; $("#fSaveStatus").textContent = "Guardando…";
    const { error } = book ? await sb.from("books").update(data).eq("id", book.id) : await sb.from("books").insert({ ...data, user_id: S.me.id });
    if (error) { $("#fSaveStatus").textContent = "No se pudo guardar. Probá de nuevo."; $("#fSave").disabled = false; return; }
    if (recId) await sb.from("recommendations").update({ done:true }).eq("id", recId);
    closeDrawer(); S.tab = "estante"; S.viewing = null; loadAll();
  };
}
