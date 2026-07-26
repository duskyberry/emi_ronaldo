'use strict';

/* =========================================================
   GOAL SOUND — carga y reproducción a prueba de dispositivos
   =========================================================
   Estrategia "sí o sí":
   1. Se descarga y decodifica el MP3 una sola vez con la Web Audio API
      (fetch + decodeAudioData) apenas carga la página, SIN esperar a
      ningún gesto del usuario — esto evita cualquier problema de buffering
      del elemento <audio> en redes lentas.
   2. En el primer toque del usuario (pointerdown/touchstart) se
      "despierta" el AudioContext (ctx.resume()), que es el único permiso
      que iOS/Android realmente exigen.
   3. Al anotar el gol, se reproduce el buffer ya decodificado con
      AudioBufferSourceNode — reproducción instantánea, sin latencia de
      red ni de decodificación, funciona igual en iPhone y Android.
   4. Si el navegador no soporta Web Audio API (rarísimo hoy en día) o la
      descarga/decodificación falla, se cae de vuelta al <audio> normal
      del HTML como respaldo.
   ========================================================= */
const GoalAudio = (function initGoalAudio(){
  const SOUND_URL = 'https://raw.githubusercontent.com/edvardoviedo/emimessi/main/Cristiano%20Ronaldo%20Siuu%21%20-%20Sound%20Effect.mp3';
  const fallbackEl = document.getElementById('goal-sound');

  let ctx = null;
  let buffer = null;
  let bufferPromise = null;
  let unlocked = false;

  function getCtx(){
    if (!ctx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx){
        try { ctx = new Ctx(); }
        catch (err){ console.error('[goal-sound] no se pudo crear AudioContext:', err); }
      } else {
        console.warn('[goal-sound] Web Audio API no soportada en este navegador');
      }
    }
    return ctx;
  }

  function loadBuffer(){
    if (bufferPromise) return bufferPromise;
    const audioCtx = getCtx();
    if (!audioCtx){
      bufferPromise = Promise.resolve(null);
      return bufferPromise;
    }
    console.log('[goal-sound] descargando y decodificando audio…');
    bufferPromise = fetch(SOUND_URL)
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then((data) => audioCtx.decodeAudioData(data))
      .then((decoded) => {
        buffer = decoded;
        console.log('[goal-sound] buffer decodificado y listo ✔ (' + decoded.duration.toFixed(2) + 's)');
        return decoded;
      })
      .catch((err) => {
        console.error('[goal-sound] falló la descarga/decodificación, se usará <audio> de respaldo:', err);
        return null;
      });
    return bufferPromise;
  }

  // Empieza a cargar de inmediato, sin esperar interacción del usuario.
  loadBuffer();
  if (fallbackEl) fallbackEl.load();

  function unlock(){
    if (unlocked) return;
    unlocked = true;
    const audioCtx = getCtx();
    if (audioCtx && audioCtx.state === 'suspended'){
      audioCtx.resume()
        .then(() => console.log('[goal-sound] AudioContext reanudado tras gesto del usuario ✔'))
        .catch((err) => console.warn('[goal-sound] no se pudo reanudar el AudioContext:', err));
    }
    // Respaldo: desbloquear también el <audio> por si hiciera falta.
    if (fallbackEl){
      const attempt = fallbackEl.play();
      if (attempt !== undefined){
        attempt
          .then(() => { fallbackEl.pause(); fallbackEl.currentTime = 0; })
          .catch(() => { /* se ignora: solo es un respaldo secundario */ });
      }
    }
  }

  function playFallback(){
    if (!fallbackEl){
      console.warn('[goal-sound] no hay ningún método disponible para reproducir el sonido');
      return;
    }
    fallbackEl.currentTime = 0;
    fallbackEl.play()
      .then(() => console.log('[goal-sound] reproduciendo vía <audio> de respaldo ✔'))
      .catch((err) => console.error('[goal-sound] también falló el respaldo <audio>:', err));
  }

  function play(){
    const audioCtx = getCtx();
    if (audioCtx && buffer){
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
        console.log('[goal-sound] reproduciendo vía Web Audio API ✔');
        return;
      } catch (err){
        console.error('[goal-sound] error reproduciendo con Web Audio API, usando respaldo:', err);
      }
    } else {
      console.warn('[goal-sound] el buffer aún no estaba listo al anotar, usando respaldo <audio>');
    }
    playFallback();
  }

  return { unlock, play, loadBuffer };
})();

/* =========================================================
   INTRO GATE — drag ball to goal
   ========================================================= */
(function initIntro(){
  const introScreen = document.getElementById('intro-screen');
  const ball = document.getElementById('ball');
  const goal = document.getElementById('goal');
  const pitch = document.getElementById('pitch');
  const goalFlash = document.getElementById('goal-flash');
  const mainContent = document.getElementById('main-content');

  document.body.classList.add('locked');

  let dragging = false;
  let scored = false;
  let originX = 0;
  let pointerStartX = 0;

  function getBallOffsetX(){
    const style = window.getComputedStyle(ball);
    const matrix = new DOMMatrixReadOnly(style.transform);
    return matrix.m41;
  }

  function onPointerDown(e){
    if (scored) return;
    GoalAudio.unlock();
    dragging = true;
    ball.classList.add('dragging');
    pointerStartX = (e.touches ? e.touches[0].clientX : e.clientX);
    originX = getBallOffsetX();
    ball.setPointerCapture && e.pointerId !== undefined && ball.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e){
    if (!dragging || scored) return;
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
    const delta = clientX - pointerStartX;
    const pitchRect = pitch.getBoundingClientRect();
    const maxTravel = pitchRect.width - ball.offsetWidth - 12;
    let nextX = Math.max(0, Math.min(originX + delta, maxTravel));
    ball.style.transform = `translate(${nextX}px, -50%)`;

    checkGoalOverlap();
  }

  function onPointerUp(){
    dragging = false;
    ball.classList.remove('dragging');
  }

  function checkGoalOverlap(){
    const ballRect = ball.getBoundingClientRect();
    const goalRect = goal.getBoundingClientRect();
    const overlap = ballRect.right > goalRect.left + goalRect.width * 0.3;
    if (overlap && !scored){
      score();
    }
  }

  function score(){
    scored = true;
    dragging = false;
    ball.classList.add('scored');
    goalFlash.classList.add('show');
    burstConfetti();
    GoalAudio.play();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);

    setTimeout(revealSite, 1000);
  }

  function revealSite(){
    introScreen.classList.add('hide');
    document.body.classList.remove('locked');
    mainContent.hidden = false;
    setTimeout(() => { introScreen.remove(); }, 950);
    initScrollReveal();
    initCountdown();
    initDividerSpin();
    initParallax();
  }

  ball.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  ball.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('touchend', onPointerUp);

  // Keyboard accessibility: Enter/Space scores directly for assistive tech users
  ball.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !scored){
      e.preventDefault();
      GoalAudio.unlock();
      score();
    }
  });

  function burstConfetti(){
    const layer = document.getElementById('confetti-layer');
    const colors = ['#3FE07A', '#F2B705', '#2E6FF2', '#F4F6F1', '#12452C'];
    const count = 90;
    for (let i = 0; i < count; i++){
      const piece = document.createElement('div');
      piece.className = 'confetto';
      const size = 6 + Math.random() * 8;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 0.4}px`;
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      const duration = 2.4 + Math.random() * 1.6;
      const delay = Math.random() * 0.3;
      piece.style.animationDuration = `${duration}s`;
      piece.style.animationDelay = `${delay}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
  }
})();

/* =========================================================
   SCROLL REVEAL
   ========================================================= */
function initScrollReveal(){
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)){
    items.forEach(el => el.classList.add('in-view'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting){
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });

  items.forEach(el => observer.observe(el));
}

/* =========================================================
   COUNTDOWN — Lunes 3 de agosto 2026, 3:00 PM
   ========================================================= */
function initCountdown(){
  const target = new Date('2026-08-03T15:00:00');
  const els = {
    days: document.getElementById('cd-days'),
    hours: document.getElementById('cd-hours'),
    min: document.getElementById('cd-min'),
    sec: document.getElementById('cd-sec'),
  };
  if (!els.days) return;

  function pad(n){ return String(n).padStart(2, '0'); }

  function tick(){
    const now = new Date();
    let diff = target - now;
    if (diff < 0) diff = 0;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const min = Math.floor((diff / (1000 * 60)) % 60);
    const sec = Math.floor((diff / 1000) % 60);

    els.days.textContent = pad(days);
    els.hours.textContent = pad(hours);
    els.min.textContent = pad(min);
    els.sec.textContent = pad(sec);
  }

  tick();
  setInterval(tick, 1000);
}

/* =========================================================
   DIVIDER BALLS SPIN WITH SCROLL
   ========================================================= */
function initDividerSpin(){
  const balls = document.querySelectorAll('.divider-ball');
  if (!balls.length) return;

  let ticking = false;

  function update(){
    const rotation = window.scrollY * 0.6;
    balls.forEach(ball => {
      ball.style.transform = `rotate(${rotation}deg)`;
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking){
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
}

/* =========================================================
   LIGHT PARALLAX ON HERO
   ========================================================= */
function initParallax(){
  const heroImg = document.getElementById('hero-img');
  const hero = document.getElementById('hero');
  if (!heroImg || !hero) return;

  let ticking = false;

  function update(){
    const rect = hero.getBoundingClientRect();
    const progress = Math.min(Math.max(1 - rect.bottom / (rect.height + window.innerHeight), 0), 1);
    const translate = progress * 40;
    heroImg.style.transform = `scale(1.06) translateY(${translate}px)`;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking){
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
}

/* =========================================================
   ADD TO CALENDAR (.ics download)
   ========================================================= */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#add-calendar');
  if (!btn) return;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//duskyberry//invitacion//ES',
    'BEGIN:VEVENT',
    'UID:emilio-cumple-8@duskyberry',
    'DTSTAMP:20260726T000000Z',
    'DTSTART:20260803T150000',
    'DTEND:20260803T210000',
    'SUMMARY:Cumpleaños de Emilio ⚽ (8 años)',
    'LOCATION:Álvaro Fernández 176, fracc. Fundadores',
    'DESCRIPTION:Ven a dejar a Emilio a las 3:00 PM y pasa por él a las 9:00 PM.',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cumple-emilio.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

/* =========================================================
   RSVP → WhatsApp
   ========================================================= */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#rsvp-submit');
  if (!btn) return;

  const name = (document.getElementById('rsvp-name').value || '').trim();
  const guests = (document.getElementById('rsvp-guests').value || '0').trim();
  const message = (document.getElementById('rsvp-message').value || '').trim();

  if (!name){
    document.getElementById('rsvp-name').focus();
    return;
  }

  const text = [
    `¡Hola! Confirmo mi asistencia al cumpleaños de Emilio ⚽`,
    `Nombre: ${name}`,
    `Acompañantes: ${guests || '0'}`,
    message ? `Mensaje para Emilio: ${message}` : null
  ].filter(Boolean).join('\n');

  const url = `https://wa.me/528444054281?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
});
