#pragma once

#include "track/beats.h"
#include "track/phrase.h"

namespace mixxx {
// Reproject from the immutable imported grid, never from the last displayed
// result. This makes repeated nudges and undo exact rather than cumulative.
inline PhraseList alignPhrases(const PhraseList& source,
        const BeatsPointer& original, const BeatsPointer& edited) {
    if (!original || !edited || original == edited) return source;
    const auto mapSeconds = [&](double seconds) {
        const audio::FramePos position(seconds * original->getSampleRate());
        auto next = original->iteratorFrom(position);
        const auto prev = next - 1;
        const double span = *next - *prev;
        if (span <= 0) return seconds;
        const int ordinal = prev - original->cfirstmarker();
        auto target = edited->cfirstmarker() + ordinal;
        const double phase = (position - *prev) / span;
        const auto mapped = *target + (*(target + 1) - *target) * phase;
        return mapped.value() / edited->getSampleRate();
    };
    auto projected = source;
    for (auto& phrase : projected) {
        phrase.startSeconds = mapSeconds(phrase.startSeconds);
        phrase.endSeconds = mapSeconds(phrase.endSeconds);
        if (phrase.fillSeconds >= 0) phrase.fillSeconds = mapSeconds(phrase.fillSeconds);
    }
    return projected;
}
} // namespace mixxx
