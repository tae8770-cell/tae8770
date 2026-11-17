(() => {
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('.menu');
  const links = [...document.querySelectorAll('a[data-nav]')];
  const current = location.pathname.split('/').pop() || 'index.html';
  links.forEach(link => { if (link.getAttribute('href') === current) link.classList.add('active'); });

  if (!reduced && !sessionStorage.getItem('poc-intro-seen')) {
    const loader = document.createElement('div'); loader.className = 'site-loader';
    loader.innerHTML = '<div><b>POC<span>.ai</span></b><small>AI TRANSFORMATION STUDIO</small><i></i></div>';
    body.append(loader); sessionStorage.setItem('poc-intro-seen', '1');
    requestAnimationFrame(() => loader.classList.add('is-visible'));
    const done = () => setTimeout(() => { loader.classList.remove('is-visible'); setTimeout(() => loader.remove(), 450); }, 460);
    document.fonts?.ready ? document.fonts.ready.then(done) : done();
  }

  if (nav) {
    const button = document.createElement('button'); button.className = 'menu-toggle'; button.type = 'button';
    button.setAttribute('aria-label', '메뉴 열기'); button.setAttribute('aria-expanded', 'false'); button.innerHTML = '<i></i><i></i>';
    nav.before(button); button.addEventListener('click', () => { const open = nav.classList.toggle('is-open'); button.setAttribute('aria-expanded', String(open)); });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => nav.classList.remove('is-open')));
  }

  document.querySelectorAll('[data-ax-signal]').forEach(signal => {
    const entries = [...signal.querySelectorAll('[data-signal]')]; if (!entries.length || reduced) return;
    let active = 0; entries.forEach((entry, index) => entry.classList.toggle('is-active', index === 0));
    setInterval(() => { entries[active].classList.remove('is-active'); active = (active + 1) % entries.length; entries[active].classList.add('is-active'); }, 4200);
  });

  const targets = [...document.querySelectorAll('main > section, .contact-layout')];
  targets.forEach((node, index) => { if (index > 0) node.classList.add('reveal'); });
  if ('IntersectionObserver' in window && !reduced) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: .12 });
    document.querySelectorAll('.reveal').forEach(node => observer.observe(node));
  } else document.querySelectorAll('.reveal').forEach(node => node.classList.add('is-visible'));

  const visual = document.querySelector('.system-visual, .hero-cosmos');
  if (visual && !reduced) {
    visual.addEventListener('pointermove', event => { const rect = visual.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width - .5; const y = (event.clientY - rect.top) / rect.height - .5; visual.style.setProperty('--tilt-x', `${y * -3}deg`); visual.style.setProperty('--tilt-y', `${x * 3}deg`); });
    visual.addEventListener('pointerleave', () => { visual.style.setProperty('--tilt-x', '0deg'); visual.style.setProperty('--tilt-y', '0deg'); });
  }
})();
