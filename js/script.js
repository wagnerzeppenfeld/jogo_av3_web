const SESSION_KEY = "alunoEspetacularToken";
let authMode = "login", currentUser = null, authToken = null, activeGame = null;
let sessionPoints = 0, memorySequence = [], memoryInput = [], memoryLocked = true;
let logicQuestion = 0, logicCorrect = 0, mathQuestion = 0, mathCorrect = 0;
let streak = 0, difficulty = 1, gameFinished = false;
const $ = id => document.getElementById(id);
const safeText = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ===== Armazenamento local (substitui o antigo servidor Node) =====
// Usuários, pontuação e ranking ficam no localStorage deste navegador.
// Projeto de aula: o hash de senha é simples e didático, não serve para produção.
const USERS_KEY = "alunoEspetacularUsuarios";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const readUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch { return []; } };
const writeUsers = users => { try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {} };
function hashPassword(text, salt) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const ch of `${salt}:${text}`) { const c = ch.codePointAt(0); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const publicUser = u => ({ username: u.username, points: u.points || 0, played: u.played || 0, xp: u.xp || 0, coins: u.coins || 0, avatar: u.avatar || null, owned: u.owned || [] });
const buildRanking = () => readUsers().map(publicUser).sort((a, b) => b.points - a.points || b.played - a.played || a.username.localeCompare(b.username));
const signToken = username => btoa(unescape(encodeURIComponent(JSON.stringify({ sub: username, exp: Date.now() + TOKEN_TTL_MS }))));
function userFromToken(token) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(token))));
    if (!data.sub || data.exp < Date.now()) return null;
    return readUsers().find(u => u.username === data.sub) || null;
  } catch { return null; }
}

// Mantém a mesma interface de antes: api("/api/rota", { method, body }).
async function api(path, options = {}) {
  const route = path.replace(/^\/api\//, "");
  const body = options.body ? JSON.parse(options.body) : {};
  const sessionError = "Sessão inválida ou expirada. Entre novamente.";

  if (route === "register" || route === "login") {
    const { username, password } = body;
    if (typeof username !== "string" || typeof password !== "string" || username.trim().length < 3 || username.trim().length > 18 || password.length < 4 || password.length > 200)
      throw new Error("Informe apelido (3 a 18 caracteres) e senha (mínimo 4 caracteres).");
    const name = username.trim(), users = readUsers();
    const existing = users.find(u => u.username.toLowerCase() === name.toLowerCase());
    let user;
    if (route === "register") {
      if (existing) throw new Error("Esse apelido já está em uso. Escolha outro.");
      const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      user = { username: name, salt, passwordHash: hashPassword(password, salt), points: 0, played: 0, xp: 0, coins: 0, createdAt: new Date().toISOString() };
      users.push(user); writeUsers(users);
    } else {
      if (!existing || hashPassword(password, existing.salt) !== existing.passwordHash) throw new Error("Apelido ou senha incorretos.");
      user = existing;
    }
    return { user: publicUser(user), token: signToken(user.username) };
  }
  if (route === "ranking") return { ranking: buildRanking() };
  if (route === "me") {
    const user = userFromToken(authToken);
    if (!user) throw new Error(sessionError);
    return { user: publicUser(user), ranking: buildRanking() };
  }
  if (route === "score") {
    const current = userFromToken(authToken);
    if (!current) throw new Error(sessionError);
    const points = body.points;
    if (!Number.isInteger(points) || points < 0 || points > 1000) throw new Error("Pontuação inválida.");
    const users = readUsers(), target = users.find(u => u.username === current.username);
    if (!target) throw new Error("Jogador não encontrado.");
    const coinsEarned = Math.floor(points / 10);
    target.points = (target.points || 0) + points; target.xp = (target.xp || 0) + points;
    target.coins = (target.coins || 0) + coinsEarned; target.played = (target.played || 0) + 1;
    target.updatedAt = new Date().toISOString(); writeUsers(users);
    return { user: publicUser(target), coinsEarned, position: buildRanking().findIndex(u => u.username === target.username) + 1 };
  }
  throw new Error("Rota não encontrada.");
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.auth === mode));
  $("auth-title").textContent = mode === "login" ? "Olá, explorador!" : "Prepare seu lançamento!";
  $("auth-subtitle").textContent = mode === "login" ? "Sua próxima aventura está esperando." : "Crie seu acesso e entre para a tripulação.";
  $("auth-submit").innerHTML = mode === "login" ? 'INICIAR MISSÃO <span>→</span>' : 'CRIAR MEU ACESSO <span>→</span>';
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-message").textContent = "";
}
document.querySelectorAll(".auth-tab").forEach(btn => btn.addEventListener("click", () => setAuthMode(btn.dataset.auth)));

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const username = $("username").value.trim(), password = $("password").value;
  const message = $("auth-message"), submit = $("auth-submit");
  message.textContent = "";
  if (username.length < 3 || password.length < 4) { message.textContent = "Use um apelido com 3 caracteres e senha com 4 ou mais."; return; }
  submit.disabled = true; submit.textContent = "CONECTANDO...";
  try {
    const result = await api(authMode === "register" ? "/api/register" : "/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    loginUser(result.user, result.token);
  } catch (error) { message.textContent = error.message; }
  finally { submit.disabled = false; submit.innerHTML = authMode === "login" ? 'INICIAR MISSÃO <span>→</span>' : 'CRIAR MEU ACESSO <span>→</span>'; }
});

function loginUser(user, token) {
  currentUser = user; authToken = token; sessionStorage.setItem(SESSION_KEY, token);
  $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); $("main-nav").classList.remove("hidden"); $("logout-btn").classList.remove("hidden");
  $("welcome-user").textContent = `✦ ${user.username}`; $("home-user").textContent = user.username;
  showView("home"); refreshDashboard();
}
function logout() {
  sessionStorage.removeItem(SESSION_KEY); currentUser = null; authToken = null;
  $("app-view").classList.add("hidden"); $("main-nav").classList.add("hidden"); $("logout-btn").classList.add("hidden"); $("auth-view").classList.remove("hidden");
  $("auth-form").reset(); setAuthMode("login");
}
$("logout-btn").addEventListener("click", logout);
function showView(view) {
  document.querySelectorAll(".page-view").forEach(el => el.classList.add("hidden"));
  const target = $(`${view}-view`); if (target) target.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "avatar" && typeof renderAvatar === "function") renderAvatar();
  if (view === "ranking") renderRanking(); if (view === "home") refreshDashboard();
}
document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.go)));
document.querySelectorAll("[data-game]").forEach(btn => btn.addEventListener("click", () => startGame(btn.dataset.game)));
$("back-games").addEventListener("click", () => showView("games"));

async function refreshDashboard() {
  if (!currentUser) return;
  try {
    const { user, ranking } = await api("/api/me"); currentUser = user; if (typeof applyAvatar === "function") applyAvatar(user);
    const position = ranking.findIndex(item => item.username === user.username) + 1;
    const xp = user.xp || 0, level = Math.floor(xp / 100) + 1, remainder = xp % 100;
    $("home-points").textContent = user.points || 0; $("home-played").textContent = user.played || 0;
    $("home-position").textContent = position ? `#${position}` : "—";
    $("home-xp").textContent = xp; $("home-level").textContent = level; $("home-coins").textContent = user.coins || 0;
    $("xp-progress").style.width = `${remainder}%`; $("xp-caption").textContent = `${remainder} / 100 XP para o próximo nível`;
    const tips = ["Cada tentativa treina seu cérebro. Errar também faz parte da descoberta!", "Uma boa estratégia começa observando com calma. Você consegue!", "Pequenos passos levam a grandes descobertas. Continue explorando!", "Seu cérebro fica mais forte quando você pratica coisas novas!"];
    $("mascot-tip").textContent = tips[(user.played || 0) % tips.length];
  } catch (error) { if (error.message.includes("sessão")) logout(); }
}
async function renderRanking() {
  try {
    const { ranking } = await api("/api/ranking");
    $("ranking-list").innerHTML = ranking.map((u, i) => `<div class="ranking-row"><span class="rank-number">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span><span class="rank-user"><span class="avatar">${typeof avatarHTML === "function" ? avatarHTML(u, 30) : "🤖"}</span>${safeText(u.username)}${u.username === currentUser?.username ? ' <small>(você)</small>' : ""}</span><span>${u.played}</span><span class="rank-score">${u.points} XP</span></div>`).join("");
    $("ranking-empty").classList.toggle("hidden", ranking.length > 0);
  } catch (error) { $("ranking-list").innerHTML = `<p class="empty-state">${safeText(error.message)}</p>`; }
}
$("restart-game").addEventListener("click", () => startGame(activeGame));
function startGame(game) {
  activeGame = game; sessionPoints = 0; streak = 0; difficulty = 1; gameFinished = false;
  $("session-points").textContent = "0"; $("game-feedback").textContent = ""; $("difficulty-note").textContent = "NÍVEL 1 • VOCÊ CONSEGUE!"; $("difficulty-note").classList.remove("level-up");
  showView("play");
  if (game === "memory") setupMemory(); if (game === "logic") setupLogic(); if (game === "math") setupMath();
  if (window.EXTRA_GAMES && EXTRA_GAMES[game]) EXTRA_GAMES[game]();
}
function setGameHeader(category, title, instructions) { $("play-category").textContent = category; $("play-title").textContent = title; $("play-instructions").textContent = instructions; }
function award(points) { sessionPoints += points; $("session-points").textContent = sessionPoints; }
function recordAnswer(correct) {
  if (correct) { streak++; if (streak >= 3 && difficulty < 3) { difficulty++; streak = 0; $("difficulty-note").textContent = `NÍVEL ${difficulty} • DESAFIO TURBINADO!`; $("difficulty-note").classList.add("level-up"); mascotSay("Uau! Você está pronto para um desafio maior!"); } }
  else { streak = 0; if (difficulty > 1) difficulty--; $("difficulty-note").textContent = `NÍVEL ${difficulty} • VAMOS COM CALMA!`; mascotSay("Tudo bem! Vamos tentar de outro jeito."); }
}
function mascotSay(message) { $("game-feedback").textContent = `🤖 Byte: ${message}`; }
async function finishGame(message) {
  if (gameFinished) return; gameFinished = true;
  $("game-feedback").textContent = `${message} Salvando suas conquistas...`;
  try {
    const result = await api("/api/score", { method: "POST", body: JSON.stringify({ points: sessionPoints }) });
    const bonus = result.coinsEarned || 0;
    $("game-feedback").textContent = `${message} Você ganhou ${sessionPoints} XP e ${bonus} moedas!`;
    $("game-area").innerHTML = `<div style="font-size:62px" aria-hidden="true">🌟</div><h3>MISSÃO CONCLUÍDA!</h3><p class="muted">${safeText(message)} Seu esforço fez a diferença!</p><p class="question-hint">+${sessionPoints} XP • +${bonus} moedas</p><button class="button button-primary" id="play-again">NOVA MISSÃO ↗</button> <button class="button button-quiet" id="see-ranking">VER HALL DA FAMA</button>`;
    $("play-again").addEventListener("click", () => startGame(activeGame)); $("see-ranking").addEventListener("click", () => showView("ranking"));
    await refreshDashboard(); celebrate();
  } catch (error) { $("game-feedback").textContent = `Não foi possível salvar sua pontuação: ${error.message}. Tente novamente.`; gameFinished = false; }
}
function celebrate() { const layer = $("confetti"); layer.innerHTML = ""; for (let i=0;i<48;i++) { const piece=document.createElement("i"); piece.className="confetti-piece"; piece.style.left=`${Math.random()*100}%`; piece.style.background=["#57e6f2","#ff78b7","#ffd66b","#a18bff"][i%4]; piece.style.animationDelay=`${Math.random()*.45}s`; layer.appendChild(piece); } setTimeout(()=>layer.innerHTML="",2400); }

// MEMORY: each completed sequence awards XP; the sequence grows every round.
function setupMemory() {
  setGameHeader("🧠 SETOR 01 • MEMÓRIA", "Templo das Memórias", "Observe as luzes e repita a sequência na ordem certa.");
  memorySequence=[]; memoryInput=[]; memoryLocked=true;
  $("game-area").innerHTML=`<div class="memory-lights">${[0,1,2,3].map(i=>`<button class="light-btn light-${i}" data-light="${i}" aria-label="Luz ${i+1}" disabled></button>`).join("")}</div><p class="question-number" id="memory-status">Pronto para observar?</p><button id="memory-start" class="button button-primary">MOSTRAR SEQUÊNCIA</button>`;
  $("memory-start").addEventListener("click", nextMemoryRound);
}
function nextMemoryRound() { if (gameFinished) return; memorySequence.push(Math.floor(Math.random()*4)); memoryInput=[]; memoryLocked=true; $("round-label").textContent=`Fase ${memorySequence.length}`; $("memory-status").textContent="Olhos atentos! Memorize..."; $("memory-start").disabled=true; showMemorySequence(0); }
function showMemorySequence(index) { const buttons=[...document.querySelectorAll("[data-light]")]; if(index>=memorySequence.length){memoryLocked=false;buttons.forEach(b=>b.disabled=false);$("memory-status").textContent="Sua vez! Repita a sequência.";$("memory-start").textContent="PRÓXIMA FASE";$("memory-start").disabled=true;return;} const button=buttons[memorySequence[index]]; setTimeout(()=>{button.classList.add("lit");setTimeout(()=>{button.classList.remove("lit");showMemorySequence(index+1)},430)},420); }
$("game-area").addEventListener("click", event => { const btn=event.target.closest("[data-light]"); if(!btn||activeGame!=="memory"||memoryLocked||gameFinished)return; const value=Number(btn.dataset.light);memoryInput.push(value);btn.classList.add("lit");setTimeout(()=>btn.classList.remove("lit"),180);const pos=memoryInput.length-1;if(memorySequence[pos]!==value){memoryLocked=true;recordAnswer(false);finishGame("Boa tentativa! A prática fortalece sua memória.");return;}if(memoryInput.length===memorySequence.length){recordAnswer(true);const points=memorySequence.length*5*difficulty;award(points);if(memorySequence.length>=6){finishGame("Memória extraordinária! Você completou todas as fases.");}else{$("memory-status").textContent=`Sequência perfeita! +${points} XP. Pronto para avançar?`;$("memory-start").disabled=false;mascotSay("Sequência completa! Sua memória está brilhando!");}} });

const logicBase=[{q:"2, 4, 6, 8, ?",a:10,o:[9,10,12],why:"A sequência aumenta de 2 em 2."},{q:"🔴 🔵 🔴 🔵 ?",a:"🔴",o:["🔴","🟢","🔵"],why:"As cores se alternam entre vermelho e azul."},{q:"5, 10, 15, 20, ?",a:25,o:[22,25,30],why:"Cada número aumenta 5."},{q:"🐱 🐶 🐱 🐶 ?",a:"🐱",o:["🐱","🐰","🐶"],why:"Os animais se alternam entre gato e cachorro."},{q:"1, 2, 4, 8, ?",a:16,o:[10,12,16],why:"Cada número é o dobro do anterior."}];
function setupLogic(){logicQuestion=0;logicCorrect=0;setGameHeader("🧩 SETOR 02 • LÓGICA","Planeta dos Padrões","Descubra a regra escondida e escolha a resposta que completa a sequência.");renderLogicQuestion();}
function renderLogicQuestion(){const base=logicBase[logicQuestion%logicBase.length];let q={...base};if(difficulty>=2&&logicQuestion>=2)q={q:"3, 6, 12, 24, ?",a:48,o:[36,42,48],why:"Cada número é multiplicado por 2."};if(difficulty>=3&&logicQuestion>=3)q={q:"2, 5, 11, 23, ?",a:47,o:[35,46,47],why:"Multiplicamos por 2 e somamos 1."};$("round-label").textContent=`Enigma ${logicQuestion+1} de 5`;$("game-area").innerHTML=`<div class="question-number">DECIFRE O PADRÃO • NÍVEL ${difficulty}</div><div class="math-question">${q.q}</div><div class="answer-options">${q.o.map(v=>`<button class="answer-btn" data-answer="${safeText(v)}">${safeText(v)}</button>`).join("")}</div>`;document.querySelectorAll("[data-answer]").forEach(btn=>btn.addEventListener("click",()=>{if(gameFinished)return;const answer=isNaN(q.a)?btn.dataset.answer:Number(btn.dataset.answer);const correct=answer===q.a;if(correct){logicCorrect++;const pts=10*difficulty;award(pts);recordAnswer(true);mascotSay(`Isso mesmo! ${q.why} +${pts} XP.`);}else{recordAnswer(false);mascotSay(`Boa tentativa! ${q.why}`);}logicQuestion++;if(logicQuestion>=5)finishGame(`Você acertou ${logicCorrect} de 5 enigmas!`);else setTimeout(renderLogicQuestion,850);}));}

function setupMath(){mathQuestion=0;mathCorrect=0;setGameHeader("🔢 SETOR 03 • MATEMÁTICA","Estação dos Números","Resolva as operações. A dificuldade acompanha seu progresso!");renderMathQuestion();}
function renderMathQuestion(){let max=difficulty===1?10:difficulty===2?20:50;const a=Math.floor(Math.random()*max)+1,b=Math.floor(Math.random()*max)+1;const subtract=Math.random()>.5;const x=subtract?Math.max(a,b):a,y=subtract?Math.min(a,b):b;const answer=subtract?x-y:x+y;const options=new Set([answer]);while(options.size<4)options.add(Math.max(0,answer+Math.floor(Math.random()*11)-5));const shuffled=[...options].sort(()=>Math.random()-.5);$("round-label").textContent=`Operação ${mathQuestion+1} de 5`;$("game-area").innerHTML=`<div class="question-number">QUANTO É? • NÍVEL ${difficulty}</div><div class="math-question">${x} ${subtract?"−":"+"} ${y} = ?</div><div class="answer-options">${shuffled.map(v=>`<button class="answer-btn" data-math="${v}">${v}</button>`).join("")}</div>`;document.querySelectorAll("[data-math]").forEach(btn=>btn.addEventListener("click",()=>{if(gameFinished)return;const correct=Number(btn.dataset.math)===answer;if(correct){mathCorrect++;const pts=10*difficulty;award(pts);recordAnswer(true);mascotSay(`Acertou! Você ganhou ${pts} XP. Muito bem!`);}else{recordAnswer(false);mascotSay(`Quase! A resposta era ${answer}. Tente guardar essa estratégia.`);}mathQuestion++;if(mathQuestion>=5)finishGame(`Você acertou ${mathCorrect} de 5 operações!`);else setTimeout(renderMathQuestion,800);}));}

// Extras: novas modalidades (Caça-Pares, Quiz Cósmico, Corrida Relâmpago) e personalização de avatar.
// Carregado depois de app.js; usa as funções e variáveis globais dele.

/* ===================== AVATAR ===================== */
const AV_BASES = [
  { id: "robo", e: "🤖", c: 0 }, { id: "raposa", e: "🦊", c: 0 }, { id: "panda", e: "🐼", c: 0 },
  { id: "tigre", e: "🐯", c: 20 }, { id: "sapo", e: "🐸", c: 20 }, { id: "polvo", e: "🐙", c: 40 },
  { id: "unicornio", e: "🦄", c: 60 }, { id: "dragao", e: "🐲", c: 80 }
];
const AV_ACCS = [
  { id: "nenhum", e: "", c: 0 }, { id: "formatura", e: "🎓", c: 20 }, { id: "bone", e: "🧢", c: 20 },
  { id: "cartola", e: "🎩", c: 30 }, { id: "oculos", e: "🕶️", c: 30 }, { id: "coroa", e: "👑", c: 80 }
];
const AV_COLORS = [
  { id: "ciano", v: "#1f6f86", c: 0 }, { id: "rosa", v: "#a93d78", c: 0 }, { id: "roxo", v: "#5a47b8", c: 0 },
  { id: "dourado", v: "#b8892b", c: 25 }, { id: "verde", v: "#2f8f5b", c: 25 }, { id: "vermelho", v: "#b3414a", c: 25 }
];
const AV_DEFAULT = { base: "robo", acc: "nenhum", color: "ciano" };
const AV_GROUPS = [["base", "Personagem", AV_BASES], ["acc", "Acessório", AV_ACCS], ["color", "Cor do fundo", AV_COLORS]];
const avFind = (list, id) => list.find(i => i.id === id) || list[0];

function avatarHTML(u, size) {
  const a = { ...AV_DEFAULT, ...((u && u.avatar) || {}) };
  const b = avFind(AV_BASES, a.base), ac = avFind(AV_ACCS, a.acc), co = avFind(AV_COLORS, a.color);
  return `<span class="avatar-comp" style="--av-bg:${co.v}${size ? `;--av-size:${size}px` : ""}"><span class="av-acc">${ac.e}</span><span class="av-base">${b.e}</span></span>`;
}
function applyAvatar(user) { $("welcome-user").innerHTML = `${avatarHTML(user, 28)} ${safeText(user.username)}`; }
const avOwned = (u, kind, item) => item.c === 0 || (u.owned || []).includes(`${kind}:${item.id}`);

function avatarAction(kind, id) {
  const group = AV_GROUPS.find(g => g[0] === kind), item = group && group[2].find(i => i.id === id);
  const cur = userFromToken(authToken);
  if (!cur || !item) throw new Error("Sessão inválida ou expirada. Entre novamente.");
  const users = readUsers(), u = users.find(x => x.username === cur.username);
  u.owned = u.owned || [];
  const key = `${kind}:${id}`;
  if (item.c > 0 && !u.owned.includes(key)) {
    if ((u.coins || 0) < item.c) throw new Error(`Faltam ${item.c - (u.coins || 0)} moedas para este item.`);
    u.coins -= item.c; u.owned.push(key);
  }
  u.avatar = { ...AV_DEFAULT, ...(u.avatar || {}), [kind]: id };
  writeUsers(users);
  return publicUser(u);
}
function renderAvatar(msg) {
  const u = currentUser; if (!u) return;
  $("avatar-content").innerHTML = `<div class="avatar-preview">${avatarHTML(u, 120)}<div><strong>${safeText(u.username)}</strong><div class="avatar-coins">🪙 ${u.coins || 0} moedas</div><p class="muted" id="avatar-msg" role="status">${msg || "Toque num item para usar. Itens com 🪙 são comprados com moedas."}</p></div></div>` +
    AV_GROUPS.map(([kind, label, list]) => `<h3 class="avatar-label">${label}</h3><div class="avatar-grid">${list.map(it => {
      const own = avOwned(u, kind, it), on = (u.avatar || AV_DEFAULT)[kind] === it.id || (!u.avatar && AV_DEFAULT[kind] === it.id);
      const face = kind === "color" ? `<i class="swatch" style="background:${it.v}"></i>` : (it.e || "∅");
      return `<button class="avatar-item${on ? " on" : ""}${own ? "" : " locked"}" data-av-kind="${kind}" data-av-id="${it.id}" aria-pressed="${on}">${face}<small>${on ? "em uso" : own ? "tenho" : `🪙 ${it.c}`}</small></button>`;
    }).join("")}</div>`).join("");
}
document.addEventListener("click", event => {
  const btn = event.target.closest("[data-av-kind]"); if (!btn) return;
  try { currentUser = avatarAction(btn.dataset.avKind, btn.dataset.avId); applyAvatar(currentUser); renderAvatar("Visual atualizado! ✨"); refreshDashboard(); }
  catch (error) { renderAvatar(error.message); }
});

/* ===================== NOVAS MODALIDADES ===================== */
const rnd = n => Math.floor(Math.random() * n);
const shuffle = arr => [...arr].sort(() => Math.random() - .5);

// 1) Caça-Pares: 3 tabuleiros (3, 4 e 6 pares)
let pairRound = 0;
function setupPairs() {
  setGameHeader("🃏 SETOR 04 • MEMÓRIA", "Caça-Pares", "Vire as cartas e encontre todos os pares com poucas jogadas.");
  pairRound = 0; renderPairs();
}
function renderPairs() {
  const pairs = [3, 4, 6][pairRound];
  const set = shuffle(["🚀", "🪐", "⭐", "🌙", "☄️", "👽", "🛸", "🌍"]).slice(0, pairs), cards = shuffle([...set, ...set]);
  let first = null, lock = false, moves = 0, found = 0;
  $("round-label").textContent = `Tabuleiro ${pairRound + 1} de 3`;
  $("game-area").innerHTML = `<div class="question-number">JOGADAS: <b id="pair-moves">0</b></div><div class="pair-grid" style="--cols:${pairs === 3 ? 3 : 4}">${cards.map((_, i) => `<button class="pair-card" aria-label="Carta ${i + 1}">?</button>`).join("")}</div>`;
  const btns = [...document.querySelectorAll(".pair-card")];
  btns.forEach((b, i) => b.addEventListener("click", () => {
    if (gameFinished || lock || b.classList.contains("flip") || b.classList.contains("done")) return;
    b.textContent = cards[i]; b.classList.add("flip");
    if (first === null) { first = i; return; }
    const a = first; first = null; moves++; $("pair-moves").textContent = moves;
    if (cards[a] === cards[i]) {
      btns[a].classList.add("done"); b.classList.add("done"); found++;
      if (found === pairs) {
        const pts = Math.max(pairs * 5, pairs * 12 - (moves - pairs) * 3); award(pts);
        mascotSay(`Tabuleiro completo em ${moves} jogadas! +${pts} XP.`); pairRound++;
        if (pairRound >= 3) finishGame("Você encontrou todos os pares!"); else setTimeout(renderPairs, 1100);
      }
    } else {
      lock = true;
      setTimeout(() => { [btns[a], b].forEach(x => { x.classList.remove("flip"); x.textContent = "?"; }); lock = false; }, 700);
    }
  }));
}

// 2) Quiz Cósmico: 5 perguntas sorteadas de um banco de 12
const QUIZ = [
  { t: "🪐 ESPAÇO", q: "Qual planeta é conhecido como “planeta vermelho”?", o: ["Marte", "Vênus", "Júpiter"], a: "Marte", why: "Marte tem poeira avermelhada, rica em ferro." },
  { t: "🪐 ESPAÇO", q: "Qual é a estrela mais próxima da Terra?", o: ["O Sol", "Sirius", "Estrela Polar"], a: "O Sol", why: "O Sol é a estrela do nosso Sistema Solar." },
  { t: "🪐 ESPAÇO", q: "Quantos planetas tem o Sistema Solar?", o: ["7", "8", "9"], a: "8", why: "São oito, de Mercúrio a Netuno." },
  { t: "🪐 ESPAÇO", q: "Em volta de qual astro a Terra gira?", o: ["Sol", "Lua", "Marte"], a: "Sol", why: "A Terra leva um ano para dar a volta no Sol." },
  { t: "🌱 CIÊNCIAS", q: "Qual gás as plantas liberam na fotossíntese?", o: ["Oxigênio", "Gás carbônico", "Fumaça"], a: "Oxigênio", why: "As plantas liberam o oxigênio que respiramos." },
  { t: "🐾 CIÊNCIAS", q: "Qual destes animais é um mamífero?", o: ["Golfinho", "Tubarão", "Sardinha"], a: "Golfinho", why: "O golfinho respira ar e amamenta os filhotes." },
  { t: "🐝 CIÊNCIAS", q: "Qual destes é um inseto?", o: ["Abelha", "Aranha", "Minhoca"], a: "Abelha", why: "Insetos têm seis patas, como a abelha." },
  { t: "🌎 GEOGRAFIA", q: "Qual é a capital do Brasil?", o: ["Brasília", "Rio de Janeiro", "São Paulo"], a: "Brasília", why: "Brasília é a capital federal desde 1960." },
  { t: "🌊 GEOGRAFIA", q: "Qual é o maior oceano do planeta?", o: ["Pacífico", "Atlântico", "Índico"], a: "Pacífico", why: "O Oceano Pacífico cobre mais área que todos os outros." },
  { t: "📖 PORTUGUÊS", q: "Qual palavra está escrita corretamente?", o: ["Passarinho", "Pasarinho", "Passarinio"], a: "Passarinho", why: "Passarinho se escreve com dois S." },
  { t: "📖 PORTUGUÊS", q: "Quantas letras tem o alfabeto?", o: ["26", "23", "29"], a: "26", why: "Com K, W e Y, o alfabeto tem 26 letras." },
  { t: "🔢 NÚMEROS", q: "Quantos dias tem uma semana?", o: ["7", "5", "10"], a: "7", why: "De domingo a sábado são sete dias." }
];
let quizBank = [], quizIdx = 0, quizCorrect = 0, quizLocked = false;
function setupQuiz() {
  setGameHeader("🔭 SETOR 05 • CONHECIMENTO", "Quiz Cósmico", "Teste o que você sabe sobre espaço, natureza e palavras.");
  quizBank = shuffle(QUIZ).slice(0, 5); quizIdx = 0; quizCorrect = 0; quizLocked = false; renderQuiz();
}
function renderQuiz() {
  const q = quizBank[quizIdx];
  $("round-label").textContent = `Pergunta ${quizIdx + 1} de 5`;
  $("game-area").innerHTML = `<div class="question-number">${q.t}</div><div class="math-question quiz-q">${safeText(q.q)}</div><div class="answer-options">${shuffle(q.o).map(v => `<button class="answer-btn" data-quiz="${safeText(v)}">${safeText(v)}</button>`).join("")}</div>`;
  document.querySelectorAll("[data-quiz]").forEach(btn => btn.addEventListener("click", () => {
    if (gameFinished || quizLocked) return; quizLocked = true;
    if (btn.dataset.quiz === q.a) { quizCorrect++; award(10); mascotSay(`Correto! ${q.why} +10 XP.`); }
    else mascotSay(`Quase! ${q.why}`);
    quizIdx++;
    if (quizIdx >= 5) finishGame(`Você acertou ${quizCorrect} de 5 perguntas!`);
    else setTimeout(() => { quizLocked = false; renderQuiz(); }, 1600);
  }));
}

// 3) Corrida Relâmpago: 30 segundos de contas rápidas
let raceTimer = null, raceCorrect = 0, raceTime = 30;
function setupRace() {
  setGameHeader("⚡ SETOR 06 • VELOCIDADE", "Corrida Relâmpago", "Acerte o máximo de contas em 30 segundos!");
  clearInterval(raceTimer); raceCorrect = 0; raceTime = 30; $("round-label").textContent = "Contra o relógio";
  $("game-area").innerHTML = `<div class="race-bar"><span id="race-fill"></span></div><div class="question-number">TEMPO: <b id="race-time">30</b>s • ACERTOS: <b id="race-hits">0</b></div><div id="race-q"></div>`;
  nextRace();
  raceTimer = setInterval(() => {
    const t = $("race-time");
    if (!t || activeGame !== "race" || gameFinished || $("play-view").classList.contains("hidden")) { clearInterval(raceTimer); return; }
    raceTime--; t.textContent = raceTime; $("race-fill").style.width = `${raceTime / 30 * 100}%`;
    if (raceTime <= 0) { clearInterval(raceTimer); finishGame(`Tempo esgotado! Você acertou ${raceCorrect} contas.`); }
  }, 1000);
}
function nextRace() {
  const mul = difficulty >= 3, max = difficulty === 1 ? 10 : difficulty === 2 ? 20 : 12;
  const a = rnd(max) + 1, b = rnd(max) + 1, ans = mul ? a * b : a + b;
  const opts = new Set([ans]); while (opts.size < 4) opts.add(Math.max(0, ans + rnd(11) - 5));
  $("race-q").innerHTML = `<div class="math-question">${a} ${mul ? "×" : "+"} ${b} = ?</div><div class="answer-options">${shuffle([...opts]).map(v => `<button class="answer-btn" data-race="${v}">${v}</button>`).join("")}</div>`;
  document.querySelectorAll("[data-race]").forEach(btn => btn.addEventListener("click", () => {
    if (gameFinished || raceTime <= 0) return;
    const ok = Number(btn.dataset.race) === ans;
    if (ok) { raceCorrect++; award(5 * difficulty); $("race-hits").textContent = raceCorrect; }
    recordAnswer(ok); nextRace();
  }));
}

window.EXTRA_GAMES = { pairs: setupPairs, quiz: setupQuiz, race: setupRace };

// Restaura a sessão a partir do token guardado neste navegador.
(async()=>{const saved=sessionStorage.getItem(SESSION_KEY);if(!saved)return;authToken=saved;try{const result=await api("/api/me");loginUser(result.user,saved);}catch{sessionStorage.removeItem(SESSION_KEY);authToken=null;}})();
