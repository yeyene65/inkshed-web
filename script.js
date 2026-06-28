(function() {
    // DOM elements
    const paperStage = document.getElementById('paperStage');
    const paper = document.getElementById('paper');
    const paperContent = document.getElementById('paperContent');
    const candleGlow = document.getElementById('candleGlow');
    const uiMessage = document.getElementById('uiMessage');
    const soundToggle = document.getElementById('soundToggle');
    const particleCanvas = document.getElementById('particleCanvas');
    const ctx = particleCanvas.getContext('2d');
    const inkColorPicker = document.getElementById('inkColorPicker');
    const photoPicker = document.getElementById('photoPicker');
    const photoLayer = document.getElementById('photoLayer');
    const paintCanvas = document.getElementById('paintCanvas');
    const paintCtx = paintCanvas.getContext('2d');
    const brushSizeSlider = document.getElementById('brushSizeSlider');
    const brushSizePopup = document.getElementById('brushSizePopup');
    const quillImg = document.getElementById('toolQuillImg');
    const brushImg = document.getElementById('toolBrushImg');
    const gunImg = document.getElementById('toolGunImg');
    const inkImg = document.getElementById('toolInkImg');
    const musicMenuOverlay = document.getElementById('musicMenuOverlay');
    const bgVolumeSlider = document.getElementById('bgVolumeSlider');
    const trackButtons = document.querySelectorAll('.music-track');
    const shareOverlay = document.getElementById('shareOverlay');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    // State
    let currentInk = '#2b1e10';
    let writingActive = true, brushActive = false, gunActive = false;
    let isDrawing = false, brushSize = 8;
    let burnProgress = 0, burnAnimationId = null, burnStartTime = 0;
    const BURN_DURATION = 4000, MAX_BULLET_HOLES = 100;

    // Audio
    let audioCtx = null, soundEnabled = true;
    const SCRATCH_COUNT = 6;
    let currentGunshotAudio, currentScratchAudio, currentCrackleAudio, currentWhooshSource, currentChimeGain, bgAudio;
    let currentBrushLoop = null;   // looping brush audio
    let bgVolume = 0.4, currentTrack = null;

    // Particles
    const particles = [], MAX_PARTICLES = 150;
    let flameEmissionActive = false, flameEmissionPos = { x:0, y:0 };

    // Photo dragging/resizing
    let draggedPhoto = null, dragType = null;
    let dragStartX, dragStartY, startWidth, startHeight, startLeft, startTop;
    let activePhotoWrapper = null;

    // Typing sound filter
    let lastKeyIsPrintable = false;

    // Undo/Redo stacks for paint and photos
    let paintUndoStack = [];
    let paintRedoStack = [];
    let photoUndoStack = [];
    let photoRedoStack = [];

    // Canvas sizing
    function resizePaintCanvas() { const r = paintCanvas.parentElement.getBoundingClientRect(); paintCanvas.width = r.width; paintCanvas.height = r.height; }
    function resizeParticleCanvas() { particleCanvas.width = window.innerWidth; particleCanvas.height = window.innerHeight; }
    window.addEventListener('resize', () => { resizePaintCanvas(); resizeParticleCanvas(); });
    resizePaintCanvas(); resizeParticleCanvas();

    // Initial paint state
    function savePaintState() { paintUndoStack.push(paintCanvas.toDataURL()); paintRedoStack = []; }
    savePaintState(); // blank canvas

    function restorePaintState(dataUrl) {
        const img = new Image();
        img.onload = () => { paintCtx.clearRect(0,0,paintCanvas.width,paintCanvas.height); paintCtx.drawImage(img,0,0); };
        img.src = dataUrl;
    }

    function undoPaint() {
        if (paintUndoStack.length <= 1) return false;
        paintRedoStack.push(paintUndoStack.pop());
        restorePaintState(paintUndoStack[paintUndoStack.length-1]);
        return true;
    }

    function redoPaint() {
        if (paintRedoStack.length === 0) return false;
        const next = paintRedoStack.pop();
        paintUndoStack.push(next);
        restorePaintState(next);
        return true;
    }

    function addPhotoUndo(action) { photoUndoStack.push(action); photoRedoStack = []; }
    function undoPhoto() {
        if (photoUndoStack.length === 0) return false;
        const action = photoUndoStack.pop();
        if (action.type === 'add') { action.wrapper.remove(); photoRedoStack.push({ type:'remove', wrapper:action.wrapper }); }
        else { photoLayer.appendChild(action.wrapper); photoRedoStack.push({ type:'add', wrapper:action.wrapper }); }
        return true;
    }
    function redoPhoto() {
        if (photoRedoStack.length === 0) return false;
        const action = photoRedoStack.pop();
        if (action.type === 'add') { photoLayer.appendChild(action.wrapper); photoUndoStack.push({ type:'add', wrapper:action.wrapper }); }
        else { action.wrapper.remove(); photoUndoStack.push({ type:'remove', wrapper:action.wrapper }); }
        return true;
    }

    undoBtn.addEventListener('click', () => { if (!undoPaint()) undoPhoto(); });
    redoBtn.addEventListener('click', () => { if (!redoPaint()) redoPhoto(); });

    // Particles
    function spawnParticle(x, y, opts={}) {
        if (particles.length >= MAX_PARTICLES) return;
        particles.push({ x, y, vx: (Math.random()-.5)*(opts.speedX||2), vy: -(Math.random()*(opts.speedY||4)+(opts.minSpeedY||1)), life: opts.life||1.2+Math.random()*1.8, maxLife: opts.life||1.2+Math.random()*1.8, size: opts.size||2+Math.random()*4, color: opts.color||'#ffb347', glowColor: opts.glowColor||'#ff8c42', gravity: opts.gravity||0.1, flicker: Math.random()*Math.PI*2 });
    }
    function updateParticles(dt) {
        for (let i=particles.length-1; i>=0; i--) { const p = particles[i]; p.life -= dt; if(p.life<=0){particles.splice(i,1); continue;} p.x += p.vx*dt*60; p.y += p.vy*dt*60; p.vy += p.gravity*dt*60; p.vx *= 0.99; p.flicker += dt*10; }
        if (flameEmissionActive && burnProgress>0 && burnProgress<0.95) { const rate = 6 + burnProgress*18; for(let i=0; i<Math.min(10, Math.floor(rate*dt*60)); i++) { const sx = flameEmissionPos.x + (Math.random()-.5)*40; const sy = flameEmissionPos.y + (Math.random()-.5)*20; spawnParticle(sx,sy, { spreadX:20, spreadY:10, speedX:1.5, speedY:3, minSpeedY:2, life:.5+Math.random(), size:1+Math.random()*3, color: Math.random()<.3?'#ff6b9d':(Math.random()<.5?'#fbbf24':'#f97316'), glowColor:'#ffb347', gravity:.06 }); } }
    }
    function drawParticles() { ctx.clearRect(0,0,particleCanvas.width, particleCanvas.height); for(const p of particles) { const alpha = Math.max(0, p.life/p.maxLife); const flickerAlpha = alpha * (.6+.4*Math.sin(p.flicker)); const glowRad = p.size*3; const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRad); grad.addColorStop(0, p.glowColor.replace(')',`, ${flickerAlpha})`).replace('rgb','rgba')); grad.addColorStop(.5, p.glowColor.replace(')',`, ${flickerAlpha*.4})`).replace('rgb','rgba')); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, glowRad, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = p.color.replace(')',`, ${flickerAlpha})`).replace('rgb','rgba'); ctx.beginPath(); ctx.arc(p.x, p.y, p.size*(.5+.5*Math.sin(p.flicker)), 0, Math.PI*2); ctx.fill(); } }
    function particleLoop() { let last = performance.now(); function loop(now) { const dt = Math.min((now-last)/1000, 0.1); last = now; updateParticles(dt); drawParticles(); requestAnimationFrame(loop); } requestAnimationFrame(loop); }
    particleLoop();

    // Audio helpers
    function initAudio() { if(!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { soundEnabled=false; updateSoundUI(); } } if(audioCtx?.state === 'suspended') audioCtx.resume(); }
    function stopAudio(a) { if(a) { a.pause(); a.currentTime=0; } }
    function stopAllSounds() {
        stopAudio(currentGunshotAudio); stopAudio(currentScratchAudio); stopAudio(currentCrackleAudio);
        stopBrushLoop(); // stop brush loop
        if(currentWhooshSource) { try{currentWhooshSource.stop();}catch(e){} currentWhooshSource=null; }
        if(currentChimeGain) { try{currentChimeGain.disconnect();}catch(e){} currentChimeGain=null; }
    }
    function playGunshot() { if(!soundEnabled) return; stopAudio(currentGunshotAudio); const a = new Audio('audio/pistol.mp3'); a.volume=0.9; currentGunshotAudio=a; a.play().catch(()=>{}); a.onended=()=>{ if(currentGunshotAudio===a) currentGunshotAudio=null; }; }
    function playScratch() { if(!soundEnabled) return; stopAudio(currentScratchAudio); const idx = Math.floor(Math.random()*SCRATCH_COUNT)+1; const a = new Audio(`audio/write-package/write${idx}.mp3`); a.volume=0.7; currentScratchAudio=a; a.play().catch(()=>{ const fallback = new Audio('audio/write-package/playrandom.mp3'); fallback.volume=0.3; currentScratchAudio=fallback; fallback.play().catch(()=>{}); }); a.onended=()=>{ if(currentScratchAudio===a) currentScratchAudio=null; }; }
    function playExplosion() { if(!soundEnabled) return; const a = new Audio('audio/explosion.mp3'); a.volume=0.5; a.play().catch(()=>{}); }
    function playCrackle() { if(currentCrackleAudio && !currentCrackleAudio.paused) return; stopAudio(currentCrackleAudio); const a = new Audio('audio/burning.mp3'); a.volume=0.8; a.loop=true; currentCrackleAudio=a; a.play().catch(()=>{}); }
    function playWhoosh(v=0.06) { if(!soundEnabled||!audioCtx) return; stopAllSounds(); const dur=0.7; const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate*dur), audioCtx.sampleRate); const data = buf.getChannelData(0); for(let i=0; i<data.length; i++) data[i] = (Math.random()*2-1)*Math.exp(-i/audioCtx.sampleRate*3)*v; const src = audioCtx.createBufferSource(); src.buffer=buf; const gain=audioCtx.createGain(); gain.gain.setValueAtTime(v, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+dur); const filter=audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.setValueAtTime(300, audioCtx.currentTime); src.connect(filter).connect(gain).connect(audioCtx.destination); currentWhooshSource=src; src.start(); src.onended=()=>{ if(currentWhooshSource===src) currentWhooshSource=null; }; }

    // Brush looping sound
    function startBrushLoop() {
        if (!soundEnabled || !brushActive) return;
        stopBrushLoop(); // ensure no overlap
        const idx = Math.floor(Math.random() * 3) + 1;
        const a = new Audio(`audio/brush-pack/brush${idx}.mp3`);
        a.loop = true;
        a.volume = 0.6;
        currentBrushLoop = a;
        a.play().catch(() => {});
    }

    function stopBrushLoop() {
        if (currentBrushLoop) {
            currentBrushLoop.pause();
            currentBrushLoop.currentTime = 0;
            currentBrushLoop.loop = false;
            currentBrushLoop = null;
        }
    }

    function playChime() { if(!soundEnabled||!audioCtx) return; stopAllSounds(); const now = audioCtx.currentTime; const gain = audioCtx.createGain(); currentChimeGain=gain; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.08, now+0.05); gain.gain.exponentialRampToValueAtTime(0.001, now+1.2); gain.connect(audioCtx.destination); [523.25,659.25,783.99].forEach((f,i)=>{ const osc = audioCtx.createOscillator(); osc.type='sine'; osc.frequency.setValueAtTime(f, now+i*0.08); osc.connect(gain); osc.start(now+i*0.08); osc.stop(now+i*0.08+1.2); }); setTimeout(()=>{ if(currentChimeGain===gain) currentChimeGain=null; }, 1300); }
    function updateSoundUI() { soundToggle.textContent = soundEnabled ? '🔊' : '🔇'; soundToggle.classList.toggle('muted', !soundEnabled); }
    soundToggle.addEventListener('click', ()=>{ initAudio(); soundEnabled=!soundEnabled; updateSoundUI(); });
    updateSoundUI();

    // Background music
    function playBackgroundTrack(filename) { if(bgAudio) { bgAudio.pause(); bgAudio=null; } if(filename==='none') { currentTrack=filename; trackButtons.forEach(b=>b.classList.remove('selected')); return; } const a = new Audio(`audio/vinyl-music/${filename}`); a.loop=true; a.volume=bgVolume; bgAudio=a; currentTrack=filename; a.play().catch(()=>{}); trackButtons.forEach(b=>b.classList.remove('selected')); const btn = document.querySelector(`.music-track[data-file="${filename}"]`); if(btn) btn.classList.add('selected'); }
    bgVolumeSlider.addEventListener('input', e=>{ bgVolume = e.target.value/100; if(bgAudio) bgAudio.volume=bgVolume; });
    trackButtons.forEach(b=>b.addEventListener('click', e=>playBackgroundTrack(e.currentTarget.dataset.file)));
    document.getElementById('vinylPlayer').addEventListener('click', ()=>musicMenuOverlay.classList.add('active'));
    document.getElementById('closeMusicMenu').addEventListener('click', ()=>musicMenuOverlay.classList.remove('active'));
    musicMenuOverlay.addEventListener('click', e=>{ if(e.target===musicMenuOverlay) musicMenuOverlay.classList.remove('active'); });

    // Share
    document.getElementById('envelopeWrap').addEventListener('click', (e)=>{ e.stopPropagation(); deactivateGun(); deactivateBrush(); deactivateWriting(); shareOverlay.classList.add('active'); });
    document.getElementById('closeShare').addEventListener('click', ()=>shareOverlay.classList.remove('active'));
    shareOverlay.addEventListener('click', e=>{ if(e.target===shareOverlay) shareOverlay.classList.remove('active'); });
    function getPaperText() { return paperContent.textContent || 'My thoughts from Inkshed'; }
    document.getElementById('shareX').addEventListener('click', ()=>{ window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(getPaperText())} - from Inkshed`, '_blank'); shareOverlay.classList.remove('active'); });
    document.getElementById('shareInstagram').addEventListener('click', ()=>{ alert('Copied to clipboard! Paste on Instagram.'); navigator.clipboard.writeText(getPaperText()); shareOverlay.classList.remove('active'); });
    document.getElementById('shareFacebook').addEventListener('click', ()=>{ window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(getPaperText())}`, '_blank'); shareOverlay.classList.remove('active'); });
    document.getElementById('downloadPNG').addEventListener('click', ()=>{
        paperContent.classList.add('hide-placeholder');
        html2canvas(paper, { backgroundColor: null }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'inkshed.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            paperContent.classList.remove('hide-placeholder');
        });
        shareOverlay.classList.remove('active');
    });

    // Photo album tool
    document.getElementById('albumToolWrap').addEventListener('click', (e)=>{ e.stopPropagation(); deactivateGun(); deactivateBrush(); deactivateWriting(); photoPicker.click(); });
    photoPicker.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const wrapper = document.createElement('div'); wrapper.className='photo-wrapper';
            wrapper.style.left = '20%'; wrapper.style.top = '20%'; wrapper.style.width = '150px'; wrapper.style.height = 'auto';
            const img = document.createElement('img'); img.src = ev.target.result; wrapper.appendChild(img);
            const handle = document.createElement('div'); handle.className='resize-handle'; wrapper.appendChild(handle);
            const deleteBtn = document.createElement('div'); deleteBtn.className='delete-btn'; deleteBtn.textContent = '✕';
            deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); wrapper.remove(); addPhotoUndo({ type:'remove', wrapper }); if(activePhotoWrapper===wrapper) activePhotoWrapper=null; });
            wrapper.appendChild(deleteBtn);
            wrapper.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activePhotoWrapper && activePhotoWrapper !== wrapper) activePhotoWrapper.classList.remove('active');
                activePhotoWrapper = wrapper;
                wrapper.classList.toggle('active');
            });
            wrapper.addEventListener('mousedown', e => startDragPhoto(e, wrapper, 'move'));
            wrapper.addEventListener('touchstart', e => startDragPhoto(e, wrapper, 'move'), {passive:false});
            handle.addEventListener('mousedown', e => { e.stopPropagation(); startDragPhoto(e, wrapper, 'resize'); });
            handle.addEventListener('touchstart', e => { e.stopPropagation(); startDragPhoto(e, wrapper, 'resize'); }, {passive:false});
            photoLayer.appendChild(wrapper);
            addPhotoUndo({ type:'add', wrapper });
        };
        reader.readAsDataURL(file);
        photoPicker.value = '';
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.photo-wrapper') && activePhotoWrapper) { activePhotoWrapper.classList.remove('active'); activePhotoWrapper = null; } });

    function clamp(val,min,max){ return Math.min(max, Math.max(min,val)); }
    function startDragPhoto(e, wrapper, type) {
        e.preventDefault();
        draggedPhoto = wrapper; dragType = type;
        const rect = paper.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        dragStartX = clientX; dragStartY = clientY;
        startWidth = parseFloat(wrapper.style.width) || 150;
        startHeight = parseFloat(wrapper.style.height) || (wrapper.querySelector('img').naturalHeight * (startWidth / wrapper.querySelector('img').naturalWidth));
        startLeft = parseFloat(wrapper.style.left) || 0;
        startTop = parseFloat(wrapper.style.top) || 0;
        document.addEventListener('mousemove', onPhotoDrag); document.addEventListener('mouseup', stopPhotoDrag);
        document.addEventListener('touchmove', onPhotoDrag, {passive:false}); document.addEventListener('touchend', stopPhotoDrag);
    }
    function onPhotoDrag(e) {
        if(!draggedPhoto) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - dragStartX, dy = clientY - dragStartY;
        const paperRect = paper.getBoundingClientRect();
        const pw = paperRect.width, ph = paperRect.height;
        if(dragType === 'move') {
            const w = draggedPhoto.offsetWidth, h = draggedPhoto.offsetHeight;
            let nl = startLeft + (dx/pw*100);
            let nt = startTop + (dy/ph*100);
            nl = clamp(nl, 0, 100 - (w/pw*100));
            nt = clamp(nt, 0, 100 - (h/ph*100));
            draggedPhoto.style.left = nl+'%';
            draggedPhoto.style.top = nt+'%';
        } else {
            const img = draggedPhoto.querySelector('img');
            const aspect = img.naturalWidth / img.naturalHeight;
            let nw = Math.max(20, startWidth + dx);
            let nh = nw / aspect;
            const clp = parseFloat(draggedPhoto.style.left) || 0;
            const maxWPercent = 100 - clp;
            const maxW = (maxWPercent/100)*pw;
            nw = Math.min(nw, maxW);
            const ctp = parseFloat(draggedPhoto.style.top) || 0;
            const maxHPercent = 100 - ctp;
            const maxH = (maxHPercent/100)*ph;
            nh = Math.min(nh, maxH);
            if (nh < (nw/aspect)) nw = nh * aspect;
            draggedPhoto.style.width = nw+'px';
            draggedPhoto.style.height = (nw/aspect)+'px';
        }
    }
    function stopPhotoDrag() {
        draggedPhoto = null; dragType = null;
        document.removeEventListener('mousemove', onPhotoDrag); document.removeEventListener('mouseup', stopPhotoDrag);
        document.removeEventListener('touchmove', onPhotoDrag); document.removeEventListener('touchend', stopPhotoDrag);
    }

    // Writing & Quill
    function activateWriting() {
        writingActive = true; brushActive = false; stopBrushLoop(); brushImg.classList.remove('active');
        paintCanvas.classList.remove('active'); brushSizePopup.classList.remove('active');
        paperContent.contentEditable = 'true'; paperContent.classList.remove('disabled'); paperContent.focus();
        quillImg.classList.add('active');
    }
    function deactivateWriting() { writingActive = false; paperContent.contentEditable = 'false'; paperContent.classList.add('disabled'); quillImg.classList.remove('active'); }
    document.getElementById('toolQuillWrap').addEventListener('click', (e)=>{ e.stopPropagation(); if(!writingActive) { activateWriting(); deactivateGun(); } });

    // Brush
    function activateBrush() {
        brushActive = true; writingActive = false; deactivateWriting(); quillImg.classList.remove('active');
        brushImg.classList.add('active'); paintCanvas.classList.add('active'); brushSizePopup.classList.add('active'); deactivateGun();
    }
    function deactivateBrush() {
        brushActive = false; stopBrushLoop(); brushImg.classList.remove('active');
        paintCanvas.classList.remove('active'); brushSizePopup.classList.remove('active');
    }
    document.getElementById('toolBrushWrap').addEventListener('click', (e)=>{ e.stopPropagation(); brushActive ? deactivateBrush() : activateBrush(); });
    brushSizeSlider.addEventListener('input', e=> brushSize = parseInt(e.target.value, 10));

    function getCanvasCoords(e) {
        const rect = paintCanvas.getBoundingClientRect();
        const scaleX = paintCanvas.width / rect.width, scaleY = paintCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }
    function startDrawing(e) {
        if(!brushActive) return;
        isDrawing = true;
        const pos = getCanvasCoords(e);
        paintCtx.beginPath();
        paintCtx.moveTo(pos.x, pos.y);
        startBrushLoop();    // start continuous sound
    }
    function draw(e) {
        if(!isDrawing || !brushActive) return;
        e.preventDefault();
        const pos = getCanvasCoords(e);
        paintCtx.lineTo(pos.x, pos.y);
        paintCtx.strokeStyle = currentInk;
        paintCtx.lineWidth = brushSize;
        paintCtx.lineCap = 'round';
        paintCtx.lineJoin = 'round';
        paintCtx.stroke();
    }
    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        paintCtx.closePath();
        stopBrushLoop();     // stop continuous sound
        savePaintState();
    }
    paintCanvas.addEventListener('mousedown', startDrawing);
    paintCanvas.addEventListener('mousemove', draw);
    paintCanvas.addEventListener('mouseup', stopDrawing);
    paintCanvas.addEventListener('mouseleave', stopDrawing);
    paintCanvas.addEventListener('touchstart', startDrawing, {passive:false});
    paintCanvas.addEventListener('touchmove', draw, {passive:false});
    paintCanvas.addEventListener('touchend', stopDrawing);

    // Ink color
    document.getElementById('toolInkWrap').addEventListener('click', (e)=>{ e.stopPropagation(); deactivateGun(); inkColorPicker.click(); });
    inkColorPicker.addEventListener('input', e=>{ currentInk = e.target.value; inkImg.style.filter = `drop-shadow(0 0 10px ${currentInk})`; });

    // Gun
    function fireRandomShot() { if(burnProgress) return; const x=5+Math.random()*90, y=5+Math.random()*90; addBulletHole(x,y); }
    function addBulletHole(xPercent, yPercent, size = 18 + Math.random() * 35) {
        const idx = Math.floor(Math.random() * 6) + 1;
        const img = document.createElement('img'); img.className='bullet-hole';
        img.src = `assets/gunshot-marks/mark-${idx}.svg`;
        img.style.width=size+'px'; img.style.left=xPercent+'%'; img.style.top=yPercent+'%';
        paper.appendChild(img);
        while(paper.querySelectorAll('.bullet-hole').length > MAX_BULLET_HOLES) { paper.querySelectorAll('.bullet-hole')[0].remove(); }
        const rect=paper.getBoundingClientRect();
        for(let i=0;i<6;i++) spawnParticle(rect.left + xPercent/100*rect.width, rect.top + yPercent/100*rect.height, {spreadX:1,spreadY:1,speedX:2,speedY:3,life:.3+Math.random()*.5,size:1+Math.random()*3,color:'#ffb347'});
        playGunshot();
    }
    document.getElementById('toolGunWrap').addEventListener('click', (e)=>{ e.stopPropagation(); initAudio(); deactivateBrush(); deactivateWriting(); if(!gunActive) { gunActive=true; gunImg.classList.add('active'); fireRandomShot(); } else fireRandomShot(); });
    function deactivateGun() { gunActive=false; gunImg.classList.remove('active'); }

    // Candle burn
    function startBurn() {
        if(burnProgress) return;
        stopAllSounds();
        burnProgress = 0.01; burnStartTime = performance.now(); flameEmissionActive = true;
        paperContent.contentEditable='false'; paperContent.blur(); candleGlow.classList.add('lit');
        playWhoosh();
        function burnLoop(now) {
            const elapsed = now - burnStartTime;
            burnProgress = Math.min(elapsed / BURN_DURATION, 1);
            const keepX = (1-burnProgress)*100;
            paper.style.clipPath = `polygon(0% 0%, ${keepX}% 0%, ${keepX}% 100%, 0% 100%)`;
            const rect = paper.getBoundingClientRect();
            flameEmissionPos = { x: rect.left + rect.width*(1-burnProgress), y: rect.top + rect.height/2 };
            if(burnProgress < 0.95 && Math.random()<0.3) playCrackle();
            if(burnProgress >= 1) { finishBurn(); return; }
            burnAnimationId = requestAnimationFrame(burnLoop);
        }
        burnAnimationId = requestAnimationFrame(burnLoop);
    }
    function finishBurn() {
        flameEmissionActive = false; cancelAnimationFrame(burnAnimationId); stopAudio(currentCrackleAudio);
        paper.style.clipPath = 'polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)'; candleGlow.classList.remove('lit');
        playChime(); uiMessage.textContent='Breathe, you are safe.'; uiMessage.classList.add('visible');
        setTimeout(resetPaper, 2800);
    }
    function resetPaper() {
        stopAllSounds(); paper.style.clipPath='polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
        paperContent.contentEditable='true'; paperContent.innerHTML=''; paper.querySelectorAll('.bullet-hole').forEach(h=>h.remove());
        photoLayer.innerHTML=''; paintCtx.clearRect(0,0,paintCanvas.width,paintCanvas.height);
        paintUndoStack = []; paintRedoStack = []; photoUndoStack = []; photoRedoStack = [];
        savePaintState();
        burnProgress=0; flameEmissionActive=false; uiMessage.classList.remove('visible'); candleGlow.classList.remove('lit');
        particles.length=0; deactivateGun(); deactivateBrush(); activateWriting(); paperStage.classList.remove('shaking');
    }
    document.getElementById('toolCandleWrap').addEventListener('click', (e)=>{ e.stopPropagation(); deactivateGun(); deactivateBrush(); deactivateWriting(); initAudio(); startBurn(); });

    // Bomb
    function explodePaper() {
        if(burnProgress) return; 
        initAudio(); 
        playExplosion();
        paperStage.classList.add('shaking');
        setTimeout(()=>{
            for(let i=0;i<25;i++) addBulletHole(Math.random()*100, Math.random()*100, 18+Math.random()*16);
            const rect = paper.getBoundingClientRect();
            const cx = rect.left+rect.width/2, cy = rect.top+rect.height/2;
            for(let i=0;i<60;i++) spawnParticle(cx,cy,{spreadX:50,spreadY:50,speedX:4,speedY:5,life:1+Math.random()*2,size:2+Math.random()*5,color:'#ff4444',glowColor:'#ff8844',gravity:0.2});
            stopAllSounds(); playExplosion();
            setTimeout(()=>{ resetPaper(); uiMessage.textContent='Boom. The slate is wiped.'; uiMessage.classList.add('visible'); setTimeout(()=>uiMessage.classList.remove('visible'),2000); },400);
        },300);
    }
    document.getElementById('toolBombWrap').addEventListener('click', (e)=>{ e.stopPropagation(); deactivateGun(); deactivateBrush(); deactivateWriting(); explodePaper(); });

    // Typing sound
    paperContent.addEventListener('keydown', e => {
        const ignored = ['Backspace','Delete','Enter',' ','Space','CapsLock','Control','Shift','Alt','Meta','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
        lastKeyIsPrintable = !ignored.includes(e.key) && e.key.length === 1;
    });
    paperContent.addEventListener('input', () => {
        if(burnProgress) return;
        if(writingActive) { if(lastKeyIsPrintable) playScratch(); handleInkInsert(); }
        lastKeyIsPrintable = false;
    });
    function handleInkInsert() {
        const sel = window.getSelection(); if(!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if(range.startContainer.nodeType===3 && range.startOffset>0) {
            const textNode = range.startContainer;
            const char = textNode.textContent[range.startOffset-1];
            if(char) {
                const span = document.createElement('span'); span.style.color=currentInk; span.textContent=char;
                const pre = document.createRange(); pre.setStart(textNode, range.startOffset-1); pre.setEnd(textNode, range.startOffset);
                pre.deleteContents(); pre.insertNode(span);
                const newR = document.createRange(); newR.setStartAfter(span); newR.collapse(true);
                sel.removeAllRanges(); sel.addRange(newR);
            }
        }
    }

    // Init
    activateWriting();
    document.body.addEventListener('click', ()=> initAudio(), {once:true});
})();