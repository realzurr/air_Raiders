/**
 * AIR RAIDERS // REMASTERED COCKPIT EDITION
 * Engenharia reversa fiel do binário AIRAIDRS.BIN (Atari 2600 - M Network, 1982)
 *
 * CRÉDITOS DO JOGO ORIGINAL (1982):
 * - Design & Programação 6502: Larry Zwick
 * - Publicação: M Network (Mattel Electronics) - Catálogo #MT5661
 *
 * CRÉDITOS DA VERSÃO REMASTER WEB:
 * - Autor / Engenharia Reversa & Remaster: @realzurr (https://github.com/realzurr)
 *
 * Regras originais extraídas da ROM ($F07E - $FFF0):
 * - Pitch ($DA): 0x01 (mergulho máximo) a 0x2C (subida máxima), centro nivelado = 0x16 (22).
 * - Roll ($D9): 0xFE (-2, inclinação esquerda) a 0x02 (+2, inclinação direita), centro = 0x00.
 * - Posição X de 10 bits ($E7:$E6, 0..1023): Zona central de Flak intenso quando $E7 == 1 ou 2 (256..767).
 * - Altitude interna ($E5, 0..255) convertida pela equação da ROM ($F2F6) para 00..40 milhares de pés.
 * - Combustível ($DC:$DD): Inicia em $1B (27 unidades). Drena a cada 8 frames por (DA + 0x14) >> 3.
 *   Voar ou subir em alta atitude consome até 2x mais combustível!
 * - Munição ($DF): Inicia em 99 BCD. Cada disparo consome 1 projétil.
 * - Pouso e Reabastecimento ($F231-$F2A0):
 *   1. Decolagem: Pressionar Fogo na pista -> acelera de $41 a $58 -> puxar manche para subir -> decola em $7F.
 *   2. Aproximação de pouso: Em ALT 00 nivelado ($DA == $16) por 10 ciclos -> pista aparece ($E3 = $C0).
 *   3. Toque na pista: Empurrar manche totalmente para frente ($DA == $2C) para alinhar com a pista e soltar.
 *   4. Regra dos 10 Abates ($F28D: CMP #$0A): Se abates na sortida ($DB - $E1) >= 10:
 *      - Combustível reabastecido para $1B (27)
 *      - Nova munição ($DF) = número de abates conquistados na sortida!
 *      Caso contrário (< 10 abates), missão encerrada!
 */

(() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // UI Elements
  const uiPhase = document.getElementById('ui-phase');
  const uiSortie = document.getElementById('ui-sortie');
  const uiRank = document.getElementById('ui-rank');
  const hudBanner = document.getElementById('hud-banner');

  const btnDifficulty = document.getElementById('btn-difficulty');
  const lblDiff = document.getElementById('lbl-diff');
  const btnAudio = document.getElementById('btn-audio');
  const lblAudio = document.getElementById('lbl-audio');
  const btnRules = document.getElementById('btn-rules');
  const btnReset = document.getElementById('btn-reset');

  const overlayStart = document.getElementById('overlay-start');
  const overlayManual = document.getElementById('overlay-manual');
  const overlayGameOver = document.getElementById('overlay-gameover');

  const btnStartGame = document.getElementById('btn-start-game');
  const btnCloseManual = document.getElementById('btn-close-manual');
  const btnRestartGame = document.getElementById('btn-restart-game');

  const goTag = document.getElementById('go-tag');
  const goTitle = document.getElementById('go-title');
  const goReason = document.getElementById('go-reason');
  const goHits = document.getElementById('go-hits');
  const goSorties = document.getElementById('go-sorties');
  const goRank = document.getElementById('go-rank');

  // ============================================================================
  // SISTEMA DE ÁUDIO WEB AUDIO API (Sintetizador Moderno + Texturas do TIA)
  // ============================================================================
  class SoundSystem {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.engineOsc = null;
      this.engineSub = null;
      this.engineNoiseGain = null;
      this.engineGain = null;
      this.engineFilter = null;
      this.isInitialized = false;
    }

    init() {
      if (this.isInitialized) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Ruído branco contínuo filtrado para turbina a jato
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'bandpass';
      this.engineFilter.frequency.value = 280;
      this.engineFilter.Q.value = 2.2;

      this.engineNoiseGain = this.ctx.createGain();
      this.engineNoiseGain.gain.value = 0.0;

      // Oscilador harmônico de turbina (baseado na lógica de AUDF1 $18 da ROM)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 85;

      this.engineSub = this.ctx.createOscillator();
      this.engineSub.type = 'triangle';
      this.engineSub.frequency.value = 42.5;

      const oscFilter = this.ctx.createBiquadFilter();
      oscFilter.type = 'lowpass';
      oscFilter.frequency.value = 340;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      whiteNoise.connect(this.engineFilter);
      this.engineFilter.connect(this.engineNoiseGain);
      this.engineNoiseGain.connect(this.ctx.destination);

      this.engineOsc.connect(oscFilter);
      this.engineSub.connect(oscFilter);
      oscFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      whiteNoise.start();
      this.engineOsc.start();
      this.engineSub.start();
      this.isInitialized = true;
    }

    updateEngine(active, pitchDA, runwayState, fuel, crashTimer) {
      if (!this.isInitialized || !this.enabled) {
        if (this.engineGain) {
          this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
          this.engineNoiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        }
        return;
      }

      if (!active || fuel <= 0 || crashTimer > 0 || runwayState === 0x40) {
        // Na pista parado ou sem combustível -> motor silencioso ou marcha lenta baixa
        const idle = (active && runwayState === 0x40 && fuel > 0) ? 0.025 : 0;
        this.engineGain.gain.setTargetAtTime(idle, this.ctx.currentTime, 0.08);
        this.engineNoiseGain.gain.setTargetAtTime(idle * 0.7, this.ctx.currentTime, 0.08);
        this.engineOsc.frequency.setTargetAtTime(55, this.ctx.currentTime, 0.1);
        this.engineSub.frequency.setTargetAtTime(27.5, this.ctx.currentTime, 0.1);
        return;
      }

      let baseFreq = 95;
      let filterFreq = 380;
      let vol = 0.075;

      if (runwayState > 0x40 && runwayState < 0x80) {
        // Acelerando na pista ($41..$7F na ROM $F3B4)
        const progress = (runwayState - 0x40) / 63;
        baseFreq = 65 + progress * 95;
        filterFreq = 250 + progress * 650;
        vol = 0.09;
      } else {
        // Em voo ($F3C4: pitch DA altera a frequência do motor)
        // Subir (DA < 22) exige mais potência, mergulhar (DA > 22) aumenta o giro aerodinâmico
        const climbFactor = (22 - pitchDA) / 22; // -1 (mergulho) a +1 (subida)
        baseFreq = 110 - climbFactor * 28;
        filterFreq = 450 + Math.abs(climbFactor) * 280;
      }

      this.engineOsc.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.05);
      this.engineSub.frequency.setTargetAtTime(baseFreq * 0.5, this.ctx.currentTime, 0.05);
      this.engineFilter.frequency.setTargetAtTime(filterFreq, this.ctx.currentTime, 0.05);
      this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
      this.engineNoiseGain.gain.setTargetAtTime(vol * 1.1, this.ctx.currentTime, 0.05);
    }

    // Sequência $FED8 (D6=1): Disparo do Canhão Vulcan
    playCannon() {
      if (!this.isInitialized || !this.enabled) return;
      const now = this.ctx.currentTime;

      // Impacto de ruído de alta pressão
      const bufferSize = this.ctx.sampleRate * 0.14;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.04));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + 0.13);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.13);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);

      // Pulso sintético estilo Vulcan
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.11);

      const oscGain = this.ctx.createGain();
      oscGain.gain.setValueAtTime(0.22, now);
      oscGain.gain.exponentialRampToValueAtTime(0.005, now + 0.11);

      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }

    // Sequência $FEFA (D6=0x23): Explosão de Caça Inimigo Abatido
    playEnemyExplosion() {
      if (!this.isInitialized || !this.enabled) return;
      const now = this.ctx.currentTime;

      const dur = 0.55;
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.4);
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(850, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.42, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);

      // Sub-bass boom
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);

      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.35, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

      osc.connect(subGain);
      subGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.46);
    }

    // Sequência $FF14 (D6=0x3D): Explosão de Artilharia Antiaérea (Flak)
    playFlakBurst(closeHit = false) {
      if (!this.isInitialized || !this.enabled) return;
      const now = this.ctx.currentTime;
      const dur = closeHit ? 0.38 : 0.22;

      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * (closeHit ? 0.12 : 0.06)));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(closeHit ? 620 : 420, now);
      filter.frequency.exponentialRampToValueAtTime(75, now + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(closeHit ? 0.45 : 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);
    }

    // Som de Reabastecimento / Pouso Bem-Sucedido
    playRefuelChime() {
      if (!this.isInitialized || !this.enabled) return;
      const now = this.ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.18, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.09 + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.26);
      });
    }

    // Alerta de Baixo Combustível
    playLowFuelBeep() {
      if (!this.isInitialized || !this.enabled) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    }
  }

  const sound = new SoundSystem();

  // ============================================================================
  // CONSTANTES E TABELAS EXTRAÍDAS DO BINÁRIO (AIRAIDRS.BIN)
  // ============================================================================
  const PITCH_MIN = 0x01;    // Subida máxima (Joystick para baixo / puxar manche)
  const PITCH_CENTER = 0x16; // Voo nivelado (22 decimal)
  const PITCH_MAX = 0x2C;    // Mergulho máximo (44 decimal - Joystick para cima)

  const ROLL_MIN = -2;       // Inclinação máxima à esquerda ($FE)
  const ROLL_MAX = 2;        // Inclinação máxima à direita ($02)

  const INITIAL_FUEL = 0x1B; // 27 unidades ($1B na tabela $F066)
  const INITIAL_AMMO = 99;   // $99 BCD na tabela $F066

  // Classificações oficiais do manual do Air Raiders
  function getPilotRank(hits) {
    if (hits < 10) return 'CADETE (STUDENT PILOT)';
    if (hits < 25) return 'PILOTO NOVATO (NOVICE)';
    if (hits < 40) return 'PILOTO DE CAÇA (FIGHTER PILOT)';
    if (hits < 65) return 'ÁS DA AVIAÇÃO (ACE PILOT)';
    if (hits < 90) return 'DUPLO ÁS (DOUBLE ACE)';
    return 'TRIPLO ÁS SUPREMO (TRIPLE ACE)';
  }

  // ============================================================================
  // ESTADO DO JOGO (Mapeado diretamente dos registradores da RAM $80-$FF)
  // ============================================================================
  const keys = {
    up: false,    // Push forward -> Dive (aumenta $DA até $2C)
    down: false,  // Pull back -> Climb (diminui $DA até $01)
    left: false,  // Bank left (diminui $D9 até -2)
    right: false, // Bank right (aumenta $D9 até +2)
    fire: false   // Fire button ($0C INPT4)
  };

  let gameRunning = false;
  let expertMode = false; // Difficulty Switch: false = Novice (B), true = Expert (A)

  const state = {
    frameCounter: 0,       // Ciclo 0..7 ($E8 na ROM)
    totalFrames: 0,

    // Orientação da aeronave
    pitchDA: PITCH_CENTER, // $DA: 1..44 (22 = centro)
    rollD9: 0,             // $D9: -2..+2 (0 = centro)
    smoothPitch: PITCH_CENTER,
    smoothRoll: 0,

    // Posição no mundo ($E7:$E6 horizontal 0..1023, $E5 altitude interna 0..255)
    worldX: 0x01C0,        // Inicia em $01C0 (448, centro do mapa como na ROM $F066)
    altRawE5: 0,           // $E5: 0..255
    altDisplayD7: 0,       // $D7: 0..40 (milhares de pés)

    // Recursos e Pontuação
    fuelDC: INITIAL_FUEL,  // $DC: 0..27
    fuelSubDD: 0,          // $DD: acumulador fracionário de combustível (0..255)
    ammoDF: INITIAL_AMMO,  // $DF: 0..99
    hitsDB: 0,             // $DB: total de abates (0..99)
    prevLandingHitsE1: 0,  // $E1: abates acumulados até o último pouso
    sortieCount: 1,

    // Estados de Pista / Voo / Colisão ($E3, $E2, $E4, $DE)
    runwayStateE3: 0x40,   // $40 = parado na pista, $41..$7F = decolando, $00 = em voo, $C0..$FF = pousando
    statusE2: 0x40,        // $40 = pista/pronto, $C0 = voando normal, $80.. = turbulência de flak, $30..$00 = queda/crash
    runwayTimerE4: 0,      // $E4: contador de frames nivelado em ALT 00 para avistar pista
    screenFlashDE: 0,      // $DE: flash de dano/impacto no para-brisa

    // Projétil do Canhão ($D4, $D5, $D2, $D3)
    bulletTimerD4: -1,     // $D4: >= 0 ativo
    bulletDistD5: 0x9A,    // $D5: distância vertical/profundidade do tiro
    bulletXOffset: 0,      // Deslocamento lateral do tiro ao inclinar
    bulletYScreen: 0,

    // Flak (Artilharia Antiaérea - $EB, $D8)
    flakTimerEB: 0x80,
    flakClouds: [],        // Nuvens de fumaça preta de Flak no céu

    // Objetos Aéreos ($80-$9D: até 9 slots de caças inimigos / formações)
    enemies: [],

    // Efeitos Visuais Modernos (Partículas, Nuvens, Estrelas/Terreno)
    particles: [],
    clouds: [],
    groundStripes: [],
    lowFuelBeepTimer: 0
  };

  // Inicializa nuvens atmosféricas para sensação de velocidade 3D
  function initAtmosphere() {
    state.clouds = [];
    for (let i = 0; i < 28; i++) {
      state.clouds.push({
        wx: Math.random() * 1024,
        wy: 20 + Math.random() * 220,
        z: 0.1 + Math.random() * 0.9,
        size: 50 + Math.random() * 90,
        alpha: 0.12 + Math.random() * 0.22
      });
    }
  }

  // Reinicia a missão com os exatos valores da tabela $F066 da ROM
  function resetGame() {
    state.frameCounter = 0;
    state.totalFrames = 0;
    state.pitchDA = PITCH_CENTER; // $16
    state.rollD9 = 0;             // $00
    state.smoothPitch = PITCH_CENTER;
    state.smoothRoll = 0;

    state.worldX = 0x01C0;        // $E7=01, $E6=C0 (448)
    state.altRawE5 = 0;           // $E5=00
    state.altDisplayD7 = 0;       // $D7=00

    state.fuelDC = INITIAL_FUEL;  // $1B (27)
    state.fuelSubDD = 0;
    state.ammoDF = INITIAL_AMMO;  // 99
    state.hitsDB = 0;
    state.prevLandingHitsE1 = 0;
    state.sortieCount = 1;

    state.runwayStateE3 = 0x40;   // Na pista aguardando ignição
    state.statusE2 = 0x40;
    state.runwayTimerE4 = 0;
    state.screenFlashDE = 0;

    state.bulletTimerD4 = -1;
    state.bulletDistD5 = 0x9A;
    state.bulletXOffset = 0;

    state.flakClouds = [];
    state.enemies = [];
    state.particles = [];

    initAtmosphere();
    spawnInitialSquadrons();
    updateTopBarUI();
  }

  // Cria esquadrões inimigos no espaço 3D (seguindo a arquitetura de 9 slots da ROM $FC08-$FD3E)
  function spawnInitialSquadrons() {
    state.enemies = [];
    const maxSlots = 9;
    for (let i = 0; i < maxSlots; i++) {
      spawnEnemyInSlot(i, true);
    }
  }

  function spawnEnemyInSlot(slotIdx, initial = false) {
    // Na ROM ($FC25-$FC99), inimigos voam em diferentes altitudes ($9D) e posições horizontais ($89:$80)
    // A maior densidade de caças inimigos fica entre altitude interna 45 e 230 (10.000 a 35.000 pés)
    const offsetAngle = (Math.random() - 0.5) * 420;
    const wx = (state.worldX + offsetAngle + 1024) & 0x3FF;
    const wy = initial
      ? 35 + Math.random() * 200
      : Math.max(20, Math.min(245, state.altRawE5 + (Math.random() - 0.45) * 140));

    // Profundidade Z: na ROM, os tamanhos dos sprites variam de 0 (pontinho distante) até 5 (grande próximo)
    const zDist = initial ? (180 + Math.random() * 520) : (520 + Math.random() * 220);

    // Velocidade lateral e vertical ($92 na ROM)
    const vx = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * (expertMode ? 1.35 : 0.85));
    const vy = (Math.random() - 0.5) * (expertMode ? 0.55 : 0.35);
    const vz = -(1.4 + Math.random() * (expertMode ? 1.5 : 0.95)); // Aproxima-se do jogador

    state.enemies[slotIdx] = {
      active: true,
      wx,
      wy,
      z: zDist,
      vx,
      vy,
      vz,
      bankAngle: vx * 0.35,
      exploding: 0, // Contador de frames de explosão ($89 bits 3..4 na ROM)
      aggressionTimer: Math.floor(Math.random() * 90)
    };
  }

  // ============================================================================
  // FÍSICA E REGRAS EXATAS DO ATARI 2600 (60Hz Update)
  // ============================================================================
  function updateGamePhysics() {
    state.totalFrames++;
    // Ciclo de 8 frames da ROM ($F0B7: LDA $F1FF,Y -> 0..7)
    state.frameCounter = (state.frameCounter + 1) & 0x07;
    const isTick8 = (state.frameCounter === 0); // Equivalente a $E8 == 0 ou $D0 == 0 na ROM

    if (state.screenFlashDE > 0) {
      state.screenFlashDE--;
    }

    // 1. SE ESTIVER EM QUEDA / CRASH ($E2 entre $01 e $30 na ROM $F0D0 / $F253)
    if (state.statusE2 > 0 && state.statusE2 <= 0x30) {
      state.statusE2--;
      state.screenFlashDE = 4;
      // Na queda, avião mergulha descontrolado
      if (state.pitchDA < PITCH_MAX) state.pitchDA++;
      if (state.statusE2 <= 1) {
        triggerGameOver(state. gameOverReason || 'Sua aeronave colidiu durante a operação!');
      }
      sound.updateEngine(false, state.pitchDA, state.runwayStateE3, state.fuelDC, 1);
      return;
    }

    // 2. CONTROLE DE INCLINAÇÃO E MERGULHO/SUBIDA ($F15A - $F230)
    updateControlsAndAttitude(isTick8);

    // 3. MÁQUINA DE ESTADOS DE DECOLAGEM E POUSO ($F231 - $F2A2)
    updateRunwayAndLanding(isTick8);

    // 4. NAVEGAÇÃO HORIZONTAL, ALTITUDE E COMBUSTÍVEL ($F2A2 - $F34E)
    updateNavigationAndFuel(isTick8);

    // 5. SISTEMA DE DISPARO E COLISÃO DE PROJÉTEIS ($F34E - $F38F & $FADF - $FBC3)
    updateWeaponsAndHits();

    // 6. ARTILHARIA ANTIAÉREA - FLAK ($F538 - $F617)
    updateFlakSystem(isTick8);

    // 7. MOVIMENTAÇÃO DOS ESQUADRÕES INIMIGOS ($F981 - $FAA9)
    updateEnemies(isTick8);

    // 8. PARTÍCULAS E NUVENS ATMOSFÉRICAS
    updateEffects();

    // 9. ATUALIZAÇÃO DO SINTETIZADOR DE MOTOR ($F38F - $F3EA)
    sound.updateEngine(gameRunning, state.pitchDA, state.runwayStateE3, state.fuelDC, 0);

    // Alerta sonoro de combustível crítico
    if (state.fuelDC > 0 && state.fuelDC <= 5 && state.runwayStateE3 === 0) {
      state.lowFuelBeepTimer++;
      if (state.lowFuelBeepTimer >= 45) {
        state.lowFuelBeepTimer = 0;
        sound.playLowFuelBeep();
      }
    }

    updateTopBarUI();
  }

  // Controle de Roll ($D9) e Pitch ($DA) fiel à rotina $F15A
  function updateControlsAndAttitude(isTick8) {
    // Em turbulência severa de Flak ($E2 bit 6 == 0 e bit 7 == 1, ex: $80..$BF na ROM $F19A)
    const inFlakDive = (state.statusE2 >= 0x80 && state.statusE2 < 0xC0);

    if (inFlakDive) {
      // Flak força a aeronave a perder altitude / mergulhar ($F1B6)
      state.statusE2++;
      if (isTick8 && state.pitchDA < PITCH_MAX) {
        state.pitchDA = Math.min(PITCH_MAX, state.pitchDA + 2);
      }
      if (state.altRawE5 > 2) {
        state.altRawE5 = Math.max(0, state.altRawE5 - 0.65);
      }
    }

    // Controle de Roll (Inclinação Lateral $D9: -2 a +2)
    // Só pode inclinar se estiver voando ($E3 == 0)
    if (state.runwayStateE3 === 0) {
      if (isTick8) {
        if (keys.left) {
          state.rollD9 = Math.max(ROLL_MIN, state.rollD9 - 1);
        } else if (keys.right) {
          state.rollD9 = Math.min(ROLL_MAX, state.rollD9 + 1);
        } else {
          // Auto-centralização do Roll quando o manche é solto ($F18F: JSR $F223)
          if (state.rollD9 > 0) state.rollD9--;
          else if (state.rollD9 < 0) state.rollD9++;
        }
      }
    } else {
      state.rollD9 = 0;
    }

    // Controle de Pitch (Arfagem $DA: $01 Subida .. $16 Nivelado .. $2C Mergulho)
    // Na ROM ($F19E), se $DC (combustível) == 0, o jogador perde a capacidade de subir e o avião mergulha!
    if (state.fuelDC <= 0 && state.runwayStateE3 === 0) {
      if (isTick8) {
        state.pitchDA = Math.min(PITCH_MAX, state.pitchDA + 1);
      }
    } else if (!inFlakDive && isTick8) {
      // Enquanto parado na pista ($E3 == $40) ou acelerando antes de $58, pitch fica travado em $16
      const lockedOnRunway = (state.runwayStateE3 >= 0x40 && state.runwayStateE3 < 0x58);
      if (lockedOnRunway) {
        state.pitchDA = PITCH_CENTER;
      } else {
        if (keys.down) {
          // Pull back (S / Seta Baixo) -> Subir (diminui $DA até $01)
          state.pitchDA = Math.max(PITCH_MIN, state.pitchDA - 2);
        } else if (keys.up) {
          // Push forward (W / Seta Cima) -> Mergulhar (aumenta $DA até $2C)
          state.pitchDA = Math.min(PITCH_MAX, state.pitchDA + 2);
        } else {
          // Auto-nivelamento gradual em direção a $16 (22) quando solta o manche ($F1BD: JSR $F223)
          if (state.pitchDA < PITCH_CENTER) state.pitchDA++;
          else if (state.pitchDA > PITCH_CENTER) state.pitchDA--;
        }
      }
    }

    // Interpolação suave para renderização de 60fps mantendo a lógica exata por trás
    state.smoothPitch += (state.pitchDA - state.smoothPitch) * 0.25;
    state.smoothRoll += (state.rollD9 - state.smoothRoll) * 0.22;
  }

  // Máquina de estados de Decolagem e Pouso ($F231 - $F2A2)
  function updateRunwayAndLanding(isTick8) {
    // Caso 1: Parado na pista no início ou após pousar ($E2 == $40, $E3 == $40)
    if (state.runwayStateE3 === 0x40) {
      if (keys.fire) {
        // $F0E7: Pressionou botão de tiro na pista -> inicia rolagem de decolagem!
        state.statusE2 = 0xC0;
        state.runwayStateE3 = 0x41;
        state.runwayTimerE4 = 0x0A;
      }
      return;
    }

    if (!isTick8 || state.runwayStateE3 === 0) return;

    // Caso 2: Acelerando na pista para decolar ($E3 de $41 até $7F - linhas 298-308 da ROM)
    if (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80) {
      state.runwayStateE3++;

      if (state.runwayStateE3 < 0x58) {
        // Antes de atingir velocidade de rotação ($58), puxar ou empurrar demais o manche causa acidente!
        // Na ROM ($F246), o manche é mantido em $16 até $58.
        state.pitchDA = PITCH_CENTER;
      } else {
        // Atingiu velocidade de decolagem ($58..$7F): piloto deve puxar o manche (Climb: pitchDA < 22)
        if (state.runwayStateE3 >= 0x7F) {
          if (state.pitchDA < PITCH_CENTER) {
            // Decolagem concluída com sucesso! ($F26D: STA $E3 = 0)
            state.runwayStateE3 = 0x00;
            state.runwayTimerE4 = 0x00;
            state.altRawE5 = 6; // Sai do chão
          } else {
            // Fim da pista atingido sem puxar o manche -> Crash no fim da pista! ($F253)
            triggerCrash('Você ultrapassou o limite da pista sem puxar o manche (S / ↓) para decolar!');
          }
        } else if (state.pitchDA < PITCH_CENTER - 4 && state.runwayStateE3 >= 0x62) {
          // Levantou voo suavemente antes do limite final da pista
          state.runwayStateE3 = 0x00;
          state.runwayTimerE4 = 0x00;
          state.altRawE5 = 6;
        }
      }
      return;
    }

    // Caso 3: Sequência de Aproximação Final e Pouso ($E3 >= $C0 - linhas 325-351 da ROM)
    if (state.runwayStateE3 >= 0xC0) {
      state.runwayStateE3++;
      if (state.runwayStateE3 > 0xFF) {
        // Passou da pista sem tocar o solo -> Crash! ($F274: BEQ $F253)
        triggerCrash('Você perdeu a cabeceira da pista durante o procedimento de pouso!');
        return;
      }

      // Na ROM ($F278: CMP #$2C): quando o jogador empurra o manche todo para frente (mergulho $DA >= $28)
      // para alinhar o avião com a pista, o estado muda para $38 (preparado para toque no solo)
      if (state.pitchDA >= 0x26) {
        state.runwayStateE3 = 0x38;
      }
      return;
    }

    // Caso 4: Toque na pista e validação da Regra dos 10 Abates ($E3 == $01..$38 - linhas 332-351 da ROM)
    if (state.runwayStateE3 > 0 && state.runwayStateE3 <= 0x38) {
      state.runwayStateE3--;
      // Ao nivelar / soltar o manche após o alinhamento ou zerar o contador de toque:
      if (state.runwayStateE3 === 0 || state.pitchDA <= PITCH_CENTER + 2) {
        // $F285: Validação BCD dos abates conquistados nesta sortida ($DB - $E1 >= 10)
        const sortieKills = state.hitsDB - state.prevLandingHitsE1;
        if (sortieKills >= 10) {
          // POUSO AUTORIZADO E REABASTECIMENTO! ($F291 - $F29D)
          state.ammoDF = Math.min(99, sortieKills); // Nova munição = abates desta sortida!
          state.fuelDC = INITIAL_FUEL;              // Combustível cheio ($1B = 27)
          state.fuelSubDD = 0;
          state.prevLandingHitsE1 = state.hitsDB;   // Atualiza marco de abates ($E1 = $DB)
          state.runwayStateE3 = 0x40;               // Parado na pista pronto para nova decolagem
          state.statusE2 = 0x40;
          state.pitchDA = PITCH_CENTER;
          state.rollD9 = 0;
          state.sortieCount++;
          sound.playRefuelChime();
        } else {
          // Menos de 10 abates na sortida: fim de missão conforme regra oficial ($F28F)
          state.runwayStateE3 = 0x40;
          state.statusE2 = 0x41;
          triggerGameOver(
            `Pouso concluído, mas você obteve apenas ${sortieKills} abate(s) nesta sortida. ` +
            `A regra do Air Raiders exige no mínimo 10 abates por sortida para reabastecer e continuar!`
          );
        }
      }
    }
  }

  // Navegação Horizontal ($E7:$E6), Altitude ($E5 -> $D7) e Consumo de Combustível ($DC:$DD)
  function updateNavigationAndFuel(isTick8) {
    // 1. Movimento Horizontal ($F2A8 - $F2C4) quando em voo ($E3 == 0)
    if (state.runwayStateE3 === 0) {
      // Quanto maior a inclinação lateral ($D9), mais rápido o caça varre o horizonte (0..1023)
      state.worldX = (state.worldX + state.rollD9 * 1.15 + 1024) % 1024;

      // 2. Atualização da Altitude Interna $E5 ($F2D0 - $F2F5)
      // Na ROM: delta = (0x16 - pitchDA) >> 2.
      // Pitch < 22 (puxar manche) -> delta > 0 -> ganha altitude!
      // Pitch > 22 (empurrar manche) -> delta < 0 -> perde altitude!
      const pitchDelta = (PITCH_CENTER - state.pitchDA) / 4;
      if (pitchDelta < 0) {
        // Mergulhando
        if (state.altRawE5 > 0) {
          state.altRawE5 = Math.max(0, state.altRawE5 + pitchDelta * 0.22);
        } else if (state.pitchDA > PITCH_CENTER + 6) {
          // Mergulhou contra o solo em altitude 0 fora do procedimento de pouso ($F2E9: JMP $F253)
          triggerCrash('Impacto direto com o solo! Não mergulhe em Altitude 00 sem estar alinhado com a pista.');
          return;
        }
      } else if (pitchDelta > 0) {
        // Subindo
        state.altRawE5 = Math.min(255, state.altRawE5 + pitchDelta * 0.20);
      }

      // 3. Fórmula exata da ROM ($F2F6 - $F315) para converter $E5 (0..255) em Altímetro $D7 (00..40 milhares de pés)
      const e5Int = Math.floor(state.altRawE5);
      state.altDisplayD7 = Math.min(40, Math.floor(((e5Int >> 2) + 2 + e5Int) >> 3));

      // 4. Detecção de Pista de Pouso em Altitude 00 ($F317 - $F334)
      if (isTick8) {
        if (state.altDisplayD7 === 0) {
          // Em ALT 00: precisa voar nivelado (pitch próximo de $16) por ~10 ciclos para a pista aparecer
          if (Math.abs(state.pitchDA - PITCH_CENTER) <= 3) {
            if (state.runwayTimerE4 <= 0) state.runwayTimerE4 = 10;
            state.runwayTimerE4--;
            if (state.runwayTimerE4 <= 0) {
              // Pista avistada! ($F327: LDX #$C0 -> STX $E3)
              state.runwayStateE3 = 0xC0;
            }
          }
        } else {
          state.runwayTimerE4 = 10;
        }
      }
    } else {
      state.altRawE5 = 0;
      state.altDisplayD7 = 0;
    }

    // 5. Consumo de Combustível ($F335 - $F34E)
    // Na ROM, executa quando $E8 == 0 (a cada 8 frames):
    // Soma ((DA + $14) >> 3) ao acumulador $DD; porém o manual e a mecânica de voo destacam que
    // subir / voar em alta altitude dobra a taxa de consumo de combustível!
    if (isTick8 && state.runwayStateE3 === 0 && state.fuelDC > 0) {
      // Taxa base + penalidade de subida (quando pitchDA < 22) + penalidade de alta altitude
      const climbPenalty = state.pitchDA < PITCH_CENTER ? (PITCH_CENTER - state.pitchDA) * 0.45 : 0;
      const altPenalty = (state.altDisplayD7 / 40) * 3.5;
      const burnStep = Math.max(3, Math.floor(4.5 + climbPenalty + altPenalty));

      state.fuelSubDD += burnStep;
      if (state.fuelSubDD >= 256) {
        state.fuelSubDD -= 256;
        state.fuelDC = Math.max(0, state.fuelDC - 1);
      }
    }
  }

  // Disparo do Canhão Vulcan e Colisão com Caças Inimigos ($F34E - $F38F & $FADF - $FBC3)
  function updateWeaponsAndHits() {
    // Iniciar disparo se o botão de tiro estiver pressionado, em voo ($E3 == 0) e sem tiro ativo ($D4 < 0)
    if (state.bulletTimerD4 < 0) {
      if (state.runwayStateE3 === 0 && keys.fire && state.ammoDF > 0) {
        // $F368: SED / SBC #$01 / STA $DF (Desconta 1 projétil de munição)
        state.ammoDF = Math.max(0, state.ammoDF - 1);
        state.bulletTimerD4 = 0;
        state.bulletDistD5 = 0; // Vai de 0 (canhão) até 100 (mira central / horizonte)
        state.bulletXOffset = 0;
        sound.playCannon();
      }
    } else {
      // Avança projétil em direção à mira central ($FAE5 - $FB34)
      state.bulletTimerD4++;
      state.bulletDistD5 += 8.5;
      // O projétil sofre leve desvio lateral se o caça estiver inclinando ($FB10)
      state.bulletXOffset -= state.rollD9 * 1.8;

      // Checa colisão com inimigos quando o projétil cruza a zona de engajamento ($FB40 - $FBC3)
      if (state.bulletDistD5 >= 45) {
        for (let i = 0; i < state.enemies.length; i++) {
          const en = state.enemies[i];
          if (!en || !en.active || en.exploding > 0) continue;

          const proj = projectEnemyToScreen(en);
          if (!proj.visible) continue;

          // Posição atual do projétil na tela
          const bx = canvas.width * 0.5 + state.bulletXOffset;
          const by = getReticleY();

          const hitRadius = Math.max(26, 48 * proj.scale);
          const dx = proj.x - bx;
          const dy = proj.y - by;

          if (Math.hypot(dx, dy) <= hitRadius && en.z < 520 && en.z > 45) {
            // ABATE CONFIRMADO! ($FB6B: ORA #$18 -> STA $0089,Y / $FBBB: SED ADC #$01 STA $DB)
            en.exploding = 28;
            state.hitsDB = Math.min(99, state.hitsDB + 1);
            state.bulletTimerD4 = -1; // Consome o projétil
            sound.playEnemyExplosion();
            spawnExplosionParticles(proj.x, proj.y, proj.scale);
            break;
          }
        }
      }

      if (state.bulletDistD5 >= 100) {
        state.bulletTimerD4 = -1;
      }
    }
  }

  // Sistema de Flak - Artilharia Antiaérea ($F538 - $F617)
  function updateFlakSystem(isTick8) {
    // Atualiza nuvens de Flak ativas
    for (let i = state.flakClouds.length - 1; i >= 0; i--) {
      const fc = state.flakClouds[i];
      fc.life--;
      fc.radius += 0.4;
      if (fc.life <= 0) {
        state.flakClouds.splice(i, 1);
      }
    }

    // Flak só dispara quando o jogador está em voo ($E3 == 0)
    if (state.runwayStateE3 !== 0) return;

    // Na ROM ($FE47 - $FE57): a zona central vermelha do indicador corresponde a worldX entre 256 e 767
    const inRedFlakZone = (state.worldX >= 256 && state.worldX <= 768);
    // Além disso, conforme o manual: subir para grandes altitudes reduz o alcance do Flak!
    const altitudeSafety = state.altDisplayD7 / 40; // 0.0 (baixo) a 1.0 (40.000 pés)

    if (isTick8) {
      const flakChance = (inRedFlakZone ? 0.32 : 0.10) * (1.15 - altitudeSafety * 0.85) * (expertMode ? 1.4 : 1.0);
      if (Math.random() < flakChance && state.flakClouds.length < 6) {
        // Spawna explosão preta de Flak no para-brisa ($F55B: JSR $F618)
        const spreadX = (Math.random() - 0.5) * (inRedFlakZone ? 260 : 480);
        const spreadY = (Math.random() - 0.5) * 180;
        const cx = canvas.width * 0.5 + spreadX;
        const cy = getReticleY() + spreadY;

        // Verifica se explodiu muito perto da mira central ($F65D - $F6BE)
        const distToSight = Math.hypot(spreadX, spreadY);
        const closeHit = distToSight < (expertMode ? 95 : 72);

        state.flakClouds.push({
          x: cx,
          y: cy,
          radius: closeHit ? 34 : 22,
          maxLife: 45,
          life: 45,
          closeHit
        });

        sound.playFlakBurst(closeHit);

        if (closeHit) {
          // Explosão de Flak próxima à mira! ($F5B8: ASL -> STA $E2 / JSR $FFE5 -> STA $DE = $10)
          // Força o avião a um mergulho descontrolado temporário e pisca o para-brisa!
          state.screenFlashDE = 16;
          state.statusE2 = 0x98; // Entra em estado de mergulho forçado por Flak até subir para $C0
        }
      }
    }
  }

  // Movimentação e IA dos 9 slots de Caças Inimigos ($F981 - $FAA9)
  function updateEnemies(isTick8) {
    for (let i = 0; i < state.enemies.length; i++) {
      const en = state.enemies[i];
      if (!en || !en.active) continue;

      if (en.exploding > 0) {
        en.exploding--;
        if (en.exploding <= 0) {
          spawnEnemyInSlot(i, false);
        }
        continue;
      }

      // Inimigos se movem no espaço 3D
      en.wx = (en.wx + en.vx + 1024) % 1024;
      en.wy = Math.max(15, Math.min(250, en.wy + en.vy));
      en.z += en.vz;

      // Mudança ocasional de manobra ($F9DE: JSR $F517 LFSR)
      en.aggressionTimer--;
      if (en.aggressionTimer <= 0) {
        en.aggressionTimer = 50 + Math.floor(Math.random() * 80);
        en.vx = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * (expertMode ? 1.4 : 0.9));
        en.vy = (Math.random() - 0.5) * 0.5;
        en.bankAngle = en.vx * 0.35;
      }

      // No modo Experiente (ou quando muito próximo), caças inimigos podem disparar / forçar perda de altitude
      if (state.runwayStateE3 === 0 && en.z < 110 && en.z > 50 && isTick8) {
        const proj = projectEnemyToScreen(en);
        if (proj.visible && Math.hypot(proj.x - canvas.width * 0.5, proj.y - getReticleY()) < 65) {
          if (Math.random() < (expertMode ? 0.25 : 0.10)) {
            state.screenFlashDE = 10;
            state.statusE2 = 0xA8; // Empurra o jogador para baixo
            sound.playFlakBurst(true);
          }
        }
      }

      // Se passou por trás do caça do jogador, respawna à frente no horizonte
      if (en.z <= 25) {
        spawnEnemyInSlot(i, false);
      }
    }
  }

  function updateEffects() {
    // Partículas de explosão
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life--;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      }
    }

    // Movimento das nuvens atmosféricas quando voando ou correndo na pista
    const speedFactor = state.runwayStateE3 === 0
      ? 1.0
      : (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80 ? (state.runwayStateE3 - 0x40) / 63 : 0);

    for (const c of state.clouds) {
      c.z -= 0.0045 * speedFactor;
      if (c.z <= 0.05) {
        c.z = 1.0;
        c.wx = (state.worldX + (Math.random() - 0.5) * 360 + 1024) % 1024;
        c.wy = Math.max(10, Math.min(250, state.altRawE5 + (Math.random() - 0.5) * 120));
      }
    }
  }

  function spawnExplosionParticles(x, y, scale) {
    const count = Math.floor(28 * Math.max(0.6, scale));
    const colors = ['#ffae00', '#ff4800', '#ffffff', '#ff2a55', '#00f0ff'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (1 + Math.random() * 6) * Math.max(0.6, scale);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: (2 + Math.random() * 4) * Math.max(0.6, scale),
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 20 + Math.floor(Math.random() * 22),
        maxLife: 42
      });
    }
  }

  // Aciona sequência de queda da ROM ($F253: LDA #$30 -> STA $E2 -> STA $DE)
  function triggerCrash(reason) {
    state.statusE2 = 0x30;
    state.screenFlashDE = 0x30;
    state.gameOverReason = reason;
    sound.playEnemyExplosion();
  }

  function triggerGameOver(reason) {
    gameRunning = false;
    sound.updateEngine(false, state.pitchDA, state.runwayStateE3, 0, 1);

    const rank = getPilotRank(state.hitsDB);
    goTag.textContent = state.hitsDB >= 10 ? 'DEBRIEFING DE OPERAÇÃO AÉREA' : 'FALHA NA MISSÃO';
    goTitle.textContent = state.hitsDB >= 40 ? 'DESEMPENHO DE ÁS!' : 'FIM DE MISSÃO';
    goReason.textContent = reason;
    goHits.textContent = String(state.hitsDB).padStart(2, '0');
    goSorties.textContent = String(state.sortieCount);
    goRank.textContent = rank;

    overlayGameOver.classList.add('active');
  }

  // ============================================================================
  // GEOMETRIA E PROJEÇÃO 3D DO PARA-BRISA
  // ============================================================================
  const VIEW_TOP = 0;
  const VIEW_BOTTOM = 475; // Acima do painel do cockpit
  const VIEW_CENTER_Y = 235;

  function getReticleY() {
    return 225;
  }

  // Calcula a altura do horizonte no centro da tela baseado em $DA (1..44)
  // Na ROM ($F12D: SBC $DA -> $F7 e $F140: ADC $DA -> $D0):
  // Quando empurra o manche para frente (Dive: DA -> 44), o solo sobe e preenche o para-brisa!
  // Quando puxa o manche para trás (Climb: DA -> 1), o horizonte desce e o céu domina o para-brisa!
  function getHorizonCenterY() {
    if (state.runwayStateE3 === 0x40) {
      return VIEW_CENTER_Y + 25;
    }
    if (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80) {
      const lift = Math.max(0, (PITCH_CENTER - state.smoothPitch) * 6);
      return VIEW_CENTER_Y + 25 + lift;
    }
    // Em voo: pitchDA > 22 (mergulho) faz o horizonte subir (Y menor)
    const offset = (PITCH_CENTER - state.smoothPitch) * 9.5;
    return VIEW_CENTER_Y + offset;
  }

  // Projeta uma coordenada 3D de inimigo (wx, wy, z) na tela do para-brisa
  function projectEnemyToScreen(en) {
    // Diferença angular horizontal com wrap-around em 1024 ($FA22: SBC $E6 / SBC $E7)
    let dx = en.wx - state.worldX;
    if (dx > 512) dx -= 1024;
    if (dx < -512) dx += 1024;

    // Diferença de altitude ($FA57: LDA $E5 / SBC $9D,X) + compensação do Pitch ($FA71: ADC $DA)
    const dy = (en.wy - state.altRawE5) - (PITCH_CENTER - state.smoothPitch) * 2.4;

    const fov = 340;
    const scale = fov / Math.max(30, en.z);

    // Rotação pelo Roll do jogador
    const rollRad = -state.smoothRoll * 0.14;
    const rawX = dx * scale * 2.2;
    const rawY = -dy * scale * 2.0;

    const rotX = rawX * Math.cos(rollRad) - rawY * Math.sin(rollRad);
    const rotY = rawX * Math.sin(rollRad) + rawY * Math.cos(rollRad);

    const screenX = canvas.width * 0.5 + rotX;
    const screenY = VIEW_CENTER_Y + rotY;

    const visible = (
      en.z > 25 &&
      screenX > 60 &&
      screenX < canvas.width - 60 &&
      screenY > 20 &&
      screenY < VIEW_BOTTOM - 10
    );

    return { x: screenX, y: screenY, scale: Math.min(1.6, Math.max(0.18, scale)), visible };
  }

  // ============================================================================
  // RENDERIZAÇÃO GRÁFICA MODERNA (HTML5 CANVAS)
  // ============================================================================
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Renderiza Céu, Horizonte Inclinável (5 estados da ROM suavizados) e Terreno/Pista
    renderSkyAndGround();

    // 2. Renderiza Nuvens Atmosféricas
    renderAtmosphereClouds();

    // 3. Renderiza Esquadrões Inimigos 3D
    renderEnemies();

    // 4. Renderiza Artilharia Antiaérea (Flak) e Partículas
    renderFlakAndParticles();

    // 5. Renderiza Projéteis do Canhão Vulcan e Mira Tática HUD
    renderWeaponAndReticle();

    // 6. Renderiza Moldura do Cockpit e Painel de Instrumentos Fiel ao Atari 2600
    renderCockpitDashboard();

    // 7. Atualiza o Banner de Instrução Dinâmica
    updateDynamicBanner();
  }

  function renderSkyAndGround() {
    ctx.save();
    // Recorta para a janela do para-brisa
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, VIEW_BOTTOM);
    ctx.clip();

    const horizonY = getHorizonCenterY();
    const rollAngle = -state.smoothRoll * 0.14; // Inclinação fiel à tabela $F1F6 da ROM

    ctx.translate(canvas.width * 0.5, horizonY);
    ctx.rotate(rollAngle);

    // Gradiente do Céu (Mais escuro e estratosférico conforme sobe até 40.000 pés!)
    const altRatio = Math.min(1, state.altDisplayD7 / 40);
    const skyTopR = Math.round(12 - altRatio * 10);
    const skyTopG = Math.round(45 - altRatio * 35);
    const skyTopB = Math.round(125 - altRatio * 75);

    const skyGrad = ctx.createLinearGradient(0, -800, 0, 0);
    if (state.screenFlashDE > 0) {
      // Flash de impacto de Flak ou colisão ($F10A: $CE)
      skyGrad.addColorStop(0, '#ff2a55');
      skyGrad.addColorStop(1, '#ffae00');
    } else {
      skyGrad.addColorStop(0, `rgb(${skyTopR}, ${skyTopG}, ${skyTopB})`);
      skyGrad.addColorStop(0.65, `rgb(${skyTopR + 18}, ${skyTopG + 55}, ${skyTopB + 75})`);
      skyGrad.addColorStop(1, '#72c8ff');
    }

    ctx.fillStyle = skyGrad;
    ctx.fillRect(-canvas.width, -1200, canvas.width * 2, 1200);

    // Estrelas sutis em alta altitude (> 25.000 pés)
    if (altRatio > 0.5 && state.screenFlashDE === 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(altRatio - 0.5) * 1.4})`;
      for (let s = 0; s < 35; s++) {
        const sx = ((s * 197 + Math.floor(state.worldX * 2)) % 1600) - 800;
        const sy = -((s * 97) % 450) - 40;
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    // Gradiente do Terreno / Solo (Verde/Terra Tático inspirado no $D4 da ROM)
    const groundGrad = ctx.createLinearGradient(0, 0, 0, 900);
    groundGrad.addColorStop(0, '#193829');
    groundGrad.addColorStop(0.25, '#122b20');
    groundGrad.addColorStop(1, '#07140e');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(-canvas.width, 0, canvas.width * 2, 1200);

    // Malha de perspectiva no solo para sensação de velocidade e altitude
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.lineWidth = 1;
    const gridShift = (state.worldX * 6) % 80;
    for (let i = -14; i <= 14; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 45 - gridShift * 0.2, 0);
      ctx.lineTo(i * 220 - gridShift, 900);
      ctx.stroke();
    }

    // Linhas horizontais de distância no solo
    const zScroll = (state.totalFrames * (state.runwayStateE3 === 0 ? 4 : (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80 ? 6 : 0))) % 40;
    for (let d = 1; d <= 10; d++) {
      const yLine = Math.pow(d + zScroll / 40, 2.05) * 7.5;
      ctx.beginPath();
      ctx.moveTo(-1000, yLine);
      ctx.lineTo(1000, yLine);
      ctx.stroke();
    }

    // Linha brilhante do horizonte
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-canvas.width, 0);
    ctx.lineTo(canvas.width, 0);
    ctx.stroke();

    // RENDERIZAÇÃO DA PISTA DE DECOLAGEM / POUSO ($E3 != 0 na ROM $F136)
    if (state.runwayStateE3 !== 0) {
      renderRunwayPerspective();
    }

    ctx.restore();
  }

  function renderRunwayPerspective() {
    // Desenha a pista em perspectiva saindo do horizonte
    const topW = 26;
    const botW = 460;
    const h = 650;

    // Asfalto da pista
    const rGrad = ctx.createLinearGradient(0, 0, 0, h);
    rGrad.addColorStop(0, '#1e2636');
    rGrad.addColorStop(1, '#0e131d');
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.moveTo(-topW, 0);
    ctx.lineTo(topW, 0);
    ctx.lineTo(botW, h);
    ctx.lineTo(-botW, h);
    ctx.closePath();
    ctx.fill();

    // Bordas iluminadas da pista
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-topW, 0);
    ctx.lineTo(-botW, h);
    ctx.moveTo(topW, 0);
    ctx.lineTo(botW, h);
    ctx.stroke();

    // Faixas centrais tracejadas animadas conforme a aceleração na pista
    let speed = 0;
    if (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80) {
      speed = (state.runwayStateE3 - 0x40) * 0.45;
    } else if (state.runwayStateE3 >= 0xC0 || (state.runwayStateE3 > 0 && state.runwayStateE3 <= 0x38)) {
      speed = 12;
    }

    const dashOffset = (state.totalFrames * speed) % 60;
    ctx.fillStyle = '#ffae00';
    for (let i = 0; i < 8; i++) {
      const t1 = Math.max(0, (i * 60 + dashOffset) / 480);
      const t2 = Math.min(1, (i * 60 + 30 + dashOffset) / 480);
      if (t2 <= t1) continue;
      const y1 = Math.pow(t1, 1.8) * h;
      const y2 = Math.pow(t2, 1.8) * h;
      const w1 = 2 + t1 * 14;
      const w2 = 2 + t2 * 14;

      ctx.beginPath();
      ctx.moveTo(-w1, y1);
      ctx.lineTo(w1, y1);
      ctx.lineTo(w2, y2);
      ctx.lineTo(-w2, y2);
      ctx.closePath();
      ctx.fill();
    }
  }

  function renderAtmosphereClouds() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, VIEW_BOTTOM);
    ctx.clip();

    for (const c of state.clouds) {
      let dx = c.wx - state.worldX;
      if (dx > 512) dx -= 1024;
      if (dx < -512) dx += 1024;

      const dy = (c.wy - state.altRawE5) - (PITCH_CENTER - state.smoothPitch) * 2.0;
      const scale = 1 / Math.max(0.12, c.z);
      const sx = canvas.width * 0.5 + dx * scale * 2.2;
      const sy = VIEW_CENTER_Y - dy * scale * 1.6;

      if (sx < -150 || sx > canvas.width + 150 || sy < -80 || sy > VIEW_BOTTOM) continue;

      const rad = c.size * scale * 0.45;
      const grad = ctx.createRadialGradient(sx, sy, rad * 0.1, sx, sy, rad);
      grad.addColorStop(0, `rgba(210, 240, 255, ${c.alpha})`);
      grad.addColorStop(1, 'rgba(210, 240, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function renderEnemies() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, VIEW_BOTTOM);
    ctx.clip();

    // Ordena inimigos do mais distante para o mais próximo (Painter's Algorithm, como a lista ordenada da ROM $FC9B)
    const sorted = [...state.enemies].filter(e => e && e.active).sort((a, b) => b.z - a.z);

    for (const en of sorted) {
      const proj = projectEnemyToScreen(en);
      if (!proj.visible) continue;

      ctx.save();
      ctx.translate(proj.x, proj.y);
      const totalRot = en.bankAngle - state.smoothRoll * 0.14;
      ctx.rotate(totalRot);
      ctx.scale(proj.scale, proj.scale);

      if (en.exploding > 0) {
        // Sprite de explosão em expansão ($FAD8 na ROM)
        const r = (30 - en.exploding) * 2.2;
        const expGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
        expGrad.addColorStop(0, '#ffffff');
        expGrad.addColorStop(0.4, '#ffae00');
        expGrad.addColorStop(0.8, '#ff2a55');
        expGrad.addColorStop(1, 'rgba(255, 42, 85, 0)');
        ctx.fillStyle = expGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Silhueta Moderna do Caça Inimigo (inspirada nos sprites $FF2F-$FFD6 da ROM)
        // Asas enflechadas
        ctx.fillStyle = '#1b263b';
        ctx.strokeStyle = '#ff2a55';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(38, 6);
        ctx.lineTo(28, 12);
        ctx.lineTo(8, 6);
        ctx.lineTo(0, 16);
        ctx.lineTo(-8, 6);
        ctx.lineTo(-28, 12);
        ctx.lineTo(-38, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Estabilizadores verticais duplos
        ctx.beginPath();
        ctx.moveTo(-10, 2);
        ctx.lineTo(-14, -14);
        ctx.lineTo(-6, -4);
        ctx.moveTo(10, 2);
        ctx.lineTo(14, -14);
        ctx.lineTo(6, -4);
        ctx.stroke();

        // Canopy / Cockpit inimigo e brilho do pós-combustor
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.ellipse(0, -2, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffae00';
        ctx.beginPath();
        ctx.arc(0, 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.restore();
  }

  function renderFlakAndParticles() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, VIEW_BOTTOM);
    ctx.clip();

    // Nuvens negras de Flak ($F6D0-$F6FA na ROM: manchas pretas de artilharia antiaérea)
    for (const fc of state.flakClouds) {
      const alpha = Math.min(1, fc.life / 20);
      const grad = ctx.createRadialGradient(fc.x, fc.y, 4, fc.x, fc.y, fc.radius);
      if (fc.closeHit && fc.life > 32) {
        grad.addColorStop(0, `rgba(255, 160, 40, ${alpha})`);
        grad.addColorStop(0.35, `rgba(30, 15, 15, ${alpha * 0.95})`);
      } else {
        grad.addColorStop(0, `rgba(10, 12, 16, ${alpha * 0.95})`);
        grad.addColorStop(0.6, `rgba(22, 26, 34, ${alpha * 0.8})`);
      }
      grad.addColorStop(1, 'rgba(10, 12, 16, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, fc.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Partículas de explosão
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderWeaponAndReticle() {
    const cx = canvas.width * 0.5;
    const cy = getReticleY();

    // Traçantes duplos do Canhão Vulcan quando disparando ($D4 >= 0)
    if (state.bulletTimerD4 >= 0) {
      const t = state.bulletDistD5 / 100;
      const targetX = cx + state.bulletXOffset;
      const targetY = cy;

      const leftStartX = cx - 220;
      const rightStartX = cx + 220;
      const startY = VIEW_BOTTOM - 10;

      const curLX = leftStartX + (targetX - 8 - leftStartX) * t;
      const curRX = rightStartX + (targetX + 8 - rightStartX) * t;
      const curY = startY + (targetY - startY) * t;

      ctx.strokeStyle = '#ffae00';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffae00';
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.moveTo(curLX, curY);
      ctx.lineTo(leftStartX + (targetX - 8 - leftStartX) * Math.max(0, t - 0.18), startY + (targetY - startY) * Math.max(0, t - 0.18));
      ctx.moveTo(curRX, curY);
      ctx.lineTo(rightStartX + (targetX + 8 - rightStartX) * Math.max(0, t - 0.18), startY + (targetY - startY) * Math.max(0, t - 0.18));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Mira Tática Central (inspirada no sprite $F3F1 da ROM)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = state.screenFlashDE > 0 ? '#ff2a55' : 'rgba(0, 240, 255, 0.85)';
    ctx.lineWidth = 1.8;

    // Círculo externo segmentado
    ctx.beginPath();
    ctx.arc(0, 0, 26, -0.4, 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 26, Math.PI - 0.4, Math.PI + 0.4);
    ctx.stroke();

    // Cruz de pontaria
    ctx.beginPath();
    ctx.moveTo(-36, 0);
    ctx.lineTo(-12, 0);
    ctx.moveTo(12, 0);
    ctx.lineTo(36, 0);
    ctx.moveTo(0, -32);
    ctx.lineTo(0, -12);
    ctx.moveTo(0, 12);
    ctx.lineTo(0, 32);
    ctx.stroke();

    // Ponto central
    ctx.fillStyle = '#ffae00';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Escala de Pitch HUD nas laterais da mira
    ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
    ctx.font = '11px "Share Tech Mono", monospace';
    const pitchDeg = Math.round((PITCH_CENTER - state.smoothPitch) * 2.5);
    ctx.fillText(`PITCH ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}°`, 46, 4);
    ctx.restore();
  }

  // ============================================================================
  // PAINEL DE INSTRUMENTOS DO COCKPIT (Fiel ao layout $FD3F - $FEB9 da ROM)
  // ============================================================================
  function renderCockpitDashboard() {
    // 1. Montantes Metálicos do Canopy (Para-brisa do Caça)
    ctx.save();
    ctx.strokeStyle = '#1b283d';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(190, VIEW_BOTTOM);
    ctx.moveTo(canvas.width, 0);
    ctx.lineTo(canvas.width - 190, VIEW_BOTTOM);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(196, VIEW_BOTTOM);
    ctx.moveTo(canvas.width - 6, 0);
    ctx.lineTo(canvas.width - 196, VIEW_BOTTOM);
    ctx.stroke();

    // 2. Corpo Principal do Painel de Instrumentos (Y = 475 até 720)
    const dashGrad = ctx.createLinearGradient(0, VIEW_BOTTOM, 0, canvas.height);
    dashGrad.addColorStop(0, '#141e30');
    dashGrad.addColorStop(0.15, '#0b111e');
    dashGrad.addColorStop(1, '#05080f');

    ctx.fillStyle = dashGrad;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_BOTTOM + 22);
    ctx.lineTo(185, VIEW_BOTTOM);
    ctx.lineTo(canvas.width - 185, VIEW_BOTTOM);
    ctx.lineTo(canvas.width, VIEW_BOTTOM + 22);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fill();

    // Borda superior iluminada do painel
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_BOTTOM + 22);
    ctx.lineTo(185, VIEW_BOTTOM);
    ctx.lineTo(canvas.width - 185, VIEW_BOTTOM);
    ctx.lineTo(canvas.width, VIEW_BOTTOM + 22);
    ctx.stroke();

    const cx = canvas.width * 0.5;

    // ------------------------------------------------------------------------
    // A. DISPLAYS DIGITAIS TRIPLOS (Idênticos a $FD63 - $FDF0 da ROM):
    // Esquerda: ALT (00..40) | Centro: HITS (00..99) | Direita: AMMO (00..99)
    // ------------------------------------------------------------------------
    drawDigitalGauge(cx - 290, VIEW_BOTTOM + 24, 'ALTITUDE (x1000 FT)', String(state.altDisplayD7).padStart(2, '0'), '#00f0ff');
    drawDigitalGauge(cx, VIEW_BOTTOM + 24, 'ABATES (HITS)', String(state.hitsDB).padStart(2, '0'), '#00ff88');
    drawDigitalGauge(
      cx + 290,
      VIEW_BOTTOM + 24,
      'MUNIÇÃO (AMMO)',
      String(state.ammoDF).padStart(2, '0'),
      state.ammoDF <= 15 ? '#ff2a55' : '#ffae00'
    );

    // ------------------------------------------------------------------------
    // B. BARRA DE COMBUSTÍVEL (FUEL GAUGE - $FE11 a $FE3D da ROM)
    // Inicia cheia (azul/ciano) e muda de cor ao esvaziar ($DC de 27 até 0)
    // ------------------------------------------------------------------------
    const barW = 540;
    const barH = 22;
    const fuelX = cx - barW * 0.5;
    const fuelY = VIEW_BOTTOM + 122;

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 13px "Orbitron", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('FUEL RESERVE', fuelX, fuelY - 7);

    const sortieKills = state.hitsDB - state.prevLandingHitsE1;
    ctx.textAlign = 'right';
    ctx.fillStyle = sortieKills >= 10 ? '#00ff88' : '#ffae00';
    ctx.fillText(
      sortieKills >= 10
        ? `POUSO AUTORIZADO (${sortieKills}/10 ABATES NA SORTIDA)`
        : `META DE POUSO: ${sortieKills}/10 ABATES NA SORTIDA`,
      fuelX + barW,
      fuelY - 7
    );

    // Moldura da barra de combustível
    ctx.fillStyle = '#060a12';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(fuelX, fuelY, barW, barH);
    ctx.strokeRect(fuelX, fuelY, barW, barH);

    const fuelRatio = Math.max(0, Math.min(1, state.fuelDC / INITIAL_FUEL));
    const fillW = (barW - 6) * fuelRatio;
    if (fillW > 0) {
      const fGrad = ctx.createLinearGradient(fuelX, 0, fuelX + barW, 0);
      if (state.fuelDC <= 6) {
        fGrad.addColorStop(0, '#ff2a55');
        fGrad.addColorStop(1, '#ff7b00');
      } else {
        fGrad.addColorStop(0, '#ff2a85');
        fGrad.addColorStop(0.35, '#00a2ff');
        fGrad.addColorStop(1, '#00f0ff');
      }
      ctx.fillStyle = fGrad;
      ctx.fillRect(fuelX + 3, fuelY + 3, fillW, barH - 6);
    }

    // Divisórias dos 27 segmentos de combustível ($1B)
    ctx.strokeStyle = 'rgba(5, 8, 15, 0.75)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < INITIAL_FUEL; i++) {
      const sx = fuelX + (barW / INITIAL_FUEL) * i;
      ctx.beginPath();
      ctx.moveTo(sx, fuelY + 2);
      ctx.lineTo(sx, fuelY + barH - 2);
      ctx.stroke();
    }

    // ------------------------------------------------------------------------
    // C. INDICADOR DE POSIÇÃO HORIZONTAL & ZONA VERMELHA DE FLAK ($FE47 - $FE9E)
    // Barra inferior com zona central vermelha (Flak pesado) e ponto da aeronave
    // ------------------------------------------------------------------------
    const posY = VIEW_BOTTOM + 178;
    const posH = 24;

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 13px "Orbitron", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR HORIZONTAL // ZONA VERMELHA = ARTILHARIA ANTIAÉREA (FLAK)', fuelX, posY - 7);

    // Fundo da barra de posição
    ctx.fillStyle = '#060a12';
    ctx.fillRect(fuelX, posY, barW, posH);

    // Zona Vermelha Central de Flak (25% a 75% do espaço aéreo, como na ROM $FE8F: COLUBK = $34)
    const flakZoneX = fuelX + barW * 0.25;
    const flakZoneW = barW * 0.50;
    const redGrad = ctx.createLinearGradient(flakZoneX, 0, flakZoneX + flakZoneW, 0);
    redGrad.addColorStop(0, 'rgba(255, 42, 85, 0.25)');
    redGrad.addColorStop(0.5, 'rgba(255, 42, 85, 0.65)');
    redGrad.addColorStop(1, 'rgba(255, 42, 85, 0.25)');
    ctx.fillStyle = redGrad;
    ctx.fillRect(flakZoneX, posY + 2, flakZoneW, posH - 4);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.strokeRect(fuelX, posY, barW, posH);

    // Marcadores de inimigos ativos no radar horizontal
    for (const en of state.enemies) {
      if (!en || !en.active || en.exploding > 0) continue;
      const ex = fuelX + (en.wx / 1024) * barW;
      ctx.fillStyle = 'rgba(255, 174, 0, 0.75)';
      ctx.fillRect(ex - 1.5, posY + 4, 3, 5);
    }

    // Ponto branco/ciano indicando a posição atual do jogador ($E7:$E6)
    const dotX = fuelX + (state.worldX / 1024) * barW;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(dotX, posY + posH * 0.5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ------------------------------------------------------------------------
    // D. HORIZONTE ARTIFICIAL (ADI) & INDICADOR DE VELOCIDADE/STATUS NAS LATERAIS
    // ------------------------------------------------------------------------
    drawArtificialHorizon(115, VIEW_BOTTOM + 125, 76);
    drawTacticalStatusBox(canvas.width - 115, VIEW_BOTTOM + 125, 76);

    // ------------------------------------------------------------------------
    // E. PLACA DE FABRICANTE / CRÉDITOS GRAVADA NO CHASSI DO COCKPIT
    // ------------------------------------------------------------------------
    ctx.fillStyle = 'rgba(143, 168, 200, 0.55)';
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      'ORIG. 1982 M NETWORK / LARRY ZWICK (ATARI 2600)  //  REMASTERED EDITION BY GITHUB.COM/REALZURR',
      cx,
      canvas.height - 8
    );

    ctx.restore();
  }

  function drawDigitalGauge(centerX, topY, label, valueStr, color) {
    const w = 220;
    const h = 72;
    const x = centerX - w * 0.5;

    ctx.fillStyle = '#050912';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(x, topY, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 11px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, centerX, topY + 18);

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.font = '900 36px "Orbitron", monospace';
    ctx.fillText(valueStr, centerX, topY + 58);
    ctx.shadowBlur = 0;
  }

  function drawArtificialHorizon(cx, cy, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#060a14';
    ctx.fill();
    ctx.clip();

    const pitchShift = (PITCH_CENTER - state.smoothPitch) * 2.2;
    const rollRad = -state.smoothRoll * 0.14;

    ctx.translate(cx, cy + pitchShift);
    ctx.rotate(rollRad);

    ctx.fillStyle = '#0e4d8a';
    ctx.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 2);
    ctx.fillStyle = '#2d4c2b';
    ctx.fillRect(-radius * 2, 0, radius * 4, radius * 2);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius * 2, 0);
    ctx.lineTo(radius * 2, 0);
    ctx.stroke();
    ctx.restore();

    // Moldura do ADI
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Asinha fixa de referência
    ctx.strokeStyle = '#ffae00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 28, cy);
    ctx.stroke();

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 11px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GIROSCÓPIO ADI', cx, cy + radius + 18);
  }

  function drawTacticalStatusBox(cx, cy, radius) {
    ctx.save();
    ctx.fillStyle = '#060a14';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const sortieKills = state.hitsDB - state.prevLandingHitsE1;
    ctx.textAlign = 'center';

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 10px "Orbitron", sans-serif';
    ctx.fillText('SORTIDA ATUAL', cx, cy - 28);

    ctx.fillStyle = sortieKills >= 10 ? '#00ff88' : '#ffae00';
    ctx.font = '900 26px "Orbitron", sans-serif';
    ctx.fillText(`${sortieKills}/10`, cx, cy + 4);

    ctx.fillStyle = '#c9dfff';
    ctx.font = '12px "Share Tech Mono", monospace';
    const burnRate = (state.runwayStateE3 === 0 && state.pitchDA < PITCH_CENTER) ? 'CONSUMO 2X' : 'CONSUMO 1X';
    ctx.fillText(burnRate, cx, cy + 28);

    ctx.fillStyle = '#8fa8c8';
    ctx.font = 'bold 11px "Orbitron", sans-serif';
    ctx.fillText('COMPUTADOR DE VOO', cx, cy + radius + 18);
    ctx.restore();
  }

  // Atualiza avisos táticos para guiar o jogador nas regras de Decolagem e Pouso
  function updateDynamicBanner() {
    const sortieKills = state.hitsDB - state.prevLandingHitsE1;

    if (state.runwayStateE3 === 0x40) {
      hudBanner.className = 'hud-banner';
      hudBanner.innerHTML = 'PISTA DE DECOLAGEM: PRESSIONE <strong>[ESPAÇO]</strong> OU <strong>[CLIQUE]</strong> PARA ACELERAR A TURBINA';
      return;
    }

    if (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x58) {
      const pct = Math.min(100, Math.round(((state.runwayStateE3 - 0x40) / (0x58 - 0x40)) * 100));
      hudBanner.className = 'hud-banner';
      hudBanner.innerHTML = `ACELERANDO NA PISTA (${pct}%) — MANTENHA O MANCHE NIVELADO!`;
      return;
    }

    if (state.runwayStateE3 >= 0x58 && state.runwayStateE3 < 0x80) {
      hudBanner.className = 'hud-banner success';
      hudBanner.innerHTML = 'VELOCIDADE DE ROTAÇÃO ATINGIDA! PUXE O MANCHE (<strong>[S]</strong> OU <strong>[SETA BAIXO ↓]</strong>) PARA DECOLAR!';
      return;
    }

    if (state.runwayStateE3 >= 0xC0) {
      hudBanner.className = 'hud-banner success';
      hudBanner.innerHTML = 'PISTA À VISTA! EMPURRE O MANCHE (<strong>[W]</strong> OU <strong>[SETA CIMA ↑]</strong>) PARA MERGULHAR E TOCAR O SOLO!';
      return;
    }

    if (state.runwayStateE3 > 0 && state.runwayStateE3 <= 0x38) {
      hudBanner.className = 'hud-banner success';
      hudBanner.innerHTML = 'ALINHADO COM A PISTA! SOLTE O MANCHE PARA CONCLUIR O POUSO E REABASTECER!';
      return;
    }

    // Em voo ($E3 == 0)
    if (state.fuelDC <= 0) {
      hudBanner.className = 'hud-banner warning';
      hudBanner.innerHTML = 'COMBUSTÍVEL ESGOTADO! PERDA TOTAL DE EMPUXO!';
    } else if (state.statusE2 >= 0x80 && state.statusE2 < 0xC0) {
      hudBanner.className = 'hud-banner warning';
      hudBanner.innerHTML = 'IMPACTO DE FLAK ANTIAÉREO! SUBA (<strong>[S]</strong> / <strong>[↓]</strong>) OU SAIA DA ZONA VERMELHA!';
    } else if (state.fuelDC <= 7) {
      if (sortieKills >= 10) {
        hudBanner.className = 'hud-banner warning';
        hudBanner.innerHTML = 'COMBUSTÍVEL BAIXO! DESÇA PARA <strong>ALT 00</strong> E VOE NIVELADO PARA POUSAR E REABASTECER!';
      } else {
        hudBanner.className = 'hud-banner warning';
        hudBanner.innerHTML = `COMBUSTÍVEL BAIXO! VOCÊ PRECISA DE MAIS <strong>${10 - sortieKills} ABATE(S)</strong> ANTES DE POUSAR!`;
      }
    } else if (state.altDisplayD7 === 0) {
      hudBanner.className = 'hud-banner';
      hudBanner.innerHTML = sortieKills >= 10
        ? `ALTITUDE 00: MANTENHA VOO NIVELADO PARA AVISTAR A PISTA DE POUSO (${Math.max(1, state.runwayTimerE4)})`
        : `ALTITUDE 00: CUIDADO COM O SOLO! ABATA ${10 - sortieKills} INIMIGO(S) PARA LIBERAR O POUSO`;
    } else if (sortieKills >= 10) {
      hudBanner.className = 'hud-banner success';
      hudBanner.innerHTML = `META DE 10 ABATES CUMPRIDA (${sortieKills} ABATES)! CONTINUE CAÇANDO OU DESÇA ATÉ <strong>ALT 00</strong> PARA REABASTECER`;
    } else {
      hudBanner.className = 'hud-banner';
      hudBanner.innerHTML = `EM COMBATE AÉREO — ABATA PELO MENOS <strong>10 CAÇAS</strong> NESTA SORTIDA PARA LIBERAR O POUSO (${sortieKills}/10)`;
    }
  }

  function updateTopBarUI() {
    const sortieKills = state.hitsDB - state.prevLandingHitsE1;
    if (state.runwayStateE3 === 0x40) {
      uiPhase.textContent = 'PISTA DE DECOLAGEM';
    } else if (state.runwayStateE3 > 0x40 && state.runwayStateE3 < 0x80) {
      uiPhase.textContent = 'CORRIDA DE DECOLAGEM';
    } else if (state.runwayStateE3 >= 0xC0 || (state.runwayStateE3 > 0 && state.runwayStateE3 <= 0x38)) {
      uiPhase.textContent = 'APROXIMAÇÃO DE POUSO';
    } else {
      uiPhase.textContent = 'COMBATE EM VOO';
    }

    uiSortie.textContent = `#${state.sortieCount} (${sortieKills} ABATES)`;
    uiRank.textContent = getPilotRank(state.hitsDB).split(' ')[0];
  }

  // ============================================================================
  // CONTROLES DE TECLADO, MOUSE E BOTÕES DA INTERFACE
  // ============================================================================
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'Space' || e.code === 'KeyK' || e.code === 'Enter') keys.fire = true;
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'Space' || e.code === 'KeyK' || e.code === 'Enter') keys.fire = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      sound.init();
      keys.fire = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      keys.fire = false;
    }
  });

  btnStartGame.addEventListener('click', () => {
    sound.init();
    overlayStart.classList.remove('active');
    resetGame();
    gameRunning = true;
  });

  btnRestartGame.addEventListener('click', () => {
    sound.init();
    overlayGameOver.classList.remove('active');
    resetGame();
    gameRunning = true;
  });

  btnReset.addEventListener('click', () => {
    sound.init();
    overlayStart.classList.remove('active');
    overlayGameOver.classList.remove('active');
    overlayManual.classList.remove('active');
    resetGame();
    gameRunning = true;
  });

  btnRules.addEventListener('click', () => {
    overlayManual.classList.add('active');
  });

  btnCloseManual.addEventListener('click', () => {
    overlayManual.classList.remove('active');
  });

  btnDifficulty.addEventListener('click', () => {
    expertMode = !expertMode;
    lblDiff.textContent = expertMode ? 'EXPERIENTE (A)' : 'NOVATO (B)';
  });

  btnAudio.addEventListener('click', () => {
    sound.init();
    sound.enabled = !sound.enabled;
    lblAudio.textContent = sound.enabled ? 'ON' : 'OFF';
  });

  // ============================================================================
  // LOOP PRINCIPAL (60 FPS Sincronizado com o frame rate NTSC do Atari 2600)
  // ============================================================================
  let lastTime = performance.now();
  const STEP_MS = 1000 / 60;
  let accumulator = 0;

  function mainLoop(now) {
    const delta = Math.min(100, now - lastTime);
    lastTime = now;
    accumulator += delta;

    while (accumulator >= STEP_MS) {
      if (gameRunning && !overlayManual.classList.contains('active')) {
        updateGamePhysics();
      }
      accumulator -= STEP_MS;
    }

    render();
    requestAnimationFrame(mainLoop);
  }

  // Inicialização
  resetGame();
  requestAnimationFrame(mainLoop);
})();
