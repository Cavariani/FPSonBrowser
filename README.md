# CLTfps.html

Tiroteio multiplayer no navegador, com os amigos.

FPS multiplayer de navegador, low-poly estilizado, gun game com bots. Sem conta, sem servidor: quem cria a sala vira host (P2P via WebRTC/PeerJS).

## Jogar

- Online: https://cavariani.github.io/FPSonBrowser/
- Criar sala → manda o link com `#CODIGO` pros amigos.

## Rodar local

```bash
npm install
npm run dev
```

Abre em http://localhost:5199

## Controles

WASD andar · Espaço pular · Ctrl/C agachar · Shift andar devagar · R recarregar · Botão direito zoom (sniper) / golpe forte (grampeador) · Tab placar · Esc menu

## Stack

Three.js + TypeScript + Vite · PeerJS (P2P host-autoritativo) · Áudio procedural (Web Audio) · Arte procedural em código.
