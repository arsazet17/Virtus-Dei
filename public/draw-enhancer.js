(() => {
  const VERSION = 'draw-layout-v2';
  let scheduled = false;
  let initialRedirectDone = false;

  const pad = n => String(n).padStart(2, '0');
  const parseDrawNumber = text => Number(String(text || '').replace(/\D/g, '')) || null;
  const parseWallClock = text => {
    const m = String(text || '').match(/(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  };
  const formatWallClock = ms => {
    const d = new Date(ms);
    return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  function statsFor(numbers) {
    const sum = numbers.reduce((a, b) => a + b, 0);
    const even = numbers.filter(n => n % 2 === 0).length;
    const odd = numbers.length - even;
    return { sum, even, odd, balance: even === odd ? 'поровну' : even > odd ? 'чёт' : 'нечёт' };
  }

  function columnNotes(numbers) {
    const counts = Array(11).fill(0);
    numbers.forEach(n => {
      const col = n % 10 || 10;
      counts[col] += 1;
    });
    const singles = [];
    const empty = [];
    for (let col = 1; col <= 10; col++) {
      if (counts[col] === 1) singles.push(`ст${col}`);
      if (counts[col] === 0) empty.push(`ст${col}`);
    }
    const parts = [];
    if (singles.length) parts.push(`<span class="single-col"><span class="finger">☝</span> одиночные: ${singles.join(', ')}</span>`);
    if (empty.length) parts.push(`<span class="empty-col">${empty.map(x => `${x} □ — пустой!`).join(' · ')}</span>`);
    return parts.join(' · ');
  }

  function ensureBottomNav() {
    if (window.innerWidth > 850) {
      document.querySelector('.reference-bottom-nav')?.remove();
      return;
    }
    if (document.querySelector('.reference-bottom-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'reference-bottom-nav';
    nav.innerHTML = `
      <button data-ref-page="draws"><span>⌂</span><b>Главная</b></button>
      <button data-ref-page="archive"><span>▦</span><b>Архив</b></button>
      <button data-ref-page="analysis"><span>◎</span><b>Аналоги+</b></button>
      <button data-ref-refresh><span>↻</span><b>Обновить</b></button>`;
    nav.addEventListener('click', e => {
      const page = e.target.closest('[data-ref-page]')?.dataset.refPage;
      if (page) document.querySelector(`.nav[data-page="${page}"]`)?.click();
      if (e.target.closest('[data-ref-refresh]')) location.reload();
    });
    document.body.appendChild(nav);
  }

  function enhanceDraws() {
    const list = document.querySelector('.draw-list');
    document.body.classList.toggle('reference-draw-feed', Boolean(list));
    if (!list || list.dataset.enhanced === VERSION) return;

    const cards = [...list.querySelectorAll('.draw-card')];
    if (!cards.length) return;

    const first = cards[0];
    const firstNo = parseDrawNumber(first.querySelector('h3')?.textContent);
    const firstTimeNode = first.querySelector('.draw-card-head small');
    const firstTime = parseWallClock(firstTimeNode?.textContent);

    document.querySelectorAll('.next-draw-banner').forEach(el => el.remove());
    if (firstNo && firstTime != null) {
      const banner = document.createElement('section');
      banner.className = 'next-draw-banner';
      banner.innerHTML = `<span class="next-label">СЛЕД ТИРАЖ</span> <strong>№${firstNo + 1}</strong> · <span class="next-time">${formatWallClock(firstTime + 30 * 60000).slice(-5)}</span>`;
      list.parentNode.insertBefore(banner, list);
    }

    cards.forEach((card, index) => {
      const head = card.querySelector('.draw-card-head');
      const title = head?.querySelector('h3');
      const timeNode = head?.querySelector('small');
      const drawNo = parseDrawNumber(title?.textContent);
      const balls = [...card.querySelectorAll('.draw-balls.compact span')];
      const numbers = balls.map(el => Number(el.textContent)).filter(Number.isFinite);
      if (!head || !title || !numbers.length) return;

      card.querySelectorAll('.draw-kicker,.draw-stats,.draw-column-notes').forEach(el => el.remove());
      const kicker = document.createElement('div');
      kicker.className = 'draw-kicker';
      kicker.textContent = index === 0 ? 'ПОСЛЕДНИЙ ТИРАЖ' : index === 1 ? 'ПРЕДЫДУЩИЙ ТИРАЖ' : 'ТИРАЖ';
      card.insertBefore(kicker, head);

      if (firstNo && firstTime != null && drawNo && timeNode) {
        const diff = firstNo - drawNo;
        if (diff >= 0) timeNode.textContent = formatWallClock(firstTime - diff * 30 * 60000);
      }

      const badge = head.querySelector('.column-badge');
      if (badge) {
        const col = String(badge.textContent || '').match(/(\d+)/)?.[1];
        badge.textContent = col ? `🔴 ст${col}` : '🔴 ст—';
      }

      balls.forEach(el => {
        const n = Number(el.textContent);
        if (Number.isFinite(n)) el.textContent = pad(n);
      });

      const { sum, even, odd, balance } = statsFor(numbers);
      const stats = document.createElement('div');
      stats.className = 'draw-stats';
      stats.innerHTML = `<span class="draw-stat">Σ ${sum}</span><span class="draw-stat">${even}/${odd}</span><span class="draw-stat">${balance}</span>`;
      const ballsWrap = card.querySelector('.draw-balls.compact');
      card.insertBefore(stats, ballsWrap);

      const note = document.createElement('div');
      note.className = 'draw-column-notes';
      note.innerHTML = columnNotes(numbers) || '<span>Столбцы распределены без одиночных и пустых.</span>';
      card.appendChild(note);
    });

    list.dataset.enhanced = VERSION;
  }

  function useReferenceAsMobileHome() {
    if (window.innerWidth > 850 || initialRedirectDone) return;
    const dashboard = document.querySelector('.current-cycle');
    if (!dashboard) return;
    initialRedirectDone = true;
    document.querySelector('.nav[data-page="draws"]')?.click();
  }

  function updateBottomNavState() {
    const buttons = [...document.querySelectorAll('.reference-bottom-nav [data-ref-page]')];
    const active = document.querySelector('.nav.active')?.dataset.page;
    buttons.forEach(btn => btn.classList.toggle('active', active === btn.dataset.refPage || (active === 'draws' && btn.dataset.refPage === 'draws')));
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureBottomNav();
      useReferenceAsMobileHome();
      enhanceDraws();
      updateBottomNavState();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('resize', schedule);
  schedule();
})();