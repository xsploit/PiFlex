#pragma once

#include "util/fpclassify.h"

#include "control/controlobject.h"
#include "preferences/dialog/dlgprefdeck.h"

namespace mixxx::deckload {

// Routing state, not momentary silence: a quiet intro or a breakdown must
// never make a live channel replaceable. Missing/invalid controls fail closed.
inline bool channelClosed(const QString& group) {
    auto* volume = ControlObject::getControl(ConfigKey(group, "volume"));
    auto* mainMix = ControlObject::getControl(ConfigKey(group, "main_mix"));
    const auto level = volume ? volume->get() : -1.0;
    return (volume && util_isfinite(level) && level >= 0.0 && level <= 0.0001) ||
            (mainMix && mainMix->get() == 0.0);
}

inline LoadWhenDeckPlaying policy(UserSettingsPointer config) {
    if (config->exists(kConfigKeyLoadWhenDeckPlaying)) {
        return config->getValue(kConfigKeyLoadWhenDeckPlaying, kDefaultLoadWhenDeckPlaying);
    }
    if (config->exists(kConfigKeyAllowTrackLoadToPlayingDeck)) {
        return config->getValue(kConfigKeyAllowTrackLoadToPlayingDeck, false)
                ? LoadWhenDeckPlaying::Allow : LoadWhenDeckPlaying::Reject;
    }
    return kDefaultLoadWhenDeckPlaying;
}

inline bool allowed(const QString& group, UserSettingsPointer config) {
    if (group.startsWith("[PreviewDeck")) {
        return true;
    }
    auto* play = ControlObject::getControl(ConfigKey(group, "play"));
    if (!play || !util_isfinite(play->get())) {
        return false;
    }
    if (play->get() == 0.0) {
        return true;
    }
    switch (policy(config)) {
    case LoadWhenDeckPlaying::Allow:
    case LoadWhenDeckPlaying::AllowButStopDeck:
        return true;
    case LoadWhenDeckPlaying::AllowIfChannelClosed:
        return channelClosed(group);
    default:
        return false;
    }
}
} // namespace mixxx::deckload
