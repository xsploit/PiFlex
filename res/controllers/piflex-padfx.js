// RB6.7 bank-one layout; sound is an explicitly approximate native Mixxx voicing.
// Private lanes keep controller effects out of user CFX/Beat FX/Merge FX presets.
var PiFlexPadFx = {
    lanes: ["sweep", "flanger", "echo", "reverb", "trans", "crush", "filterlfo", "delay", "dub", "space"],
    decks: {},
    connections: [],
    // Real DSP units, not Rekordbox's proprietary Level/Depth transfer curves.
    pads: [
        {name: "Roll 1/2", transport: "roll"},
        {name: "Sweep 80", lane: "sweep", p: {lpf: 4500, hpf: 550, q: 0.9}},
        {name: "Flanger 16", lane: "flanger", p: {speed: 16, mix: 0.55, regen: 0.25, triplet: 0}},
        {name: "Release Vinyl Brake 3/4", transport: "brake", beats: 0.75, release: true},
        {name: "Echo 1/4", lane: "echo", beats: 0.25, tail: true},
        {name: "Echo 1/2", lane: "echo", beats: 0.5, tail: true},
        {name: "Reverb 50", lane: "reverb", tail: true, p: {decay: 0.5, send_amount: 0.22, damping: 0.35}},
        {name: "Release Echo 1/2", lane: "echo", beats: 0.5, tail: true, release: true},
        {name: "Trans 1/2", lane: "trans", p: {rate: 2, depth: 0.5, width: 0.5, waveform: 0.005, quantize: 1}},
        {name: "Crush 40", lane: "crush", p: {bit_depth: 10, downsample: 0.45}},
        {name: "Filter LFO 4", lane: "filterlfo", lfo: true, p: {hpf: 13, q: 0.8, lpf: 16000}},
        {name: "Release Backspin 4", transport: "backspin", beats: 4, release: true},
        {name: "MT Delay 1/8 (approx)", lane: "delay", beats: 0.125, tail: true},
        {name: "Dub Echo 30 (approx)", lane: "dub", beats: 0.75, tail: true},
        {name: "Space 30 (approx)", lane: "space", tail: true, p: {decay: 0.7, send_amount: 0.18, damping: 0.5}},
        {name: "Release Echo 1", lane: "echo", beats: 1, tail: true, release: true}
    ],
    group: function(deck, lane) { return "[PadEffectRack1_" + deck + "_" + lane + "]"; },
    set: function(deck, lane, key, value) { engine.setValue(this.group(deck, lane), key, value); },
    param: function(deck, lane, key, value) { this.set(deck, lane, "param_" + key, value); },
    // Snapshot configuration at note-on. Remapping a held pad must never change
    // which lane/transport its eventual note-off releases.
    configuredPad: function(deck, slot) {
        var effect = slot, beat = 0, strength = 4, hold = 0;
        if (engine.getValue("[PadFX]", "version") === 1) {
            var prefix = "d" + deck.match(/\d+/)[0] + "_s" + slot + "_";
            var read = function(name, count, fallback) {
                var value = engine.getValue("[PadFX]", prefix + name);
                return isFinite(value) && value >= 0 && value < count && Math.floor(value) === value ? value : fallback;
            };
            effect = read("effect", 17, slot);
            beat = read("beat", 7, 0);
            strength = read("strength", 5, 4);
            hold = read("hold", 2, 0);
        }
        if (effect === 16 || strength === 0) { return null; }
        var pad = JSON.parse(JSON.stringify(this.pads[effect]));
        pad.strength = strength / 4;
        // Echo-family native delay is bounded to two beats. Transport durations
        // and non-delay rates have different units and are deliberately unchanged.
        if (pad.lane && pad.beats && beat) {
            pad.beats = [0, 0.125, 0.25, 0.5, 0.75, 1, 2][beat];
        }
        // Only Release Echo may latch. Scratch/roll ownership remains momentary.
        pad.latched = hold === 1 && pad.release && !pad.transport;
        var p = pad.p || {}, amount = pad.strength;
        if (p.send_amount !== undefined) { p.send_amount *= amount; }
        if (p.mix !== undefined) { p.mix *= amount; }
        if (p.depth !== undefined) { p.depth *= amount; }
        if (pad.lane === "crush") {
            p.bit_depth = 16 - (16 - p.bit_depth) * amount;
            p.downsample = 1 - (1 - p.downsample) * amount;
        }
        if (pad.lane === "sweep") {
            p.hpf = 13 * Math.pow(p.hpf / 13, amount);
            p.lpf = 16000 * Math.pow(p.lpf / 16000, amount);
        }
        return pad;
    },
    init: function() {
        this.shutdown();
        for (var n = 1; n <= 4; ++n) {
            var deck = "[Channel" + n + "]";
            this.decks[deck] = {held: {}, pressed: {}, order: 0, jobs: {}};
            for (var i = 0; i < this.lanes.length; ++i) {
                var lane = this.lanes[i];
                if (engine.getValue(this.group(deck, lane), "available")) {
                    this.set(deck, lane, "prepare", 1);
                    this.set(deck, lane, "active", 0);
                }
            }
        }
        if (engine.getValue("[PadFX]", "version") === 1) {
            var self = this;
            Object.keys(this.decks).forEach(function(deck) {
                self.connections.push(engine.makeConnection(deck, "track_loaded", function(value) {
                    if (value === 0) { self.clear(deck); }
                }));
            });
            this.connections.push(engine.makeConnection("[PadFX]", "clear_all", function(value) {
                if (value === 1) {
                    Object.keys(self.decks).forEach(function(deck) { self.clear(deck); });
                }
            }));
        }
    },
    cancel: function(deck, key) {
        var jobs = this.decks[deck].jobs;
        if (jobs[key]) { engine.stopTimer(jobs[key].id); delete jobs[key]; }
    },
    timer: function(deck, key, ms, callback, repeat) {
        this.cancel(deck, key);
        var self = this, state = this.decks[deck], job = {};
        state.jobs[key] = job;
        job.id = engine.beginTimer(ms, function() {
            if (self.decks[deck] !== state || state.jobs[key] !== job) { return; }
            if (!repeat) { delete state.jobs[key]; }
            callback();
        }, !repeat);
    },
    beatMs: function(deck) {
        var bpm = engine.getValue(deck, "bpm");
        return 60000 / (isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : 120);
    },
    latest: function(deck, lane) {
        var result = null, held = this.decks[deck].held;
        Object.keys(held).forEach(function(key) {
            var item = held[key];
            if (item.pad.lane === lane && (!result || item.order > result.order)) { result = item; }
        });
        return result;
    },
    activate: function(deck, item) {
        var self = this, pad = item.pad, lane = pad.lane;
        this.cancel(deck, lane + ":tail");
        this.cancel(deck, lane + ":capture");
        this.cancel(deck, lane + ":lfo");
        if (pad.beats) {
            var params = {delay_time: pad.beats, send_amount: 0.22,
                feedback_amount: 0.38, pingpong_amount: 0, quantize: 0, triplet: 0, dry_amount: 1};
            if (pad.release) { params.send_amount = 0.65; params.feedback_amount = 0.48; }
            params.send_amount *= pad.strength;
            Object.keys(params).forEach(function(key) { self.param(deck, lane, key, params[key]); });
        }
        Object.keys(pad.p || {}).forEach(function(key) { self.param(deck, lane, key, pad.p[key]); });
        this.set(deck, lane, "active", 1);
        if (pad.release) {
            // Capture one beat-length segment, then cut only this lane's dry
            // path/input. On release, dry returns while the buffer decays.
            this.timer(deck, lane + ":capture", Math.round(this.beatMs(deck) * pad.beats), function() {
                self.param(deck, lane, "send_amount", 0);
                self.param(deck, lane, "dry_amount", 0);
            });
        }
        if (pad.lfo) {
            var phase = 0, last = Date.now();
            this.timer(deck, lane + ":lfo", 33, function() {
                var now = Date.now();
                phase = (phase + (now - last) / (4 * self.beatMs(deck))) % 1;
                last = now;
                // Log-frequency sweep, ~30 Hz control updates; native filter
                // interpolation handles the audio. Not RB's proprietary LFO.
                var amount = (1 + Math.cos(phase * 2 * Math.PI)) / 2;
                var frequency = 250 * Math.pow(64, amount);
                self.param(deck, lane, "lpf", 16000 * Math.pow(frequency / 16000, pad.strength));
            }, true);
        }
    },
    stopTransport: function(deck, item) {
        if (item.pad.transport === "roll") {
            engine.setValue(deck, "beatlooproll_0.5_activate", 0);
        } else {
            this.cancel(deck, "transport");
            engine.setValue(deck, "scratch2", 0);
            engine.setValue(deck, "scratch2_enable", 0);
            if (!item.slipWasOn && engine.getValue(deck, "slip_enabled") === 1) {
                engine.setValue(deck, "slip_enabled", 0);
            }
        }
    },
    release: function(deck, physical, immediate) {
        var state = this.decks[deck], item = state.held[physical], self = this;
        if (!item) { return; }
        delete state.held[physical];
        midi.sendShortMsg(item.status, item.control, 0);
        var pad = item.pad, lane = pad.lane;
        if (pad.transport) { this.stopTransport(deck, item); return; }
        this.cancel(deck, lane + ":capture");
        this.cancel(deck, lane + ":lfo");
        var previous = this.latest(deck, lane);
        if (previous) { this.activate(deck, previous); return; }
        if (pad.tail && !immediate) {
            this.param(deck, lane, "send_amount", 0);
            if (pad.beats) { this.param(deck, lane, "dry_amount", 1); }
            // Echo feedback <= .48: 16 repeats is below -100 dB. Reverb uses
            // a conservative bounded decay window. A retrigger cancels this.
            var tailMs = pad.beats ? 16 * Math.max(3000, this.beatMs(deck) * pad.beats) : 12000;
            this.timer(deck, lane + ":tail", Math.round(tailMs), function() {
                self.set(deck, lane, "active", 0);
            });
        } else {
            this.cancel(deck, lane + ":tail");
            this.set(deck, lane, "active", 0);
        }
    },
    clear: function(deck) {
        var self = this, state = this.decks[deck];
        Object.keys(state.held).forEach(function(key) { self.release(deck, key, true); });
        Object.keys(state.jobs).forEach(function(key) { self.cancel(deck, key); });
        this.lanes.forEach(function(lane) {
            if (engine.getValue(self.group(deck, lane), "available")) { self.set(deck, lane, "active", 0); }
        });
    },
    press: function(control, value, status, deck) {
        var state = this.decks[deck], physical = control - 0x10;
        if (!state || physical < 0 || physical > 7) { return; }
        // Match note-off to the physical key even if SHIFT changed while held.
        if (value === 0 || (status & 0xF0) === 0x80) {
            delete state.pressed[physical];
            if (!state.held[physical] || !state.held[physical].pad.latched) {
                this.release(deck, physical, false);
            }
            return;
        }
        if (state.pressed[physical]) { return; }
        state.pressed[physical] = true;
        if (state.held[physical]) { this.release(deck, physical, false); return; }
        var shifted = (status & 1) === 0;
        var pad = this.configuredPad(deck, physical + (shifted ? 8 : 0));
        if (!pad) { return; }
        if (pad.lane && !engine.getValue(this.group(deck, pad.lane), "available")) {
            console.log("Pad FX unavailable in this build: " + pad.name); return;
        }
        if (pad.transport && (!engine.getValue(deck, "play") || engine.getValue(deck, "scratch2_enable"))) { return; }
        if (pad.transport && Object.keys(state.held).some(function(key) {
            return !!state.held[key].pad.transport;
        })) { return; }
        if (pad.release) { this.clear(deck); }
        var item = {pad: pad, order: ++state.order, status: status, control: control};
        state.held[physical] = item;
        if (!pad.transport) { this.activate(deck, item); }
        else if (pad.transport === "roll") { engine.setValue(deck, "beatlooproll_0.5_activate", 1); }
        else {
            item.slipWasOn = !!engine.getValue(deck, "slip_enabled");
            engine.setValue(deck, "slip_enabled", 1);
            engine.setValue(deck, "scratch2_enable", 1);
            var start = Date.now(), duration = this.beatMs(deck) * pad.beats, self = this;
            var rate = engine.getValue(deck, "rate_ratio") || 1;
            var tick = function() {
                var t = Math.min(1, (Date.now() - start) / duration);
                engine.setValue(deck, "scratch2", pad.transport === "backspin" ? -2.5 * (1-t) : rate * (1-t));
                if (t >= 1) { self.cancel(deck, "transport"); }
            };
            tick();
            this.timer(deck, "transport", 16, tick, true);
        }
        midi.sendShortMsg(status, control, 0x7F);
    },
    shutdown: function() {
        var self = this;
        Object.keys(this.decks).forEach(function(deck) { self.clear(deck); });
        this.connections.forEach(function(connection) { connection.disconnect(); });
        this.connections = [];
        this.decks = {};
    }
};
