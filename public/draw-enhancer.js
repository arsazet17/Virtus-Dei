(() => {
  const VERSION = 'draw-layout-v1';
  let scheduled = false;

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
    if (singles.length) parts.push(`<span class="single-col"><span class="finger">☝</span>одиночные: ${singles.join(', ')}</span>`);
    if (empty.length) parts.push(`<span class="empty-col">${empty.map(x => `${x} □ — пустой!`).join(' · ')}</span>`);
    return parts.join(' · ');
  }

  function enhanceDraws() {
    const list = document.querySelector('.draw-list');
    if (!list || list.dataset.enhanced === VERSION) return;
    const cards = [...list.querySelectorAll('.draw-card')];
    if (!cards.length) return;

    const first = cards[0];
    const firstNo = parseDrawNumber(first.querySelector('h3')?.textContent);
    const firstTimeNode = first.querySelector('.draw-card-head small');
    const firstTime = parseWallClock(firstTimeNode?.textContent);

    if (firstNo && firstTime != null && !document.querySelector('.next-draw-banner')) {
      const banner = document.createElement('section');
      banner.className = 'next-draw-banner';
      banner.innerHTML = `<span class="next-label">СЛЕД ТИРАЖ</span> №${firstNo + 1} · <span class="next-time">${formatWallClock(firstTime + 30 * 60000).slice(-5)}</span>`;
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

      if (!card.querySelector('.draw-kicker')) {
        const kicker = document.createElement('div');
        kicker.className = 'draw-kicker';
        kicker.textContent = index === 0 ? 'ПОСЛЕДНИЙ ТИРАЖ' : index === 1 ? 'ПРЕДЫДУЩИЙ ТИРАЖ' : 'ТИРАЖ';
        card.insertBefore(kicker, head);
      }

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

      if (!card.querySelector('.draw-stats')) {
        const { sum, even, odd, balance } = statsFor(numbers);
        const row = document.createElement('div');
        row.className = 'draw-stats';
        row.innerHTML = `<span class="draw-stat">Σ ${sum}</span><span class="draw-stat">${even}/${odd}</span><span class="draw-stat">${balance}</span>`;
        const ballsWrap = card.querySelector('.draw-balls.compact');
        card.insertBefore(row, ballsWrap);
      }

      if (!card.querySelector('.draw-column-notes')) {
        const note = document.createElement('div');
        note.className = 'draw-column-notes';
        note.innerHTML = columnNotes(numbers) || '<span>Столбцы распределены без одиночных и пустых.</span>';
        card.appendChild(note);
      }
    });

    list.dataset.enhanced = VERSION;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceDraws();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', schedule);
  schedule();
})();