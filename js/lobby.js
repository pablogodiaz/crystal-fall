// ---------- Lobby ----------
// Menu buttons Host co-op / Join co-op and the lobby card: your name (remembered in
// localStorage['crystal-fall-name']), the address friends open, who's connected and, for the host,
// Start run. Joining a run that's already going drops you straight into it.
import { $ } from './utils.js';
import { state, net, players } from './state.js';
import { me } from './player.js';
import { startHosting, stopHosting, onRoster } from './host.js';
import { joinGame, leaveSession, onClientRoster, rosterInfo } from './client.js';
import { newRun } from './game.js';
import { showScreen, toast } from './hud.js';

const NAME = 'crystal-fall-name';
let busy = false;
const shareUrl = () => `${location.protocol}//${location.host}${location.pathname}`;
function myName(){
  const n = $('nameInput').value.trim().slice(0, 16) || 'Player';
  try { localStorage.setItem(NAME, n); } catch(e){}
  return n;
}
function note(msg, bad){ const el = $('lobbyNote'); el.textContent = msg || ''; el.classList.toggle('bad', !!bad); }

export function initLobby(){
  try { $('nameInput').value = localStorage.getItem(NAME) || ''; } catch(e){}
  $('hostBtn').addEventListener('click', host);
  $('joinBtn').addEventListener('click', join);
  $('lobbyStart').addEventListener('click', () => { if (net.role === 'host') newRun(); });
  $('lobbyLeave').addEventListener('click', leave);
  onRoster(render); onClientRoster(render);
}
async function host(){
  if (busy) return; busy = true;
  me().name = net.name = myName();
  showLobby('Starting the server connection…');
  try { await startHosting(); note(''); }
  catch(why){ note(String(why), true); setTimeout(() => { if (net.role === 'solo') showScreen('menuScreen'); }, 2600); }
  busy = false; render();
}
async function join(){
  if (busy) return; busy = true;
  net.name = myName();
  showLobby('Joining…');
  try { await joinGame(); note(state.mode === 'menu' ? 'Waiting for the host to start the run…' : ''); }
  catch(why){ note(String(why), true); setTimeout(() => { if (net.role === 'solo' && state.mode === 'menu') showScreen('menuScreen'); }, 2600); }
  busy = false; render();
}
function leave(){
  if (net.role === 'host') stopHosting();
  else if (net.role === 'client') return leaveSession('');
  showScreen('menuScreen'); $('startBtn').focus();
}
function showLobby(msg){ showScreen('lobbyScreen'); note(msg); render(); }
// Player list and buttons for whichever side we're on.
function render(){
  const hosting = net.role === 'host', client = net.role === 'client';
  $('lobbyTitle').textContent = client ? 'Joined' : 'Co-op lobby';
  $('lobbyAddr').innerHTML = hosting ? `Friends open <b>${shareUrl()}</b> (your LAN or Tailscale address in place of localhost) and click <b>Join co-op</b>.` : '';
  $('lobbyStart').classList.toggle('hidden', !hosting);
  $('lobbyStart').disabled = !hosting;
  const list = client ? rosterInfo() : players.map(p => ({ name:p.name, css:p.css, you:p === me(), host:p === me() && hosting, lost:p.lost > 0 && !p.remote }));
  $('lobbyPlayers').innerHTML = (hosting || client) ? list.map(p => `<li style="--pc:${p.css}"><b>${esc(p.name)}</b>${p.you ? ' <small>you</small>' : ''}${p.host ? ' <small>host</small>' : ''}${p.lost ? ' <small>reconnecting…</small>' : ''}</li>`).join('') : '';
  // Pause screen line: who can resume, and where friends can join.
  $('pauseNote').textContent = client ? 'The host paused the game. Only they can resume.' : hosting ? `Friends can join at ${shareUrl()}` : '';
  $('pauseNote').classList.toggle('hidden', !client && !hosting);
  $('resumeBtn').classList.toggle('hidden', client);
  if (hosting && state.mode !== 'menu') toast(`${players.length} player${players.length > 1 ? 's' : ''} in the game`, 'info');
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
