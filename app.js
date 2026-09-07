const { createClient } = window.supabase;
const cfg = window.SUPABASE_CONFIG || {};
const sb = createClient(cfg.url, cfg.anonKey);

let session = null;
let profile = null;
let blacklistCache = [];
let requestCache = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => el.classList.remove("show"), 2600);
}
function esc(v="") {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function roleLabel(role) {
  return role === "admin" ? "ADMIN" : role === "direction" ? "DIRECTION" : "RESPONSABLE";
}
function canManageBlacklist() { return ["admin","direction"].includes(profile?.role); }
function isAdmin() { return profile?.role === "admin"; }

function openModal(html) {
  $("#modalContent").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modalContent").innerHTML = "";
}
$$("[data-close-modal]").forEach(x => x.addEventListener("click", closeModal));

function setPage(page) {
  $$(".page").forEach(x => x.classList.add("hidden"));
  $(`#page-${page}`).classList.remove("hidden");
  $$(".nav-item").forEach(x => x.classList.toggle("active", x.dataset.page === page));
  const titles = {dashboard:"Tableau de bord", blacklist:"Blacklist", requests:"Demandes de Blacklist", users:"Comptes & rôles"};
  $("#pageTitle").textContent = titles[page] || "Mairie de San Andreas";
  if (page === "blacklist") loadBlacklist();
  if (page === "requests") loadRequests();
  if (page === "users") loadUsers();
}

function applyRoleUI() {
  const admin = isAdmin();
  const manager = canManageBlacklist();
  $$(".admin-nav,.admin-quick").forEach(x => x.classList.toggle("hidden", !admin));
  $("#addBlacklistBtn").classList.toggle("hidden", !manager);
  $$(".request-only").forEach(x => x.classList.toggle("hidden", profile?.role === undefined));
  $("#currentName").textContent = profile?.display_name || "Utilisateur";
  $("#currentRole").textContent = roleLabel(profile?.role || "");
  $("#avatar").textContent = (profile?.display_name || "?").trim().charAt(0).toUpperCase();
  $("#welcomeName").textContent = profile?.display_name?.split(" ")[0] || "collègue";
}

async function getMyProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
  if (error) throw error;
  profile = data;
}

async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) return showLogin();
  try {
    await getMyProfile();
    if (!profile.active) {
      await sb.auth.signOut();
      throw new Error("Votre compte est désactivé.");
    }
    showApp();
    await refreshAll();
  } catch (e) {
    $("#loginError").textContent = e.message;
    await sb.auth.signOut();
    showLogin();
  }
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}
function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRoleUI();
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#loginError").textContent = "";
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const { data, error } = await sb.auth.signInWithPassword({email,password});
  if (error) { $("#loginError").textContent = "Connexion impossible : " + error.message; return; }
  session = data.session;
  try {
    await getMyProfile();
    if (!profile.active) throw new Error("Votre compte est désactivé.");
    showApp(); await refreshAll(); toast("Connexion réussie.");
  } catch (err) {
    $("#loginError").textContent = err.message;
    await sb.auth.signOut();
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  session = null; profile = null; showLogin();
});
$$("[data-page]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));

async function refreshAll() {
  await Promise.all([loadBlacklist(), loadRequests(), loadUsers(true)]);
}

async function loadBlacklist() {
  const { data, error } = await sb.from("blacklist")
    .select("*, created_by_profile:profiles!blacklist_created_by_fkey(display_name), updated_by_profile:profiles!blacklist_updated_by_fkey(display_name)")
    .order("created_at",{ascending:false});
  if (error) { console.error(error); $("#blacklistBody").innerHTML = `<tr><td colspan="6" class="empty">Impossible de charger la Blacklist.</td></tr>`; return; }
  blacklistCache = data || [];
  renderBlacklist();
  $("#statBlacklist").textContent = blacklistCache.length;
}
function renderBlacklist() {
  const q = ($("#blacklistSearch")?.value || "").toLowerCase();
  const rows = blacklistCache.filter(x => `${x.first_name} ${x.last_name} ${x.unique_id} ${x.reason}`.toLowerCase().includes(q));
  if (!rows.length) { $("#blacklistBody").innerHTML = `<tr><td colspan="6" class="empty">Aucune personne trouvée.</td></tr>`; return; }
  $("#blacklistBody").innerHTML = rows.map(x => `
    <tr>
      <td><span class="person">${esc(x.first_name)} ${esc(x.last_name)}</span></td>
      <td><b>${esc(x.unique_id)}</b></td>
      <td>${esc(x.reason)}</td>
      <td>${esc(x.created_by_profile?.display_name || "Compte supprimé")}${x.updated_by ? `<span class="sub">Dernière modification : ${esc(x.updated_by_profile?.display_name || "—")}</span>` : ""}</td>
      <td>${new Date(x.created_at).toLocaleString("fr-FR")}</td>
      <td>${canManageBlacklist() ? `<div class="actions"><button class="action edit" data-edit="${x.id}">Modifier</button><button class="action delete" data-delete="${x.id}">Supprimer</button></div>` : "Lecture seule"}</td>
    </tr>`).join("");
  $$("[data-edit]").forEach(b => b.addEventListener("click", () => blacklistForm(blacklistCache.find(x => x.id === b.dataset.edit))));
  $$("[data-delete]").forEach(b => b.addEventListener("click", () => deleteBlacklist(b.dataset.delete)));
}
$("#blacklistSearch").addEventListener("input", renderBlacklist);
$("#refreshBlacklist").addEventListener("click", loadBlacklist);
$("#addBlacklistBtn").addEventListener("click", () => blacklistForm());

function blacklistForm(item=null) {
  if (!canManageBlacklist()) return;
  openModal(`
    <h3>${item ? "Modifier une entrée" : "Ajouter à la Blacklist"}</h3>
    <p>Les informations seront enregistrées avec l'identité du compte qui effectue l'action.</p>
    <form id="blacklistForm">
      <label>Prénom<input id="blFirst" required value="${esc(item?.first_name || "")}"></label>
      <label>Nom<input id="blLast" required value="${esc(item?.last_name || "")}"></label>
      <label>ID unique<input id="blId" required value="${esc(item?.unique_id || "")}"></label>
      <label>Raison<textarea id="blReason" required>${esc(item?.reason || "")}</textarea></label>
      <div class="form-actions"><button type="button" class="btn secondary" data-close-modal>Annuler</button><button class="btn primary">${item ? "Enregistrer" : "Ajouter"}</button></div>
    </form>`);
  $("[data-close-modal]").addEventListener("click", closeModal);
  $("#blacklistForm").addEventListener("submit", async e => {
    e.preventDefault();
    const payload = {first_name:$("#blFirst").value.trim(),last_name:$("#blLast").value.trim(),unique_id:$("#blId").value.trim(),reason:$("#blReason").value.trim()};
    let result;
    if (item) result = await sb.from("blacklist").update({...payload,updated_by:session.user.id}).eq("id",item.id);
    else result = await sb.from("blacklist").insert({...payload,created_by:session.user.id,updated_by:session.user.id});
    if (result.error) return toast(result.error.message);
    closeModal(); toast(item ? "Blacklist modifiée." : "Personne ajoutée à la Blacklist."); await loadBlacklist();
  });
}
async function deleteBlacklist(id) {
  if (!canManageBlacklist() || !confirm("Supprimer cette entrée de la Blacklist ?")) return;
  const { error } = await sb.from("blacklist").delete().eq("id",id);
  if (error) return toast(error.message);
  toast("Entrée supprimée."); await loadBlacklist();
}

async function loadRequests() {
  const { data, error } = await sb.from("blacklist_requests")
    .select("*, requester:profiles!blacklist_requests_requested_by_fkey(display_name), reviewer:profiles!blacklist_requests_reviewed_by_fkey(display_name)")
    .order("created_at",{ascending:false});
  if (error) { console.error(error); return; }
  requestCache = data || [];
  const pending = requestCache.filter(x => x.status === "pending").length;
  $("#requestBadge").textContent = pending; $("#requestBadge").classList.toggle("hidden", pending === 0);
  $("#statRequests").textContent = pending;
  renderRequests();
}
function renderRequests() {
  if (!requestCache.length) { $("#requestsBody").innerHTML = `<tr><td colspan="7" class="empty">Aucune demande.</td></tr>`; return; }
  $("#requestsBody").innerHTML = requestCache.map(x => `
    <tr>
      <td><span class="person">${esc(x.first_name)} ${esc(x.last_name)}</span></td>
      <td>${esc(x.unique_id)}</td><td>${esc(x.reason)}</td>
      <td>${esc(x.requester?.display_name || "—")}</td>
      <td><span class="state ${x.status === "pending" ? "pending" : x.status === "approved" ? "active" : "inactive"}">${x.status === "pending" ? "EN ATTENTE" : x.status === "approved" ? "APPROUVÉE" : "REFUSÉE"}</span>${x.review_note ? `<span class="sub">${esc(x.review_note)}</span>`:""}</td>
      <td>${new Date(x.created_at).toLocaleString("fr-FR")}</td>
      <td>${canManageBlacklist() && x.status === "pending" ? `<div class="actions"><button class="action approve" data-approve="${x.id}">Approuver</button><button class="action reject" data-reject="${x.id}">Refuser</button></div>` : "—"}</td>
    </tr>`).join("");
  $$("[data-approve]").forEach(b => b.addEventListener("click", () => reviewRequest(b.dataset.approve,true)));
  $$("[data-reject]").forEach(b => b.addEventListener("click", () => reviewRequest(b.dataset.reject,false)));
}
$("#newRequestBtn").addEventListener("click", requestForm);
function requestForm() {
  openModal(`
    <h3>Demander un Blacklist</h3><p>La demande sera transmise à la Direction et restera en attente jusqu'à sa décision.</p>
    <form id="requestForm">
      <label>Prénom<input id="rqFirst" required></label><label>Nom<input id="rqLast" required></label>
      <label>ID unique<input id="rqId" required></label><label>Motif<textarea id="rqReason" required></textarea></label>
      <div class="form-actions"><button type="button" class="btn secondary" data-close-modal>Annuler</button><button class="btn primary">Envoyer la demande</button></div>
    </form>`);
  $("[data-close-modal]").addEventListener("click", closeModal);
  $("#requestForm").addEventListener("submit", async e => {
    e.preventDefault();
    const {error} = await sb.from("blacklist_requests").insert({first_name:$("#rqFirst").value.trim(),last_name:$("#rqLast").value.trim(),unique_id:$("#rqId").value.trim(),reason:$("#rqReason").value.trim(),requested_by:session.user.id});
    if(error) return toast(error.message);
    closeModal(); toast("Demande envoyée à la Direction."); await loadRequests();
  });
}
async function reviewRequest(id, approve) {
  if (!canManageBlacklist()) return;
  const req = requestCache.find(x => x.id === id); if (!req) return;
  const note = prompt(approve ? "Note facultative :" : "Motif du refus :");
  if (!approve && !note) return;
  const {error: reviewError} = await sb.from("blacklist_requests").update({status:approve?"approved":"rejected",reviewed_by:session.user.id,review_note:note || null,reviewed_at:new Date().toISOString()}).eq("id",id);
  if(reviewError) return toast(reviewError.message);
  if(approve) {
    const {error: addError} = await sb.from("blacklist").insert({first_name:req.first_name,last_name:req.last_name,unique_id:req.unique_id,reason:req.reason,created_by:session.user.id,updated_by:session.user.id});
    if(addError) return toast("Demande approuvée, mais ajout impossible : " + addError.message);
  }
  toast(approve ? "Demande approuvée et ajoutée à la Blacklist." : "Demande refusée.");
  await Promise.all([loadRequests(),loadBlacklist()]);
}

async function loadUsers(silent=false) {
  if(!isAdmin()) return;
  const {data,error} = await sb.from("profiles").select("*").order("created_at",{ascending:false});
  if(error) { if(!silent) toast(error.message); return; }
  $("#statUsers").textContent = data.filter(x=>x.active).length;
  $("#usersBody").innerHTML = data.map(u => `
    <tr>
      <td><b>${esc(u.display_name)}</b></td><td>${esc(u.email || "—")}</td>
      <td><span class="role ${u.role}">${roleLabel(u.role)}</span></td>
      <td><span class="state ${u.active?"active":"inactive"}">${u.active?"ACTIF":"DÉSACTIVÉ"}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString("fr-FR")}</td>
      <td><div class="actions"><button class="action edit" data-role="${u.id}">Rôle</button><button class="action ${u.active?"delete":"approve"}" data-toggle="${u.id}" data-active="${u.active}">${u.active?"Désactiver":"Activer"}</button></div></td>
    </tr>`).join("");
  $$("[data-role]").forEach(b => b.addEventListener("click", () => roleForm(b.dataset.role, data.find(u=>u.id===b.dataset.role))));
  $$("[data-toggle]").forEach(b => b.addEventListener("click", () => toggleUser(b.dataset.toggle,b.dataset.active==="true")));
}
$("#newUserBtn").addEventListener("click", userForm);
function userForm() {
  return `
    <div class="form-grid">
      <label>Prénom
        <input id="uFirstName" required placeholder="Pierre">
      </label>
      <label>Nom
        <input id="uLastName" required placeholder="Dupont">
      </label>
      <label>Mot de passe
        <input id="uPassword" type="password" required minlength="8" placeholder="Minimum 8 caractères">
      </label>
      <label>Rôle
        <select id="uRole">
          <option value="responsable">Responsable</option>
          <option value="direction">Direction</option>
          <option value="admin">Admin</option>
        </select>
      </label>
    </div>

    <div class="identifier-preview">
      <span>Identifiant généré</span>
      <strong id="uIdentifierPreview">—</strong>
      <small>Format automatique : Prénom.TROISPREMIÈRESLETTRESDUNOM@msa.com</small>
    </div>

    <div class="modal-actions">
      <button class="btn secondary" data-close-modal>Annuler</button>
      <button class="btn primary" id="saveUser">Créer le compte</button>
    </div>
  `;
}
function roleForm(id,u) {
  if(id===session.user.id) return toast("Pour éviter de vous bloquer, changez votre propre rôle depuis un autre compte Admin.");
  openModal(`<h3>Modifier le rôle</h3><p>${esc(u.display_name)}</p>
    <form id="roleForm"><label>Rôle<select id="roleSelect"><option value="responsable">Responsable</option><option value="direction">Direction</option><option value="admin">Admin</option></select></label>
    <div class="form-actions"><button type="button" class="btn secondary" data-close-modal>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
  $("#roleSelect").value=u.role;$("[data-close-modal]").addEventListener("click",closeModal);
  $("#roleForm").addEventListener("submit",async e=>{e.preventDefault();const {error}=await sb.from("profiles").update({role:$("#roleSelect").value}).eq("id",id);if(error)return toast(error.message);closeModal();toast("Rôle modifié.");await loadUsers();});
}
async function toggleUser(id,active) {
  if(id===session.user.id) return toast("Vous ne pouvez pas désactiver votre propre compte.");
  const {error}=await sb.from("profiles").update({active:!active}).eq("id",id);
  if(error)return toast(error.message);toast(active?"Compte désactivé.":"Compte activé.");await loadUsers();
}

sb.auth.onAuthStateChange(async (_event,newSession)=>{
  if(newSession && !session){session=newSession;try{await getMyProfile();if(profile.active){showApp();await refreshAll();}}catch(e){console.error(e)}}
});
boot();
