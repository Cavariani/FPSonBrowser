# CLTfps.html

Tiroteio multiplayer no navegador, com os amigos.

FPS multiplayer de navegador, low-poly estilizado, com bots. Escada de 14 armas malucas (1 kill sobe um nível, vence quem matar com a última) e loja estilo CS (tecla B) com armas comuns, colete, vida e munição, paga com o dinheiro das kills.

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

WASD andar · Espaço pular · Ctrl/C agachar · Shift andar devagar · R recarregar · B loja (1-2 categoria, 1-6 comprar) · V ativar cheat · Botão direito zoom (sniper) / golpe forte (grampeador) · Tab placar · Esc menu

## Stack

Three.js + TypeScript + Vite · PeerJS (P2P host-autoritativo) · Áudio procedural (Web Audio) · Arte procedural em código.
