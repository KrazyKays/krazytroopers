export type Child = Node | string | number | null | undefined | false | Child[];

type Props = {
  class?: string;
  style?: string;
  title?: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  hidden?: boolean;
  value?: string;
  placeholder?: string;
  accept?: string;
  rows?: number;
  data?: Record<string, string>;
  onclick?: (e: MouseEvent) => void;
  onchange?: (e: Event) => void;
  oninput?: (e: Event) => void;
  onsubmit?: (e: Event) => void;
  maxlength?: number;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === false) continue;
      if (k === 'class') el.className = v as string;
      else if (k === 'data') Object.assign(el.dataset, v as Record<string, string>);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}
