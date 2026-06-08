// ==========================================================================
// COMPANION STATE & SETTINGS
// ==========================================================================

const DEFAULT_SETTINGS = {
    dogName: "Jayanti Lal",
    audioEnabled: true,
    notificationsEnabled: false, // will request permission via banner
    connectionKey: ""
};

const DEFAULT_STATE = {
    hunger: 100,
    hydration: 100,
    energy: 100,
    mood: 100,
    isSleeping: false,
    lastCareCheck: Date.now(),
    dogState: "idle" // "idle", "excited", "sleeping", "eating"
};

let settings = { ...DEFAULT_SETTINGS };
let state = { ...DEFAULT_STATE };
let statDecayInterval = null;
let eventSource = null;

// Track which warnings have been shown during this cycle
const careAlertsTriggered = {
    hydration70: false, hydration40: false,
    hunger70: false, hunger40: false,
    energy70: false, energy40: false
};

// ==========================================================================
// AUDIO SYNTHESIZER (WEB AUDIO API)
// ==========================================================================

function playBarkSound() {
    if (!settings.audioEnabled || state.isSleeping) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const singleBark = (time, pitch, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(pitch, time);
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

function playChimeSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 -> E5 -> G5 -> C6

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

function playChewSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

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

function playSlurpSound() {
    if (!settings.audioEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

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

function checkNotificationBanner() {
    const banner = document.getElementById('notification-banner');
    if (!banner) return;
    
    if (("Notification" in window) && (Notification.permission !== "granted" || !settings.notificationsEnabled)) {
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function requestNotificationPermission() {
    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            const isGranted = (permission === "granted");
            settings.notificationsEnabled = isGranted;
            saveSettingsToStorage();
            checkNotificationBanner();
            
            if (isGranted) {
                playChimeSound();
                sendSystemNotification(`${settings.dogName} says: Connected! 🎉`, "I will keep you healthy and connected to your partner.");
            }
        });
    }
}

function sendSystemNotification(title, message) {
    if (settings.notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, {
                        body: message,
                        icon: 'icon.svg',
                        badge: 'icon.svg',
                        vibrate: [200, 100, 200]
                    });
                }).catch(err => {
                    new Notification(title, { body: message, icon: 'icon.svg' });
                });
            } else {
                new Notification(title, { body: message, icon: 'icon.svg' });
            }
        } catch (e) {
            console.error("Notification trigger failed:", e);
        }
    }
}

// ==========================================================================
// PEER-TO-PEER INTERACTION SYNC (ntfy.sh)
// ==========================================================================

function initSyncConnection() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    const key = settings.connectionKey ? settings.connectionKey.trim() : "";
    const connectBtnText = document.getElementById('connect-btn-text');

    if (!key) {
        if (connectBtnText) connectBtnText.textContent = "Connect Partner";
        return;
    }

    if (connectBtnText) connectBtnText.textContent = "Connected ❤️";

    // Subscribe to shared connection topic using Server-Sent Events (SSE)
    const topic = `virtual-dog-companion-${key}`;
    eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // Ignore messages published by oneself
            if (data.event === "message" && data.message) {
                const payload = JSON.parse(data.message);
                if (payload.senderId !== getClientId()) {
                    handlePartnerInteraction(payload);
                }
            }
        } catch (e) {
            // Support raw text fallback if any
        }
    };

    eventSource.onerror = (err) => {
        console.error("Sync connection lost, reconnecting...", err);
    };
}

function publishPartnerInteraction(actionType) {
    if (!settings.connectionKey) return;
    const topic = `virtual-dog-companion-${settings.connectionKey.trim()}`;
    const payload = {
        type: actionType,
        senderId: getClientId(),
        timestamp: Date.now()
    };

    fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: JSON.stringify(payload)
    }).catch(err => {
        console.error("Failed to sync interaction with partner:", err);
    });
}

function handlePartnerInteraction(payload) {
    if (state.isSleeping) return; // Silent if dog is sleeping

    if (payload.type === 'pet') {
        // Partner petted their dog!
        setDogState('excited');
        playChimeSound();
        
        // Spawn hearts floating above the dog
        for (let i = 0; i < 4; i++) {
            setTimeout(() => spawnParticle('❤️', 'heart-particle'), i * 200);
        }

        const messages = [
            "Your partner just petted their companion. They are thinking of you! ❤️",
            "A warm whisper from your partner: 'I'm thinking about you.' 💌",
            "Jayanti Lal perked up! Someone special is sending you love right now. 🐾",
            "Your partner petted their dog, sending you a gentle wave of warmth! ❤️"
        ];
        const randomMsg = messages[Math.floor(Math.random() * messages.length)];
        
        document.getElementById('speech-sender').textContent = settings.dogName;
        document.getElementById('speech-text').textContent = randomMsg;
        document.getElementById('appContainer').classList.add('show-bubble-active');

        sendSystemNotification(`${settings.dogName} perked up! 🐾`, randomMsg);

        setTimeout(() => {
            setDogState('idle');
            document.getElementById('appContainer').classList.remove('show-bubble-active');
        }, 8000);
    }
}

// Generate unique identifier for this browser session to avoid handling own messages
function getClientId() {
    let id = sessionStorage.getItem('dog_client_id');
    if (!id) {
        id = 'client-' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('dog_client_id', id);
    }
    return id;
}

// ==========================================================================
// STATE PERSISTENCE (LOCAL STORAGE)
// ==========================================================================

function loadData() {
    const storedSettings = localStorage.getItem('dog_companion_settings');
    if (storedSettings) {
        try {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
        } catch (e) {
            settings = { ...DEFAULT_SETTINGS };
        }
    }

    // Load connection key from URL parameters if present (for easy setup sharing)
    const urlParams = new URLSearchParams(window.location.search);
    const urlKey = urlParams.get('key');
    if (urlKey) {
        settings.connectionKey = urlKey;
        saveSettingsToStorage();
    }

    const storedState = localStorage.getItem('dog_companion_state');
    if (storedState) {
        try {
            state = { ...DEFAULT_STATE, ...JSON.parse(storedState) };
            state.lastCareCheck = Number(state.lastCareCheck) || Date.now();
        } catch (e) {
            state = { ...DEFAULT_STATE };
        }
    }

    // Verify notification permission in browser
    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            settings.notificationsEnabled = true;
        } else {
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

    dogEl.classList.remove('dog-idle', 'excited-alert', 'dog-sleeping', 'dog-eating');

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

function spawnParticle(typeChar, className) {
    const container = document.getElementById('particles-container');
    if (!container) return;

    const particle = document.createElement('div');
    particle.className = `particle ${className}`;
    particle.textContent = typeChar;

    const randomX = 80 + Math.random() * 60;
    particle.style.left = `${randomX}px`;
    particle.style.bottom = `120px`;

    container.appendChild(particle);

    setTimeout(() => {
        particle.remove();
    }, 2500);
}

// ==========================================================================
// AUTONOMOUS CARING BEHAVIOR ENGINE
// ==========================================================================

function startMetricsDecay() {
    if (statDecayInterval) clearInterval(statDecayInterval);

    // Decay checks run every 10 seconds
    statDecayInterval = setInterval(() => {
        if (state.isSleeping) {
            state.energy = Math.min(100, state.energy + 1.2);
            state.hunger = Math.max(0, state.hunger - 0.08);
            state.hydration = Math.max(0, state.hydration - 0.12);
            spawnParticle('Z', 'zzz-particle');
        } else {
            state.hunger = Math.max(0, state.hunger - 0.35);
            state.hydration = Math.max(0, state.hydration - 0.5);
            state.energy = Math.max(0, state.energy - 0.25);
            
            // Check if we need to trigger an organic caring prompt
            checkAutonomousCare();
        }

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

function triggerCareCheckIn(title, message) {
    if (state.isSleeping) return;

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('excited');
    playBarkSound();

    document.getElementById('speech-sender').textContent = settings.dogName;
    document.getElementById('speech-text').textContent = message;

    sendSystemNotification(title, message);

    // Revert back to idle after 12 seconds
    setTimeout(() => {
        if (state.dogState === 'excited') {
            setDogState('idle');
        }
        document.getElementById('appContainer').classList.remove('show-bubble-active');
    }, 12000);
}

function checkAutonomousCare() {
    // 1. Organic prompts triggered when stats drop below thresholds
    if (state.hydration < 40 && !careAlertsTriggered.hydration40) {
        careAlertsTriggered.hydration40 = true;
        triggerCareCheckIn("Drink Water! 💧", "Hey there! I notice my water bowl is getting empty... and you might be running dry too. Let's both take a nice sip of water! 💧");
        return;
    }
    if (state.hydration < 70 && !careAlertsTriggered.hydration70) {
        careAlertsTriggered.hydration70 = true;
        triggerCareCheckIn("Stay Hydrated 💧", "Just a gentle nudge! Keep a glass of water nearby and take a sip. You deserve to feel refreshed. 😊");
        return;
    }

    if (state.hunger < 40 && !careAlertsTriggered.hunger40) {
        careAlertsTriggered.hunger40 = true;
        triggerCareCheckIn("Meal Time 🍱", "My tummy is rumbling! Is yours too? Let's take a break to grab a nice snack or meal. Go eat something good! 🍛");
        return;
    }
    if (state.hunger < 70 && !careAlertsTriggered.hunger70) {
        careAlertsTriggered.hunger70 = true;
        triggerCareCheckIn("Time for a Snack? 🍪", "Working hard can build up an appetite. Remember to eat healthy food to keep your mind sharp! 🍎");
        return;
    }

    if (state.energy < 40 && !careAlertsTriggered.energy40) {
        careAlertsTriggered.energy40 = true;
        triggerCareCheckIn("Stretch Break! 🤸", "We've been sitting for a long time. Stand up, stretch your arms, and take a quick 1-minute walk around the room! 🐾");
        return;
    }
    if (state.energy < 70 && !careAlertsTriggered.energy70) {
        careAlertsTriggered.energy70 = true;
        triggerCareCheckIn("Rest your eyes 👀", "Remember the 20-20-20 rule! Look away from the screen, focus on something 20 feet away for 20 seconds. Let's relax our eyes. 🌸");
        return;
    }

    // 2. Periodic support check-in every 30 minutes if stats are high
    const now = Date.now();
    const halfHour = 30 * 60 * 1000;
    if (now - state.lastCareCheck >= halfHour) {
        state.lastCareCheck = now;
        
        const randomSupportNotes = [
            "Inhale... exhale. Take a deep breath with me. You are doing wonderful work! 🌸",
            "Just wanted to sit near you and remind you that you are capable and doing great! Keep going. ❤️",
            "Don't forget to relax your shoulders and unclench your jaw. You're working so hard. 🐾",
            "I believe in you! Let's conquer the next hour together. 🐶"
        ];
        const note = randomSupportNotes[Math.floor(Math.random() * randomSupportNotes.length)];
        triggerCareCheckIn("A gentle reminder 🌸", note);
    }
}

// Reset triggers when user takes active action (feeding/watering)
function resetCareTriggersForMetric(metric) {
    if (metric === 'hydration') {
        careAlertsTriggered.hydration70 = false;
        careAlertsTriggered.hydration40 = false;
    }
    if (metric === 'hunger') {
        careAlertsTriggered.hunger70 = false;
        careAlertsTriggered.hunger40 = false;
    }
    if (metric === 'energy') {
        careAlertsTriggered.energy70 = false;
        careAlertsTriggered.energy40 = false;
    }
}

// ==========================================================================
// INTERACTIVE DOG ACTIONS (FEED, WATER, PET, SLEEP)
// ==========================================================================

function feedDog() {
    if (state.isSleeping) wakeDogUp();

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('eating');
    playChewSound();

    const bowl = document.getElementById('food-bowl');
    bowl.classList.add('bowl-active');

    let chewsCount = 0;
    const chewInterval = setInterval(() => {
        spawnParticle('🍖', 'heart-particle');
        chewsCount++;
        if (chewsCount >= 4) clearInterval(chewInterval);
    }, 500);

    state.hunger = Math.min(100, state.hunger + 30);
    resetCareTriggersForMetric('hunger');
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
    if (state.isSleeping) wakeDogUp();

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('eating');
    playSlurpSound();

    const bowl = document.getElementById('water-bowl');
    bowl.classList.add('bowl-active');

    let gulps = 0;
    const slurpInterval = setInterval(() => {
        spawnParticle('💧', 'water-particle');
        gulps++;
        if (gulps >= 4) clearInterval(slurpInterval);
    }, 450);

    state.hydration = Math.min(100, state.hydration + 35);
    resetCareTriggersForMetric('hydration');
    updateStatsUI();

    document.getElementById('speech-text').textContent = `Slurp slurp... So refreshing! Remember to drink your water too! 💧`;

    setTimeout(() => {
        bowl.classList.remove('bowl-active');
        setDogState('idle');
        document.getElementById('appContainer').classList.remove('show-bubble-active');
        saveStateToStorage();
    }, 3000);
}

function petDog(e) {
    // Prevent double pet trigger when clicking wrapper
    if (e) e.stopPropagation();
    
    if (state.isSleeping) wakeDogUp();

    document.getElementById('appContainer').classList.add('show-bubble-active');
    setDogState('excited');
    playChimeSound();

    for (let i = 0; i < 3; i++) {
        setTimeout(() => spawnParticle('❤️', 'heart-particle'), i * 200);
    }

    state.energy = Math.min(100, state.energy + 8);
    resetCareTriggersForMetric('energy');
    updateStatsUI();

    document.getElementById('speech-sender').textContent = settings.dogName;
    
    const petMessages = [
        "Pant pant! I love you! ❤️ Sending warm hugs back!",
        "Aww, that feels so good! You make me so happy! 🥰",
        "Bark! Thank you for the sweet pets! I'm always here for you. 🐾",
        "Tail wagging intensely! Let's do our best today! 🐶",
        "Warm doggy hugs! You're doing wonderful, friend! ❤️"
    ];
    const randomPetMsg = petMessages[Math.floor(Math.random() * petMessages.length)];
    document.getElementById('speech-text').textContent = randomPetMsg;

    // Sync pet action to partner in real-time
    publishPartnerInteraction('pet');

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
    document.getElementById('speech-text').textContent = `Zzz... ${settings.dogName} is curled up and sleeping soundly. 💤`;
    updateSleepingUIVisuals();
    saveStateToStorage();
}

function wakeDogUp() {
    state.isSleeping = false;
    setDogState('idle');
    document.getElementById('btn-sleep').textContent = "💤 Sleep";
    document.getElementById('speech-text').textContent = `Yawn... Hello! I'm ready to keep you company. 🐾`;
    updateSleepingUIVisuals();
    saveStateToStorage();
}

function updateSleepingUIVisuals() {
    const container = document.getElementById('dog-interactive');
    if (state.isSleeping) {
        container.style.opacity = "0.75";
    } else {
        container.style.opacity = "1";
    }
}

// ==========================================================================
// MODAL & INITIALIZATION EVENT HANDLERS
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial Data Setup
    loadData();
    updateStatsUI();
    checkNotificationBanner();
    
    // 2. Start real-time sync with partner if key exists
    initSyncConnection();

    // 3. Start stats decay and autonomous care schedule
    startMetricsDecay();

    if (state.isSleeping) {
        putDogToSleep();
    } else {
        setDogState('idle');
    }

    // 4. Care Actions Listeners
    document.getElementById('btn-feed').addEventListener('click', feedDog);
    document.getElementById('btn-water').addEventListener('click', giveWaterDog);
    document.getElementById('btn-pet').addEventListener('click', petDog);
    document.getElementById('btn-sleep').addEventListener('click', toggleSleepState);
    document.getElementById('dog-interactive').addEventListener('click', petDog);

    // 5. Notification Banner
    const enableNotifBtn = document.getElementById('btn-enable-notifications');
    if (enableNotifBtn) {
        enableNotifBtn.addEventListener('click', requestNotificationPermission);
    }

    // 6. Connection Modal Controls
    const connectPartnerBtn = document.getElementById('btn-connect-partner');
    const connectionModal = document.getElementById('connection-modal');
    const closeConnectionBtn = document.getElementById('btn-close-connection');
    const saveConnectionBtn = document.getElementById('btn-save-connection');
    const inputConnectionKey = document.getElementById('input-connection-key');

    if (connectPartnerBtn && connectionModal) {
        connectPartnerBtn.addEventListener('click', () => {
            if (inputConnectionKey) {
                inputConnectionKey.value = settings.connectionKey || "";
            }
            connectionModal.style.display = 'flex';
        });
    }

    if (closeConnectionBtn && connectionModal) {
        closeConnectionBtn.addEventListener('click', () => {
            connectionModal.style.display = 'none';
        });
    }

    if (saveConnectionBtn && connectionModal && inputConnectionKey) {
        saveConnectionBtn.addEventListener('click', () => {
            const keyVal = inputConnectionKey.value.trim();
            settings.connectionKey = keyVal;
            saveSettingsToStorage();
            initSyncConnection();
            connectionModal.style.display = 'none';

            // Generate particles
            playChimeSound();
            for (let i = 0; i < 4; i++) {
                setTimeout(() => spawnParticle('❤️', 'heart-particle'), i * 150);
            }
        });
    }

    // Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered successfully!', reg))
                .catch(err => console.error('Service Worker registration failed: ', err));
        });
    }
});
