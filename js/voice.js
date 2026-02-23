/* ── De'Osa Voice Assistant · ElevenLabs Conversational AI ── *
 *                                                              *
 *  Set window.VOICE_AGENT_ID before this script loads to      *
 *  provide a page-specific agent ID.                           *
 *                                                              *
 *  Set window.VOICE_CLIENT_TOOLS before this script loads to  *
 *  provide page-specific client tools (e.g. cart actions).    *
 * ──────────────────────────────────────────────────────────── */

(function () {

    const AGENT_ID = window.VOICE_AGENT_ID || 'agent_2901kj45e7cnfszrrjfhfj4qdc8j';

    let _conv   = null;
    let _active = false;

    /* ── Inject CSS ── */
    const _style = document.createElement('style');
    _style.textContent = `
        @keyframes voice-connecting-spin {
            0%   { transform: rotate(0deg);   }
            100% { transform: rotate(360deg); }
        }
        #ai-voice-btn.voice-connecting {
            animation: voice-connecting-spin 1.2s linear infinite,
                       none !important;
        }
        #ai-voice-btn.voice-error {
            border-color: rgba(239,68,68,0.85) !important;
            box-shadow: 0 0 14px 4px rgba(239,68,68,0.35) !important;
        }
    `;
    document.head.appendChild(_style);

    /* ── Phone ring — plays exactly twice then resolves ─────────────────
     *  UK-style ring: two 1-second bursts (400 Hz + 450 Hz) with a
     *  0.4-second gap between them. Total duration: ~2.4 seconds.
     *  Returns a Promise that resolves when both rings are finished.
     */
    function _ringTwice() {
        return new Promise(function (resolve) {
            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                var t   = ctx.currentTime;

                /* Mix two frequencies for a realistic phone-ring timbre */
                [400, 450].forEach(function (freq) {
                    var osc  = ctx.createOscillator();
                    var gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.type = 'sine';
                    osc.frequency.value = freq;

                    gain.gain.setValueAtTime(0, t);

                    /* Ring 1 — 0.0 s to 1.0 s */
                    gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
                    gain.gain.setValueAtTime(0.22, t + 0.97);
                    gain.gain.linearRampToValueAtTime(0, t + 1.0);

                    /* Ring 2 — 1.4 s to 2.4 s */
                    gain.gain.linearRampToValueAtTime(0.22, t + 1.43);
                    gain.gain.setValueAtTime(0.22, t + 2.37);
                    gain.gain.linearRampToValueAtTime(0, t + 2.4);

                    osc.start(t);
                    osc.stop(t + 2.4);
                });

                /* Resolve after both rings finish, then close the audio context */
                setTimeout(function () {
                    try { ctx.close(); } catch (_) {}
                    resolve();
                }, 2500);

            } catch (e) {
                /* AudioContext not available — skip ring and proceed */
                resolve();
            }
        });
    }

    /* ── UI state machine ── */
    function setVoiceUI(state) {
        const btn      = document.getElementById('ai-voice-btn');
        const idleIcon = document.getElementById('ai-idle-icon');
        const liveIcon = document.getElementById('ai-live-icon');
        if (!btn) return;

        btn.classList.remove('ai-live-glow', 'voice-connecting', 'voice-error');
        btn.style.opacity = '1';

        if (idleIcon) idleIcon.classList.remove('hidden');
        if (liveIcon) { liveIcon.classList.add('hidden'); liveIcon.classList.remove('flex'); }

        switch (state) {
            case 'connecting':
                btn.style.opacity = '0.6';
                btn.classList.add('voice-connecting');
                if (idleIcon) idleIcon.classList.add('hidden');
                if (liveIcon) { liveIcon.classList.remove('hidden'); liveIcon.classList.add('flex'); }
                break;

            case 'listening':
                btn.classList.add('ai-live-glow');
                if (idleIcon) idleIcon.classList.add('hidden');
                if (liveIcon) { liveIcon.classList.remove('hidden'); liveIcon.classList.add('flex'); }
                break;

            case 'speaking':
                btn.classList.add('ai-live-glow');
                if (idleIcon) idleIcon.classList.add('hidden');
                if (liveIcon) { liveIcon.classList.remove('hidden'); liveIcon.classList.add('flex'); }
                break;

            case 'error':
                btn.classList.add('voice-error');
                break;

            default: /* idle */
                break;
        }
    }

    /* ── Start a session ──
     *  Rings twice first, then connects to ElevenLabs so the agent
     *  speaks immediately after the ring finishes.
     */
    async function voiceStart(firstMessage) {
        if (_active) return;
        setVoiceUI('connecting');

        /* Ring plays for ~2.4 s — session starts right after */
        await _ringTwice();

        try {
            const { Conversation } = await import(
                'https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm'
            );

            /* Merge page-specific tools with universal tools */
            const pageTools = window.VOICE_CLIENT_TOOLS || {};

            /* get_current_time — returns UK time + greeting word */
            if (!pageTools.get_current_time) {
                pageTools.get_current_time = function () {
                    var now    = new Date();
                    var ukTime = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
                    var hour   = ukTime.getHours();
                    var mins   = String(ukTime.getMinutes()).padStart(2, '0');
                    var greeting =
                        hour >= 5  && hour < 12 ? 'Good morning' :
                        hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
                    return JSON.stringify({ time: hour + ':' + mins, greeting: greeting });
                };
            }

            /* navigate_to_menu — soft-nav with auto-reconnect on arrival */
            if (!pageTools.navigate_to_menu) {
                pageTools.navigate_to_menu = function () {
                    var onMenu = window.location.pathname.toLowerCase().includes('catering');
                    if (onMenu) {
                        return "You're already on our menu page — feel free to browse!";
                    }
                    sessionStorage.setItem('deosa_voice_return', '1');
                    setTimeout(function () {
                        window.location.href = 'catering.html';
                    }, 2600);
                    return "I'm taking you to our menu page right now — I'll be right with you there.";
                };
            }

            var sessionOpts = {
                agentId: AGENT_ID,
                clientTools: pageTools,

                onConnect: function () {
                    _active = true;
                    setVoiceUI('listening');
                },

                onDisconnect: function () {
                    if (_active) voiceStop();
                },

                onError: function (msg) {
                    console.error('[De\'Osa Voice]', msg);
                    _conv   = null;
                    _active = false;
                    setVoiceUI('error');
                    setTimeout(function () { setVoiceUI('idle'); }, 3000);
                },

                onModeChange: function (d) {
                    if (!_active) return;
                    setVoiceUI(d.mode === 'speaking' ? 'speaking' : 'listening');
                }
            };

            if (firstMessage) {
                sessionOpts.overrides = {
                    agent: { firstMessage: firstMessage }
                };
            }

            _conv = await Conversation.startSession(sessionOpts);

        } catch (err) {
            console.error('[De\'Osa Voice] Failed to start session:', err);
            _conv   = null;
            _active = false;
            setVoiceUI('error');
            setTimeout(function () { setVoiceUI('idle'); }, 3000);
        }
    }

    /* ── End a session ── */
    async function voiceStop() {
        _active = false;
        if (_conv) {
            try { await _conv.endSession(); } catch (_) { /* ignore */ }
            _conv = null;
        }
        setVoiceUI('idle');
    }

    /* ── Public toggle ── */
    window.toggleAIVoice = async function () {
        var onCatering = window.location.pathname.toLowerCase().includes('catering');
        if (!onCatering) {
            sessionStorage.setItem('deosa_voice_return', '1');
            window.location.href = 'catering.html';
            return;
        }
        if (_active) { voiceStop(); } else { voiceStart(); }
    };

    /* ── Auto-reconnect after page navigation ── */
    if (sessionStorage.getItem('deosa_voice_return') === '1') {
        sessionStorage.removeItem('deosa_voice_return');
        setTimeout(function () {
            voiceStart(
                "I'm back! You're now on the De'Osa menu page. " +
                "Let's pick up where we left off — what would you like to add to your order?"
            );
        }, 700);
    }

})();
