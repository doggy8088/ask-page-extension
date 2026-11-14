// Shared colors and shadows for the settings preview and page overlay.
(() => {
    'use strict';

    const DEFAULT_COLOR = '#FF9B3A';
    const STORAGE_KEY = 'AGENT_GLOW_COLOR';
    const PRESETS = Object.freeze([
        { key: 'agentGlowAmber', color: DEFAULT_COLOR, layers: ['#FF9B3A', '#EA7D2A', '#BC4A18'] },
        { key: 'agentGlowSky', color: '#38A8FF', layers: ['#38A8FF', '#2584DB', '#1957A8'] },
        { key: 'agentGlowTeal', color: '#22C9BD', layers: ['#22C9BD', '#16A79E', '#10756F'] },
        { key: 'agentGlowEmerald', color: '#42CC7E', layers: ['#42CC7E', '#2BA65F', '#1C7542'] },
        { key: 'agentGlowViolet', color: '#AD85FF', layers: ['#AD85FF', '#8960DD', '#603AA8'] },
        { key: 'agentGlowRose', color: '#F577A8', layers: ['#F577A8', '#D65087', '#A83162'] }
    ].map((preset) => Object.freeze({ ...preset, layers: Object.freeze(preset.layers) })));

    // Only accept hex colors; imported settings must never become arbitrary CSS.
    function normalizeColor(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const hex = value.trim().replace(/^#/, '');
        if (/^[\da-f]{3}$/i.test(hex)) {
            return '#' + [...hex].map((digit) => digit + digit).join('').toUpperCase();
        }
        return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
    }

    function channels(hex) {
        return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    }

    function buildShadow(value) {
        const color = normalizeColor(value) || DEFAULT_COLOR;
        const preset = PRESETS.find((item) => item.color === color);
        const base = channels(color);
        const layers = preset
            ? preset.layers.map(channels)
            : [1, 0.82, 0.6].map((factor) => base.map((channel) => Math.round(channel * factor)));
        return [
            `inset 0 0 22px 3px rgba(${layers[0].join(', ')}, 0.58)`,
            `inset 0 0 54px 12px rgba(${layers[1].join(', ')}, 0.35)`,
            `inset 0 0 100px 28px rgba(${layers[2].join(', ')}, 0.18)`
        ].join(', ');
    }

    globalThis.AskPageAgentGlow = Object.freeze({ DEFAULT_COLOR, STORAGE_KEY, PRESETS, normalizeColor, buildShadow });
})();
