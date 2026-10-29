import { onSettingsChange, settings } from './core/Settings';
import { Game } from './game/Game';
import { Net } from './net/Net';
import { HUD } from './ui/HUD';
import { Menu } from './ui/Menu';
import type { LobbyInfo } from './ui/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const game = new Game(canvas);
const hud = new HUD(ui);
hud.setVisible(false);

const offlineLobby = (): LobbyInfo => ({
  status: 'offline', code: null, isHost: true,
  players: [{ name: settings.name || 'Você', ping: 0, isHost: true, isLocal: true }],
});
const lobby = () => game.net?.lobby() ?? offlineLobby();

const menu = new Menu(ui, {
  playOffline() {
    game.audio.unlock();
    game.startSession(null, settings.name);
    enterGame();
  },
  async createRoom() {
    game.audio.unlock();
    const net = await Net.host(settings.name || 'Host');
    startOnline(net);
    return net.code;
  },
  async joinRoom(code: string) {
    game.audio.unlock();
    const net = await Net.join(code, settings.name || 'Jogador');
    startOnline(net);
  },
  resume() {
    game.audio.unlock();
    enterGame();
  },
  leave() {
    game.endSession();
    setRoomHash(null);
    hud.setVisible(false);
    menu.showMain();
    menu.setLobby(offlineLobby());
  },
});

/** Entra na partida online: liga os avisos de lobby/queda e coloca #CODIGO na URL. */
function startOnline(net: Net): void {
  net.onLobbyChange = () => menu.setLobby(lobby());
  net.onDisconnect = (msg) => {
    game.endSession();
    game.input.unlock();
    hud.setVisible(false);
    setRoomHash(null);
    menu.showMain();
    menu.setLobby({ status: 'error', code: null, isHost: true, players: [], error: msg });
  };
  game.startSession(net, settings.name);
  setRoomHash(net.code);
  (window as any).net = net;
  enterGame();
  menu.setLobby(lobby());
}

function setRoomHash(code: string | null): void {
  try {
    history.replaceState(null, '', code ? `#${code}` : location.pathname + location.search);
  } catch { /* ignora */ }
}

function enterGame(): void {
  menu.hide();
  hud.setVisible(true);
  game.input.lock();
}

game.input.onLockChange = (locked) => {
  if (!locked && game.inSession) menu.showPause(lobby());
};

menu.showMain();

// Configurações do host valem para a sala (bots, dificuldade; modo vai pela rede).
let lastMode = settings.mode;
onSettingsChange((s) => {
  const modeChanged = s.mode !== lastMode;
  lastMode = s.mode;
  if (!game.inSession || !game.isHost) return;
  game.syncBots();
  if (modeChanged) game.match?.start();
});

let last = performance.now();
function loop(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.frame(dt);
  if (game.inSession) hud.update(game.hudState(), dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Aba em segundo plano: o navegador pausa o requestAnimationFrame e segura timers da página.
// Um timer num Worker continua a ~30 Hz e mantém a simulação (bots, respawn, rede) viva sem renderizar.
try {
  const src = 'setInterval(() => postMessage(0), 33);';
  const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = () => {
    if (!document.hidden || !game.inSession) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    game.frame(dt, false);
  };
} catch {
  /* sem Worker: aba oculta pausa a simulação */
}

// Debug no console
(window as any).game = game;
