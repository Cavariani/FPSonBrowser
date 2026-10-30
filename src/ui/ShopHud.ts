import './shop.css';
import { PRICE, SHOP_TIERS } from '../game/shop';
import { hex, icon, wInfo } from './icons';
import { isExtra, type ShopItemId } from '../game/shop';
import type { HudState } from './types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const EXTRA_NAME = { colete: 'Colete', vida: 'Vida cheia', municao: 'Munição' } as const;
export const shopName = (id: string): string => (isExtra(id as ShopItemId) ? EXTRA_NAME[id as keyof typeof EXTRA_NAME] : wInfo(id).name);

const money = (n: number) => (n === 0 ? 'GRÁTIS' : '$' + n);

/**
 * Menu da loja (tecla B), estilo CS: 1-4 escolhe a categoria, 1-6 compra, Backspace volta, B fecha.
 * Quem lê as teclas é o Game (o mouse continua preso); aqui só desenha.
 */
export class ShopHud {
  private root = h('div', 'shop');
  private sig = '\0';

  constructor(parent: HTMLElement) {
    parent.append(this.root);
  }

  update(s: HudState['shop'], cash: number): void {
    const sig = s.open ? `${s.page}|${s.held}|${cash}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.classList.toggle('on', s.open);
    if (!s.open) return;
    this.root.textContent = '';

    const head = h('div', 'hd');
    head.append(h('span', '', s.page < 0 ? 'LOJA' : SHOP_TIERS[s.page].name), h('b', '', '$' + cash));
    this.root.append(head);

    if (s.page < 0) {
      SHOP_TIERS.forEach((t, i) => {
        const prices = t.items.map((id) => PRICE[id]);
        const row = h('div', 'row');
        row.append(h('kbd', '', String(i + 1)), h('span', 'nm', t.name), h('span', 'pr', `$${Math.min(...prices)} – $${Math.max(...prices)}`));
        this.root.append(row);
      });
      this.root.append(h('div', 'ft', 'B fecha'));
      return;
    }

    SHOP_TIERS[s.page].items.forEach((id, i) => {
      const extra = isExtra(id);
      const info = extra ? { name: EXTRA_NAME[id], color: null } : wInfo(id);
      const held = !extra && s.held === id;
      const cls = 'row' + (held ? ' held' : PRICE[id] > cash ? ' poor' : '');
      const row = h('div', cls);
      if (info.color !== null) row.style.setProperty('--c', hex(info.color));
      const ic = h('span', 'ic');
      if (!extra) ic.innerHTML = icon(id);
      row.append(h('kbd', '', String(i + 1)), ic, h('span', 'nm', info.name), h('span', 'pr', held ? 'NA MÃO' : money(PRICE[id])));
      this.root.append(row);
    });
    this.root.append(h('div', 'ft', 'Backspace volta · B fecha'));
  }
}
