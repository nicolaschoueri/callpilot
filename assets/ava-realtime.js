(() => {
  const endpoint = window.CALLPILOT_VOICE_ENDPOINT;
  if (!endpoint) return;
  const el = id => document.getElementById(id);
  const start = el('start'), end = el('end'), status = el('status'), transcript = el('transcript');
  if (!start || !end || !status || !transcript) return;
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.controls = true; audio.setAttribute('playsinline', '');
  el('audioPanel')?.appendChild(audio);
  const code = document.createElement('input'); code.type = 'password'; code.autocomplete = 'off';
  code.placeholder = 'Voice demo access code / Code de démo vocale'; code.setAttribute('aria-label', code.placeholder);
  start.parentElement.before(code);
  let call = null, generation = 0;
  const french = () => document.documentElement.lang.startsWith('fr');
  const message = (en, fr) => status.textContent = french() ? fr : en;
  const line = (who, text) => {
    const row = document.createElement('div'); row.className = 'line ' + (who === 'AVA' ? 'avaLine' : 'you');
    const label = document.createElement('span'); label.className = 'speaker'; label.textContent = who;
    row.append(label, document.createTextNode(text)); transcript.append(row); transcript.scrollTop = transcript.scrollHeight;
  };
  function cleanup() {
    generation++;
    if (call) {
      clearTimeout(call.timeout); clearTimeout(call.duration); call.abort.abort();
      call.stream?.getTracks().forEach(track => track.stop());
      call.channel?.close(); call.peer?.close(); call = null;
    }
    audio.pause(); audio.srcObject = null; start.disabled = false;
  }
  async function begin() {
    cleanup();
    if (!code.value.trim()) { code.focus(); message('Enter the demo access code', 'Entrez le code de démo'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      message('Use a browser with microphone support', 'Utilisez un navigateur qui prend en charge le micro'); return;
    }
    const version = generation;
    const current = { abort: new AbortController(), peer: null, stream: null, channel: null, timeout: null, duration: null };
    call = current; start.disabled = true;
    transcript.replaceChildren(); el('quick')?.replaceChildren();
    el('summary') && (el('summary').style.display = 'none');
    el('smsConfirmation') && (el('smsConfirmation').style.display = 'none');
    message('Connecting Ava… allow your microphone', 'Connexion à Ava… autorisez votre micro');
    current.timeout = setTimeout(() => { if (call === current) { cleanup(); message('Connection timed out. Try again.', 'La connexion a expiré. Réessayez.'); } }, 30_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (version !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      const peer = current.peer = new RTCPeerConnection();
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      peer.ontrack = event => {
        if (call !== current) return;
        audio.srcObject = event.streams[0];
        audio.play().catch(() => message('Tap the audio play button to hear Ava', 'Appuyez sur lecture pour entendre Ava'));
      };
      peer.onconnectionstatechange = () => {
        if (call === current && ['failed', 'closed'].includes(peer.connectionState)) {
          cleanup(); message('Call disconnected. Start again.', 'Appel déconnecté. Redémarrez.');
        }
      };
      const channel = current.channel = peer.createDataChannel('oai-events');
      channel.onopen = () => {
        if (call !== current) return;
        clearTimeout(current.timeout);
        message('Connected — speak naturally', 'Connecté — parlez naturellement');
        channel.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Greet the caller in the configured language and ask what service they need. Then wait.' } }));
        current.duration = setTimeout(() => { cleanup(); message('Five-minute demo complete', 'Démo de cinq minutes terminée'); }, 300_000);
      };
      channel.onmessage = event => {
        if (call !== current) return;
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'conversation.item.input_audio_transcription.completed') line(french() ? 'VOUS' : 'YOU', data.transcript || '');
        if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(data.type)) line('AVA', data.transcript || '');
        if (data.type === 'input_audio_buffer.speech_started') message('Listening…', 'À l’écoute…');
        if (data.type === 'response.done') message('Your turn — speak naturally', 'À vous — parlez naturellement');
        if (data.type === 'error') { cleanup(); message('Voice service error. Start again.', 'Erreur du service vocal. Redémarrez.'); }
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (version !== generation) return;
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + code.value.trim() },
        body: JSON.stringify({ sdp: peer.localDescription.sdp, lang: french() ? 'fr' : 'en' }), signal: current.abort.signal
      });
      if (version !== generation) return;
      if (!response.ok) throw new Error(String(response.status));
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    } catch (error) {
      if (version !== generation) return;
      cleanup();
      if (error.name === 'NotAllowedError') message('Allow microphone access to talk to Ava', 'Autorisez le micro pour parler à Ava');
      else if (error.message === '401') message('Incorrect demo access code', 'Code de démo incorrect');
      else if (error.message === '503') message('Live voice is not connected yet', 'Le service vocal n’est pas encore connecté');
      else message('Unable to connect Ava. Try again.', 'Impossible de connecter Ava. Réessayez.');
    }
  }
  // Replace existing controls so the legacy speech engine cannot run concurrently.
  start.onclick = begin;
  end.onclick = () => { cleanup(); message('Call ended', 'Appel terminé'); };
  el('replay') && (el('replay').onclick = () => audio.play().catch(() => {}));
  el('cpMicButton') && (el('cpMicButton').hidden = true);
  function sendText() {
    const input = el('answer'), text = input?.value.trim();
    if (!text || call?.channel?.readyState !== 'open') return;
    line(french() ? 'VOUS' : 'YOU', text); input.value = '';
    call.channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    call.channel.send(JSON.stringify({ type: 'response.create' }));
  }
  el('send') && (el('send').onclick = sendText);
  el('answer')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); sendText(); }
  }, true);
  ['siteFr', 'siteEn'].forEach(id => el(id)?.addEventListener('click', () => { if (call) { cleanup(); message('Start a new call in this language', 'Démarrez un nouvel appel dans cette langue'); } }));
  window.addEventListener('pagehide', cleanup);
})();
