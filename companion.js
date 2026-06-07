// ==========================================================================
// COMPANION STATE & DEFAULT SETTINGS
// ==========================================================================

const DEFAULT_SETTINGS = {
    dogName: "Jayanti Lal",
    partnerName: "ogreess",
    waterInterval: 60, // minutes
    lunchTime: "13:00", // 24-hr format
    breakTime: "17:00", // 24-hr format
    msgWater: "drink water right now Mr. oger ! I want you healthy. 💧",
    msgLunch: "Hey honey! It is 1:00 PM. Please leave your desk and go eat some warm lunch! 🍲",
    msgBreak: "Work is almost done! Stand up, stretch, and go for tea and spill me all the tea ❤️",
    randomNotes: [
        "I believe in you! Keep going!",

        "Take a deep breath. Inhale... exhale.",
        "My heart is with you, even if we are far.",
        "Give yourself a 2-minute eye rest."
    ],
    audioEnabled: true,
    notificationsEnabled: false
};

const DEFAULT_STATE = {
    hunger: 100,
    hydration: 100,
    energy: 100,
    mood: 100,
    isSleeping: false,
    lastWaterReset: Date.now(),
    lastLunchDate: "", // String tracker: "Sun Jun 07 2026"
    lastBreakDate: "", // String tracker
    dogState: "idle" // "idle", "excited", "sleeping", "eating"
};

let settings = { ...DEFAULT_SETTINGS };
let state = { ...DEFAULT_STATE };
let statDecayInterval = null;
let mainSchedulerInterval = null;
let particleTimeout = null;

// ==========================================================================
// AUDIO SYNTHESIZER (WEB AUDIO API)
// ==========================================================================

/**
 * Synthesizes a realistic double bark: "Woof woof!"
 */
function playBarkSound() {
    if (!settings.audioEnabled || state.isSleeping) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        const singleBark = (time, pitch, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            // Triangle wave gives a warm hollow tone like a bark
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(pitch, time);
            // Quick frequency sweep downward
            osc.frequency.exponentialRampToValueAtTime(pitch * 0.4, time + duration);

            gain.gain.setValueAtTime(0.25, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, time);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + duration);
        };

        // Two quick barks
        singleBark(ctx.currentTime, 220, 0.15);
        singleBark(ctx.currentTime + 0.18, 200, 0.18);
    } catch (e) {
        console.error("Failed to play bark audio:", e);
    }
}

/**
 * Synthesizes a happy chime arpeggio: C5 -> E5 -> G5 -> C6
 */
function playChimeSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50];

        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);

            gain.gain.setValueAtTime(0.12, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.25);
        });
    } catch (e) {
        console.error("Failed to play chime audio:", e);
    }
}

/**
 * Synthesizes chewing crunch sounds
 */
function playChewSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

        // Create 5 rapid crunch noises
        for (let i = 0; i < 5; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const time = now + i * 0.18;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(120, time);
            osc.frequency.exponentialRampToValueAtTime(20, time + 0.08);

            gain.gain.setValueAtTime(0.08, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 0.08);
        }
    } catch (e) {
        console.error("Failed to play chew audio:", e);
    }
}

/**
 * Synthesizes liquid slurping waves
 */
function playSlurpSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

        // Create 6 overlapping liquid frequency sweeps
        for (let i = 0; i < 6; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const time = now + i * 0.22;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(350, time);
            osc.frequency.exponentialRampToValueAtTime(700, time + 0.12);

            gain.gain.setValueAtTime(0.06, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 0.12);
        }
    } catch (e) {
        console.error("Failed to play slurp audio:", e);
    }
}

// ==========================================================================
// SYSTEM NOTIFICATIONS
// ==========================================================================

function requestNotificationPermission() {
    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            const checkbox = document.getElementById('toggle-notifications');
            if (checkbox) {
                checkbox.checked = (permission === "granted");
                settings.notificationsEnabled = (permission === "granted");
                saveSettingsToStorage();
            }
        });
    }
}

function sendSystemNotification(title, message) {
    if (settings.notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, {
                body: message,
                icon: 'icon.svg'
            });
        } catch (e) {
            console.error("Notification trigger failed:", e);
        }
    }
}

// ==========================================================================
// STATE PERSISTENCE (LOCAL STORAGE)
// ==========================================================================

function loadData() {
    // Load settings
    const storedSettings = localStorage.getItem('dog_companion_settings');
    if (storedSettings) {
        try {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
            // Auto-migrate old default names to the new default
            if (settings.dogName === "Milo" || settings.dogName === "Bucky") {
                settings.dogName = DEFAULT_SETTINGS.dogName;
                saveSettingsToStorage();
            }
        } catch (e) {
            settings = { ...DEFAULT_SETTINGS };
        }
    }

    // Load state
    const storedState = localStorage.getItem('dog_companion_state');
    if (storedState) {
        try {
            state = { ...DEFAULT_STATE, ...JSON.parse(storedState) };
            // Ensure dates are parsed correctly
            state.lastWaterReset = Number(state.lastWaterReset) || Date.now();
        } catch (e) {
            state = { ...DEFAULT_STATE };
        }
    }

    // Populate form fields with saved settings
    document.getElementById('input-dog-name').value = settings.dogName;
    document.getElementById('input-partner-name').value = settings.partnerName;
    document.getElementById('input-water-interval').value = settings.waterInterval;
    document.getElementById('input-lunch-time').value = settings.lunchTime;
    document.getElementById('input-break-time').value = settings.breakTime;

    document.getElementById('msg-water').value = settings.msgWater;
    document.getElementById('msg-lunch').value = settings.msgLunch;
    document.getElementById('msg-break').value = settings.msgBreak;

    document.getElementById('random-notes').value = settings.randomNotes.join('\n');
    document.getElementById('toggle-audio').checked = settings.audioEnabled;

    // Verify notification permission in browser
    if ("Notification" in window) {
        const checkbox = document.getElementById('toggle-notifications');
        if (Notification.permission === "granted") {
            checkbox.checked = true;
            settings.notificationsEnabled = true;
        } else {
            checkbox.checked = false;
            settings.notificationsEnabled = false;
        }
    }

    updateDogNameDisplays();
    updateSleepingUIVisuals();
}

function saveSettingsToStorage() {
    localStorage.setItem('dog_companion_settings', JSON.stringify(settings));
}

function saveStateToStorage() {
    localStorage.setItem('dog_companion_state', JSON.stringify(state));
}

// ==========================================================================
// DYNAMIC DOM ACTIONS & ANIMATION TOGGLES
// ==========================================================================

function updateDogNameDisplays() {
    const displays = document.querySelectorAll('.dog-name-display');
    displays.forEach(el => el.textContent = settings.dogName);
}

function setDogState(newState) {
    state.dogState = newState;
    const dogEl = document.getElementById('whole-dog');
    if (!dogEl) return;

    // Remove all state classes
    dogEl.classList.remove('dog-idle', 'excited-alert', 'dog-sleeping', 'dog-eating');

    // Toggle closed eyes display
    const pupils = dogEl.querySelectorAll('.pupil, .pupil-shine');
    const closedEyes = dogEl.querySelectorAll('.sleeping-eye');

    if (newState === 'sleeping') {
        dogEl.classList.add('dog-sleeping');
        pupils.forEach(p => p.style.display = 'none');
        closedEyes.forEach(e => e.style.display = 'block');
    } else {
        pupils.forEach(p => p.style.display = 'block');
        closedEyes.forEach(e => e.style.display = 'none');

        if (newState === 'excited') {
            dogEl.classList.add('excited-alert');
        } else if (newState === 'eating') {
            dogEl.classList.add('dog-eating');
        } else {
            dogEl.classList.add('dog-idle');
        }
    }
    saveStateToStorage();
}

/**
 * Spawns floating particles above the dog
 */
function spawnParticle(typeChar, className) {
    const container = document.getElementById('particles-container');
    if (!container) return;

    const particle = document.createElement('div');
    particle.className = `particle ${className}`;
    particle.textContent = typeChar;

    // Random position around dog area
    const randomX = 80 + Math.random() * 60; // relative px
    particle.style.left = `${randomX}px`;
    particle.style.bottom = `120px`;

    container.appendChild(particle);

    // Auto cleanup after anim ends
    setTimeout(() => {
        particle.remove();
    }, 2500);
}

// ==========================================================================
// SCHEDULER & COMPANION RULES ENGINE
// ==========================================================================

function startMetricsDecay() {
    if (statDecayInterval) clearInterval(statDecayInterval);

    // Update every 10 seconds for realistic feedback
    statDecayInterval = setInterval(() => {
        if (state.isSleeping) {
            // Regain energy when sleeping
            state.energy = Math.min(100, state.energy + 1.5);
            state.hunger = Math.max(0, state.hunger - 0.1);
            state.hydration = Math.max(0, state.hydration - 0.2);
            spawnParticle('Z', 'zzz-particle');
        } else {
            // Normal decay
            state.hunger = Math.max(0, state.hunger - 0.15);
            state.hydration = Math.max(0, state.hydration - 0.25);
            state.energy = Math.max(0, state.energy - 0.1);
        }

        // Calculate mood based on other metrics
        state.mood = Math.round((state.hunger + state.hydration + state.energy) / 3);

        updateStatsUI();
        saveStateToStorage();
    }, 10000);
}

function updateStatsUI() {
    document.getElementById('val-hunger').textContent = `${Math.round(state.hunger)}%`;
    document.getElementById('val-hydration').textContent = `${Math.round(state.hydration)}%`;
    document.getElementById('val-energy').textContent = `${Math.round(state.energy)}%`;

    document.getElementById('bar-hunger').style.width = `${state.hunger}%`;
    document.getElementById('bar-hydration').style.width = `${state.hydration}%`;
    document.getElementById('bar-energy').style.width = `${state.energy}%`;
}

function triggerAlert(alertType, customMessage) {
    if (state.isSleeping) return; // Silent if dog is sleeping

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('excited');
    playBarkSound();

    // Format full bubble message
    const formattedMsg = `${settings.partnerName} says: "${customMessage}"`;

    // Update Speech bubble
    document.getElementById('speech-sender').textContent = settings.dogName;
    document.getElementById('speech-text').textContent = formattedMsg;

    // Send system alert
    let title = `${settings.dogName} is jumping! 🐾`;
    if (alertType === 'water') title = `💧 Time for water! (${settings.dogName})`;
    if (alertType === 'lunch') title = `🍲 Lunch time! (${settings.dogName})`;
    if (alertType === 'break') title = `🌇 Stretch break! (${settings.dogName})`;

    sendSystemNotification(title, formattedMsg);

    // Revert back to idle after 15 seconds if not interacted
    setTimeout(() => {
        if (state.dogState === 'excited') {
            setDogState('idle');
            document.getElementById('speech-text').textContent = "I'm resting on the rug now. Take care of yourself!";
        }
        document.getElementById('appContainer').classList.remove('show-bubble-active');
    }, 15000);
}

function checkSchedules() {
    const now = new Date();
    const nowMs = Date.now();
    const todayStr = now.toDateString();

    // 1. Water Reminder Check (Interval based)
    const waterTimeoutMs = settings.waterInterval * 60 * 1000;
    if (nowMs - state.lastWaterReset >= waterTimeoutMs) {
        state.lastWaterReset = nowMs;
        triggerAlert('water', settings.msgWater);
        saveStateToStorage();
    }

    // 2. Lunch Check (Absolute time 1:00 PM)
    const [lunchH, lunchM] = settings.lunchTime.split(':').map(Number);
    if (now.getHours() === lunchH && now.getMinutes() === lunchM) {
        if (state.lastLunchDate !== todayStr) {
            state.lastLunchDate = todayStr;
            triggerAlert('lunch', settings.msgLunch);
            saveStateToStorage();
        }
    }

    // 3. Break Check (Absolute time 5:00 PM)
    const [breakH, breakM] = settings.breakTime.split(':').map(Number);
    if (now.getHours() === breakH && now.getMinutes() === breakM) {
        if (state.lastBreakDate !== todayStr) {
            state.lastBreakDate = todayStr;
            triggerAlert('break', settings.msgBreak);
            saveStateToStorage();
        }
    }

    updateNextAlertsIndicator();
}

function updateNextAlertsIndicator() {
    const indicator = document.getElementById('next-alert-indicator');
    if (!indicator) return;

    const nowMs = Date.now();
    const nextWaterTime = state.lastWaterReset + settings.waterInterval * 60 * 1000;
    const waterMinLeft = Math.max(0, Math.ceil((nextWaterTime - nowMs) / 60000));

    indicator.textContent = `Water: in ${waterMinLeft}m | Lunch: ${settings.lunchTime} | Break: ${settings.breakTime}`;
}

function startScheduler() {
    if (mainSchedulerInterval) clearInterval(mainSchedulerInterval);

    // Run checks every 10 seconds
    checkSchedules();
    mainSchedulerInterval = setInterval(checkSchedules, 10000);
}

// ==========================================================================
// INTERACTIVE DOG ACTIONS (FEED, WATER, PET, SLEEP)
// ==========================================================================

function feedDog() {
    if (state.isSleeping) {
        wakeDogUp();
    }

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('eating');
    playChewSound();

    // Show food bowl
    const bowl = document.getElementById('food-bowl');
    bowl.classList.add('bowl-active');

    // Spawn chewing particles
    let chewsCount = 0;
    const chewInterval = setInterval(() => {
        spawnParticle('🍖', 'heart-particle');
        chewsCount++;
        if (chewsCount >= 4) clearInterval(chewInterval);
    }, 500);

    // Update hunger stats
    state.hunger = Math.min(100, state.hunger + 30);
    updateStatsUI();

    document.getElementById('speech-text').textContent = `Munch munch... Thank you for the yummy food! 🍖`;

    setTimeout(() => {
        bowl.classList.remove('bowl-active');
        setDogState('idle');
        document.getElementById('appContainer').classList.remove('show-bubble-active');
        saveStateToStorage();
    }, 3000);
}

function giveWaterDog() {
    if (state.isSleeping) {
        wakeDogUp();
    }

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('eating'); // uses chewing motions
    playSlurpSound();

    // Show water bowl
    const bowl = document.getElementById('water-bowl');
    bowl.classList.add('bowl-active');

    // Spawn droplets particles
    let gulps = 0;
    const slurpInterval = setInterval(() => {
        spawnParticle('💧', 'water-particle');
        gulps++;
        if (gulps >= 4) clearInterval(slurpInterval);
    }, 450);

    // Hydration resets water timer!
    state.hydration = Math.min(100, state.hydration + 35);
    state.lastWaterReset = Date.now();
    updateStatsUI();
    updateNextAlertsIndicator();

    document.getElementById('speech-text').textContent = `Slurp slurp... So refreshing! Remember to drink your water too! 💧`;

    setTimeout(() => {
        bowl.classList.remove('bowl-active');
        setDogState('idle');
        document.getElementById('appContainer').classList.remove('show-bubble-active');
        saveStateToStorage();
    }, 3000);
}

function petDog() {
    if (state.isSleeping) {
        wakeDogUp();
    }

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('excited');
    playChimeSound();

    // Spawn hearts
    for (let i = 0; i < 3; i++) {
        setTimeout(() => {
            spawnParticle('❤️', 'heart-particle');
        }, i * 200);
    }

    // Add extra stats
    state.energy = Math.min(100, state.energy + 5);
    updateStatsUI();

    // Pick a random love note whisper!
    let note = "Pant pant! I love you! ❤️";
    if (settings.randomNotes.length > 0) {
        const randIdx = Math.floor(Math.random() * settings.randomNotes.length);
        note = `${settings.partnerName} says: "${settings.randomNotes[randIdx]}" 💌`;
    }

    document.getElementById('speech-sender').textContent = settings.dogName;
    document.getElementById('speech-text').textContent = note;

    setTimeout(() => {
        setDogState('idle');
        document.getElementById('appContainer').classList.remove('show-bubble-active');
        saveStateToStorage();
    }, 3000);
}

function toggleSleepState() {
    if (state.isSleeping) {
        wakeDogUp();
    } else {
        putDogToSleep();
    }
}

function putDogToSleep() {
    state.isSleeping = true;
    setDogState('sleeping');
    document.getElementById('btn-sleep').textContent = "☀️ Wake Up";
    document.getElementById('speech-text').textContent = `Zzz... ${settings.dogName} has curled up on the rug. The alarms are quieted.`;
    updateSleepingUIVisuals();
    saveStateToStorage();
}

function wakeDogUp() {
    state.isSleeping = false;
    setDogState('idle');
    document.getElementById('btn-sleep').textContent = "💤 Sleep";
    document.getElementById('speech-text').textContent = `Yawn... Good morning! I'm ready to keep you company. 🐾`;
    updateSleepingUIVisuals();
    saveStateToStorage();
}

function updateSleepingUIVisuals() {
    const container = document.getElementById('dog-interactive');
    if (state.isSleeping) {
        container.style.opacity = "0.8";
    } else {
        container.style.opacity = "1";
    }
}

// ==========================================================================
// FORM INPUTS & SAVE OPERATIONS
// ==========================================================================

function saveConfiguration() {
    const dogNameInput = document.getElementById('input-dog-name').value.trim();
    const partnerNameInput = document.getElementById('input-partner-name').value.trim();
    const waterSelect = document.getElementById('input-water-interval').value;
    const lunchTimeInput = document.getElementById('input-lunch-time').value;
    const breakTimeInput = document.getElementById('input-break-time').value;

    const msgWaterText = document.getElementById('msg-water').value.trim();
    const msgLunchText = document.getElementById('msg-lunch').value.trim();
    const msgBreakText = document.getElementById('msg-break').value.trim();

    const randomNotesText = document.getElementById('random-notes').value;

    // Validation
    settings.dogName = dogNameInput || "Jayanti Lal";
    settings.partnerName = partnerNameInput || "Priya";
    settings.waterInterval = Number(waterSelect) || 60;
    settings.lunchTime = lunchTimeInput || "13:00";
    settings.breakTime = breakTimeInput || "17:00";

    settings.msgWater = msgWaterText || "Time to drink water! 💧";
    settings.msgLunch = msgLunchText || "Go eat lunch! 🍲";
    settings.msgBreak = msgBreakText || "Take a break! ❤️";

    settings.randomNotes = randomNotesText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    saveSettingsToStorage();
    updateDogNameDisplays();
    updateNextAlertsIndicator();

    // Visual indicator that configs were saved
    playChimeSound();
    for (let i = 0; i < 4; i++) {
        setTimeout(() => spawnParticle('💾', 'heart-particle'), i * 150);
    }

    document.getElementById('speech-text').textContent = `Woof! I saved your configurations successfully! 💾`;
}

// ==========================================================================
// INITIALIZATION & EVENT HANDLERS
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Check if we are in Setup Mode (url?setup=true)
    const urlParams = new URLSearchParams(window.location.search);
    const isSetupMode = urlParams.has('setup');

    const container = document.getElementById('appContainer');
    const toggleBtn = document.getElementById('btn-toggle-mode');
    const dashboard = document.getElementById('dashboardSection');

    if (!isSetupMode) {
        container.classList.add('mini-mode');
        if (toggleBtn) toggleBtn.style.display = 'none';
        if (dashboard) dashboard.style.display = 'none';
    }

    // Check if we are in Partner Mode (url?partner=true)
    const isPartnerMode = urlParams.has('partner');
    if (isPartnerMode) {
        const mobileNav = document.getElementById('mobile-nav');
        if (mobileNav) {
            mobileNav.style.setProperty('display', 'none', 'important');
        }
    }

    // 1. Initial Data Setup
    loadData();
    updateStatsUI();

    // 2. Start Engines
    startMetricsDecay();
    startScheduler();

    // Set initial dog visual class
    if (state.isSleeping) {
        putDogToSleep();
    } else {
        setDogState('idle');
    }

    // 3. Register Event Listeners

    // Care Actions
    document.getElementById('btn-feed').addEventListener('click', feedDog);
    document.getElementById('btn-water').addEventListener('click', giveWaterDog);
    document.getElementById('btn-pet').addEventListener('click', petDog);
    document.getElementById('btn-sleep').addEventListener('click', toggleSleepState);
    document.getElementById('dog-interactive').addEventListener('click', petDog);

    // Forms & Settings
    document.getElementById('btn-save-settings').addEventListener('click', saveConfiguration);

    document.getElementById('toggle-audio').addEventListener('change', (e) => {
        settings.audioEnabled = e.target.checked;
        saveSettingsToStorage();
    });

    document.getElementById('toggle-notifications').addEventListener('change', (e) => {
        if (e.target.checked) {
            requestNotificationPermission();
        } else {
            settings.notificationsEnabled = false;
            saveSettingsToStorage();
        }
    });

    // Mode Switcher (Full Screen <-> Mini Companion Widget)
    document.getElementById('btn-toggle-mode').addEventListener('click', () => {
        const container = document.getElementById('appContainer');
        const isMini = container.classList.toggle('mini-mode');

        const modeIcon = document.querySelector('.mode-icon');
        const modeText = document.querySelector('.mode-text');

        if (isMini) {
            modeIcon.textContent = "💻";
            modeText.textContent = "Full Dashboard";
            document.getElementById('speech-text').textContent = "Mini Mode active! Pin me to your screen.";
        } else {
            modeIcon.textContent = "📱";
            modeText.textContent = "Mini Mode";
            document.getElementById('speech-text').textContent = "Full dashboard is back! Configure my stats here.";
        }
    });

    // Test simulator buttons
    document.getElementById('btn-test-water').addEventListener('click', () => {
        triggerAlert('water', settings.msgWater);
    });

    document.getElementById('btn-test-lunch').addEventListener('click', () => {
        triggerAlert('lunch', settings.msgLunch);
    });

    document.getElementById('btn-test-break').addEventListener('click', () => {
        triggerAlert('break', settings.msgBreak);
    });

    document.getElementById('btn-test-whisper').addEventListener('click', () => {
        petDog(); // triggers whisper + chime
    });

    // Tiny Widget Mode Toggle (Micro Mode)
    const microToggle = document.getElementById('btn-toggle-micro');
    if (microToggle) {
        microToggle.addEventListener('click', () => {
            const isMicro = container.classList.toggle('micro-mode');
            if (isMicro) {
                microToggle.textContent = "🔍 Expand";
                document.getElementById('speech-text').textContent = "Jayanti Lal is sitting on your taskbar! 🐾";
                container.classList.add('show-bubble-active');
                setTimeout(() => container.classList.remove('show-bubble-active'), 3000);
            } else {
                microToggle.textContent = "🔍 Tiny Mode";
                document.getElementById('speech-text').textContent = "Jayanti Lal's room is expanded!";
                container.classList.remove('show-bubble-active');
            }
        });
    }

    // Mobile Navigation Tab Switcher
    const navBtnCompanion = document.getElementById('nav-btn-companion');
    const navBtnSettings = document.getElementById('nav-btn-settings');
    if (navBtnCompanion && navBtnSettings) {
        navBtnCompanion.addEventListener('click', () => {
            navBtnCompanion.classList.add('active');
            navBtnSettings.classList.remove('active');
            container.classList.remove('mobile-view-settings');
        });
        navBtnSettings.addEventListener('click', () => {
            navBtnSettings.classList.add('active');
            navBtnCompanion.classList.remove('active');
            container.classList.add('mobile-view-settings');
        });
    }

    // Register Service Worker for PWA capabilities
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered successfully!', reg))
                .catch(err => console.error('Service Worker registration failed: ', err));
        });
    }
});

