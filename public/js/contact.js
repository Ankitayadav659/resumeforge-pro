/* Contact form */
(function () {
  'use strict';
  const form = document.getElementById('contactForm');
  const ok = document.getElementById('cOk');
  const err = document.getElementById('cErr');
  const topic = new URLSearchParams(location.search).get('topic');
  if (topic) [...form.elements.topic.options].forEach((o) => { if (o.text.toLowerCase().startsWith(topic.toLowerCase())) o.selected = true; });

  API.me().then((u) => {
    if (!u) return;
    if (!form.elements.name.value) form.elements.name.value = u.name;
    if (!form.elements.email.value) form.elements.email.value = u.email;
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ok.hidden = true; err.hidden = true;
    const f = form.elements;
    const body = { name: f.name.value.trim(), email: f.email.value.trim(), topic: f.topic.value, message: f.message.value.trim() };
    const problem = (!body.name && 'Please enter your name') ||
      (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email) && 'Please enter a valid email') ||
      (body.message.length < 10 && 'Please write a little more about how we can help');
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const done = UI.busy(document.getElementById('cBtn'), 'Sending…');
    try {
      await API.post('/api/contact', body);
      ok.hidden = false;
      f.message.value = '';
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    done();
  });
})();
