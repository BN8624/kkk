// 한 줄 목적: 빠른 전투 설정 화면(왕국·시나리오·난이도 선택)을 렌더링한다
import type { Difficulty, FactionId } from '../../core/types';
import { FACTION_NAMES, DIFFICULTY_NAMES } from '../../core/data';
import { EMBLEM_SVG, FACTION_CSS, escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface GameSetup {
  faction: FactionId;
  scenario: string;
  difficulty: Difficulty;
}

/** 새 게임 설정 화면: 왕국·시나리오·난이도를 고르고 시작한다. */
export function showSetupScreen(
  overlay: OverlayHost,
  opts: {
    describeFaction: (f: FactionId) => string;
    scenarios: { id: string; name: string; description: string }[];
    initial?: Partial<GameSetup>;
    onStart: (sel: GameSetup) => void;
    onBack: () => void;
  },
): void {
  const validInitialScenario = opts.scenarios.some((s) => s.id === opts.initial?.scenario);
  const sel: GameSetup = {
    faction: opts.initial?.faction ?? 'azure',
    scenario: validInitialScenario ? opts.initial!.scenario! : (opts.scenarios[0]?.id ?? 'three-crowns'),
    difficulty: opts.initial?.difficulty ?? 'normal',
  };
  const root = overlay.show(`
      <h1 style="font-size:22px;">새 게임</h1>
      <div class="fac-cards">
        ${(['azure', 'crimson', 'violet'] as FactionId[])
          .map(
            (f) => `<button class="fac-card" data-f="${f}">
              <span class="crest" style="background:${FACTION_CSS[f]}">${EMBLEM_SVG[f]}</span>
              <b>${FACTION_NAMES[f]}</b>
            </button>`,
          )
          .join('')}
      </div>
      <div class="fac-desc" id="fac-desc"></div>
      <div class="opt-row" id="scn-row">
        ${opts.scenarios
          .map((s) => `<button class="opt-chip" data-s="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`)
          .join('')}
      </div>
      <div class="opt-desc" id="scn-desc"></div>
      <div class="opt-row" id="dif-row">
        ${(['easy', 'normal', 'hard'] as Difficulty[])
          .map((d) => `<button class="opt-chip" data-d="${d}">${DIFFICULTY_NAMES[d]}</button>`)
          .join('')}
      </div>
      <button class="big-btn" id="btn-start">이 왕국으로 시작</button>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
  const facDesc = root.querySelector('#fac-desc')!;
  const scnDesc = root.querySelector('#scn-desc')!;
  const render = () => {
    facDesc.innerHTML = opts.describeFaction(sel.faction);
    scnDesc.textContent = opts.scenarios.find((s) => s.id === sel.scenario)?.description ?? '';
    for (const card of root.querySelectorAll<HTMLButtonElement>('.fac-card')) {
      card.classList.toggle('selected', card.dataset.f === sel.faction);
    }
    for (const chip of root.querySelectorAll<HTMLButtonElement>('#scn-row .opt-chip')) {
      chip.classList.toggle('selected', chip.dataset.s === sel.scenario);
    }
    for (const chip of root.querySelectorAll<HTMLButtonElement>('#dif-row .opt-chip')) {
      chip.classList.toggle('selected', chip.dataset.d === sel.difficulty);
    }
  };
  render();
  for (const card of root.querySelectorAll<HTMLButtonElement>('.fac-card')) {
    card.addEventListener('click', () => {
      sel.faction = card.dataset.f as FactionId;
      render();
    });
  }
  for (const chip of root.querySelectorAll<HTMLButtonElement>('#scn-row .opt-chip')) {
    chip.addEventListener('click', () => {
      sel.scenario = chip.dataset.s!;
      render();
    });
  }
  for (const chip of root.querySelectorAll<HTMLButtonElement>('#dif-row .opt-chip')) {
    chip.addEventListener('click', () => {
      sel.difficulty = chip.dataset.d as Difficulty;
      render();
    });
  }
  overlay.bind({ 'btn-start': () => opts.onStart({ ...sel }), 'btn-back': opts.onBack });
}
